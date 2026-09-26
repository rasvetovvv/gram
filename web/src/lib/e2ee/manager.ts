// High-level orchestration for GRAM secret-chat E2EE in the browser.
//
// This is the one module the UI talks to. It owns:
//   - ensuring this browser has a device with a published PUBLIC prekey bundle;
//   - opening an encrypted session with a peer (initiator side) and caching it;
//   - lazily accepting an inbound session from the first ciphertext (responder side);
//   - encrypting outgoing text and decrypting inbound envelopes for a secret chat;
//   - persisting all SECRET state through the device-local encrypted vault.
//
// Nothing here ever sends a private key or plaintext to the server. The server calls it makes go
// only to the public key-directory endpoints in api.ts.

import { api } from "../api";
import type { E2eeFetchedBundle } from "../types";
import {
  consumeOneTimePreKey,
  createDevice,
  publishableBundle,
  replenishOneTimePreKeys,
  type DeviceState
} from "./device";
import { fromBase64, toBase64, type KeyPair } from "./primitives";
import {
  InitiatorSession,
  ResponderSession,
  type EncryptedEnvelope,
  type InitiatorSessionState,
  type ResponderSessionState,
  type SessionState
} from "./session";
import type { DeviceKeyMaterial } from "./x3dh";
import { VAULT_KEYS, vaultGet, vaultPut } from "./vault";

const ONE_TIME_PREKEY_TARGET = 50;
const REPLENISH_THRESHOLD = 10;

/** Persisted, base64-encoded form of a device's own key material + one-time prekey pool. */
interface StoredDevice {
  devicePublicId: string;
  identityDhPrivate: string;
  identityDhPublic: string;
  identitySigningPrivate: string;
  identitySigningPublic: string;
  signedPreKeyId: number;
  signedPreKeyPrivate: string;
  signedPreKeyPublic: string;
  oneTimePreKeys: Record<number, { priv: string; pub: string }>;
  nextOneTimePreKeyId: number;
}

function serializeDevice(devicePublicId: string, device: DeviceState): StoredDevice {
  const oneTimePreKeys: Record<number, { priv: string; pub: string }> = {};
  for (const [id, keyPair] of device.oneTimePreKeys) {
    oneTimePreKeys[id] = { priv: toBase64(keyPair.privateKey), pub: toBase64(keyPair.publicKey) };
  }
  return {
    devicePublicId,
    identityDhPrivate: toBase64(device.material.identityDh.privateKey),
    identityDhPublic: toBase64(device.material.identityDh.publicKey),
    identitySigningPrivate: toBase64(device.material.identitySigning.privateKey),
    identitySigningPublic: toBase64(device.material.identitySigning.publicKey),
    signedPreKeyId: device.material.signedPreKeyId,
    signedPreKeyPrivate: toBase64(device.material.signedPreKey.privateKey),
    signedPreKeyPublic: toBase64(device.material.signedPreKey.publicKey),
    oneTimePreKeys,
    nextOneTimePreKeyId: device.nextOneTimePreKeyId
  };
}

function deserializeDevice(stored: StoredDevice): { publicId: string; device: DeviceState } {
  const material: DeviceKeyMaterial = {
    identityDh: {
      privateKey: fromBase64(stored.identityDhPrivate),
      publicKey: fromBase64(stored.identityDhPublic)
    },
    identitySigning: {
      privateKey: fromBase64(stored.identitySigningPrivate),
      publicKey: fromBase64(stored.identitySigningPublic)
    },
    signedPreKey: {
      privateKey: fromBase64(stored.signedPreKeyPrivate),
      publicKey: fromBase64(stored.signedPreKeyPublic)
    },
    signedPreKeyId: stored.signedPreKeyId
  };
  const oneTimePreKeys = new Map<number, KeyPair>();
  for (const [id, pair] of Object.entries(stored.oneTimePreKeys)) {
    oneTimePreKeys.set(Number(id), {
      privateKey: fromBase64(pair.priv),
      publicKey: fromBase64(pair.pub)
    });
  }
  return {
    publicId: stored.devicePublicId,
    device: { material, oneTimePreKeys, nextOneTimePreKeyId: stored.nextOneTimePreKeyId }
  };
}

/** Manages one user's E2EE state for the lifetime of a signed-in browser session. */
export class E2eeManager {
  private readonly userId: string;
  private devicePublicId = "";
  private device: DeviceState | null = null;
  private readonly sessions = new Map<string, InitiatorSession | ResponderSession>();
  // A sender cannot decrypt its own outbound ciphertext (its sending chain is not its receiving
  // chain). When the server echoes our own message back, we look its plaintext up here by the
  // ciphertext bytes. Bounded so it cannot grow without limit within a session.
  private readonly ownPlaintext = new Map<string, string>();
  private readonly ownPlaintextOrder: string[] = [];

  constructor(userId: string) {
    this.userId = userId;
  }

  private rememberOwn(ciphertext: string, plaintext: string): void {
    if (this.ownPlaintext.has(ciphertext)) return;
    this.ownPlaintext.set(ciphertext, plaintext);
    this.ownPlaintextOrder.push(ciphertext);
    if (this.ownPlaintextOrder.length > 500) {
      const evicted = this.ownPlaintextOrder.shift();
      if (evicted !== undefined) this.ownPlaintext.delete(evicted);
    }
  }

  /** Load-or-create this browser's device and make sure its public bundle is on the server. */
  async ensureDevice(): Promise<void> {
    if (this.device) return;
    const stored = await vaultGet<StoredDevice>(VAULT_KEYS.device(this.userId));
    if (stored) {
      const { publicId, device } = deserializeDevice(stored);
      this.devicePublicId = publicId;
      this.device = device;
      await this.replenishIfLow();
      return;
    }
    // First run on this browser: mint a device, persist its secrets, publish only public material.
    const device = createDevice(ONE_TIME_PREKEY_TARGET);
    const devicePublicId = crypto.randomUUID();
    this.devicePublicId = devicePublicId;
    this.device = device;
    await this.persistDevice();
    await this.publishBundle();
  }

  private async persistDevice(): Promise<void> {
    if (!this.device) return;
    await vaultPut(VAULT_KEYS.device(this.userId), serializeDevice(this.devicePublicId, this.device));
  }

  private async publishBundle(): Promise<void> {
    if (!this.device) throw new Error("e2ee: device not initialised");
    const bundle = publishableBundle(this.device, true);
    const oneTimePrekeys = [];
    for (const [id, keyPair] of this.device.oneTimePreKeys) {
      oneTimePrekeys.push({ id, public_key: toBase64(keyPair.publicKey) });
    }
    await api.publishE2eeBundle({
      device_public_id: this.devicePublicId,
      identity_dh_public: toBase64(this.device.material.identityDh.publicKey),
      identity_signing_public: toBase64(this.device.material.identitySigning.publicKey),
      signed_prekey_id: this.device.material.signedPreKeyId,
      signed_prekey_public: toBase64(this.device.material.signedPreKey.publicKey),
      signed_prekey_signature: toBase64(bundle.signedPreKeySignature),
      one_time_prekeys: oneTimePrekeys
    });
  }

  private async replenishIfLow(): Promise<void> {
    if (!this.device) return;
    if (this.device.oneTimePreKeys.size >= REPLENISH_THRESHOLD) return;
    const minted = replenishOneTimePreKeys(
      this.device,
      ONE_TIME_PREKEY_TARGET - this.device.oneTimePreKeys.size
    );
    await this.persistDevice();
    if (minted.length > 0) {
      await api.replenishE2eePrekeys(
        this.devicePublicId,
        minted.map((prekey) => ({ id: prekey.id, public_key: prekey.publicKey }))
      );
    }
  }

  /**
   * Open (or restore) an encrypted session for a secret chat and return the first envelope to
   * send if this is a brand-new session, or null if a session already exists.
   */
  async openSession(chatId: string, peerUsername: string): Promise<void> {
    if (this.sessions.has(chatId)) return;
    const restored = await this.restoreSession(chatId);
    if (restored) return;
    await this.ensureDevice();
    const response = await api.startE2eeSession(peerUsername);
    const bundle = pickBundle(response.devices);
    if (!bundle || !this.device) throw new Error("e2ee: peer has no encryption device");
    const session = new InitiatorSession(
      this.device.material.identityDh,
      this.device.material.identitySigning.publicKey,
      {
        identityDhPublic: fromBase64(bundle.identity_dh_public),
        identitySigningPublic: fromBase64(bundle.identity_signing_public),
        signedPreKeyId: bundle.signed_prekey_id,
        signedPreKeyPublic: fromBase64(bundle.signed_prekey_public),
        signedPreKeySignature: fromBase64(bundle.signed_prekey_signature),
        ...(bundle.one_time_prekey_id !== null && bundle.one_time_prekey_public
          ? {
              oneTimePreKeyId: bundle.one_time_prekey_id,
              oneTimePreKeyPublic: fromBase64(bundle.one_time_prekey_public)
            }
          : {})
      }
    );
    this.sessions.set(chatId, session);
    await this.persistSession(chatId);
  }

  /** Encrypt outgoing plaintext for a secret chat into the wire envelope (as JSON string). */
  async encrypt(chatId: string, peerUsername: string, plaintext: string): Promise<string> {
    await this.openSession(chatId, peerUsername);
    const session = this.sessions.get(chatId);
    if (!session) throw new Error("e2ee: no session");
    const envelope = session.encrypt(plaintext);
    await this.persistSession(chatId);
    const wire = JSON.stringify(envelope);
    // We cannot decrypt our own outbound ciphertext, so remember it for when the server echoes it.
    this.rememberOwn(wire, plaintext);
    return wire;
  }

  /** Decrypt an inbound secret-chat message body. Lazily accepts a session on the first envelope. */
  async decrypt(chatId: string, rawContent: string): Promise<string> {
    const own = this.ownPlaintext.get(rawContent);
    if (own !== undefined) return own; // our own message echoed back by the server
    let envelope: EncryptedEnvelope;
    try {
      envelope = JSON.parse(rawContent) as EncryptedEnvelope;
    } catch {
      return rawContent; // not an E2EE envelope (e.g. a plaintext service message)
    }
    if (typeof envelope !== "object" || envelope === null || !("ct" in envelope)) {
      return rawContent;
    }
    await this.restoreSession(chatId);
    const session = this.sessions.get(chatId);
    if (!session) {
      // Inbound-first: complete X3DH as responder using our own device material.
      await this.ensureDevice();
      if (!this.device) throw new Error("e2ee: device not initialised");
      const device = this.device;
      const { session: responder, firstPlaintext } = ResponderSession.accept(
        device.material,
        envelope,
        (id) => consumeOneTimePreKey(device, id)
      );
      this.sessions.set(chatId, responder);
      await this.persistDevice(); // a one-time prekey was consumed
      await this.persistSession(chatId);
      return firstPlaintext;
    }
    const plaintext = session.decrypt(envelope);
    await this.persistSession(chatId);
    return plaintext;
  }

  private async persistSession(chatId: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;
    await vaultPut(VAULT_KEYS.session(this.userId, chatId), session.serialize());
  }

  get ownerId(): string {
    return this.userId;
  }

  private async restoreSession(chatId: string): Promise<boolean> {
    if (this.sessions.has(chatId)) return true;
    const state = await vaultGet<SessionState>(VAULT_KEYS.session(this.userId, chatId));
    if (!state) return false;
    const session =
      state.role === "initiator"
        ? InitiatorSession.restore(state as InitiatorSessionState)
        : ResponderSession.restore(state as ResponderSessionState);
    this.sessions.set(chatId, session);
    return true;
  }
}

function pickBundle(devices: E2eeFetchedBundle[]): E2eeFetchedBundle | null {
  // Single-device model for now: prefer a device that still had a one-time prekey to consume.
  const withOtk = devices.find((device) => device.one_time_prekey_id !== null);
  return withOtk ?? devices[0] ?? null;
}

let manager: E2eeManager | null = null;

/** Process-wide manager for the signed-in user; recreated when the user changes. */
export function e2eeManager(userId: string): E2eeManager {
  if (!manager || manager.ownerId !== userId) manager = new E2eeManager(userId);
  return manager;
}
