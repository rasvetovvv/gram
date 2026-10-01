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
  rotateSignedPreKey,
  type DeviceState
} from "./device";
import { fromBase64, toBase64, type KeyPair } from "./primitives";
import { computeSafetyNumber, safetyNumberQrPayload, verificationStatus, type VerificationStatus } from "./fingerprint";
import { GroupSession, type GroupSessionState } from "./group-session";
import { GroupKeyCoordinator } from "./group-coordinator";
import {
  buildGroupKeyDistributionWire,
  buildGroupMessageWire,
  parseGroupKeyDistributionWire,
  parseGroupMessageWire,
  GROUP_KEY_DISTRIBUTION_MARKER
} from "./group-wire";
import {
  InitiatorSession,
  ResponderSession,
  type EncryptedEnvelope,
  type InitiatorSessionState,
  type ResponderSessionState,
  type SessionState
} from "./session";
import type { DeviceKeyMaterial } from "./x3dh";
import { VAULT_KEYS, vaultDelete, vaultGet, vaultPut } from "./vault";

const ONE_TIME_PREKEY_TARGET = 50;
const REPLENISH_THRESHOLD = 10;
// A signed prekey is medium-lived: rotating it weekly limits how long a future compromise of one
// signed prekey can help an attacker start NEW sessions. Existing sessions are unaffected (the
// Double Ratchet has already moved past X3DH), so rotation is safe to do silently on load.
const SIGNED_PREKEY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
  // When the signed prekey was last rotated (epoch ms). Absent on devices created before rotation
  // existed; treated as "rotate now" so an old device gets a fresh signed prekey on next load.
  signedPreKeyRotatedAt?: number;
}

function serializeDevice(
  devicePublicId: string,
  device: DeviceState,
  signedPreKeyRotatedAt: number
): StoredDevice {
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
    nextOneTimePreKeyId: device.nextOneTimePreKeyId,
    signedPreKeyRotatedAt
  };
}

function deserializeDevice(stored: StoredDevice): {
  publicId: string;
  device: DeviceState;
  signedPreKeyRotatedAt: number;
} {
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
    device: { material, oneTimePreKeys, nextOneTimePreKeyId: stored.nextOneTimePreKeyId },
    // Absent on pre-rotation devices: default to 0 (epoch) so they are seen as overdue and rotated.
    signedPreKeyRotatedAt: stored.signedPreKeyRotatedAt ?? 0
  };
}

/** Manages one user's E2EE state for the lifetime of a signed-in browser session. */
export class E2eeManager {
  private readonly userId: string;
  private devicePublicId = "";
  private device: DeviceState | null = null;
  // Epoch ms of the last signed-prekey rotation, so a stale one is refreshed on load.
  private signedPreKeyRotatedAt = 0;
  private readonly sessions = new Map<string, InitiatorSession | ResponderSession>();
  // One sender-key group engine per secret group chat (lazily loaded from the device vault).
  private readonly groups = new Map<string, GroupSession>();
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
      const { publicId, device, signedPreKeyRotatedAt } = deserializeDevice(stored);
      this.devicePublicId = publicId;
      this.device = device;
      this.signedPreKeyRotatedAt = signedPreKeyRotatedAt;
      await this.rotateSignedPreKeyIfStale();
      await this.replenishIfLow();
      return;
    }
    // First run on this browser: mint a device, persist its secrets, publish only public material.
    const device = createDevice(ONE_TIME_PREKEY_TARGET);
    const devicePublicId = crypto.randomUUID();
    this.devicePublicId = devicePublicId;
    this.device = device;
    this.signedPreKeyRotatedAt = Date.now();
    await this.persistDevice();
    await this.publishBundle();
  }

  private async persistDevice(): Promise<void> {
    if (!this.device) return;
    await vaultPut(
      VAULT_KEYS.device(this.userId),
      serializeDevice(this.devicePublicId, this.device, this.signedPreKeyRotatedAt)
    );
  }

  /**
   * Rotate the signed prekey when it is older than the max age. Only the signed prekey (and its
   * signature) change; the identity keys and already-established sessions are untouched, so this
   * is safe to run silently on load. The rotated PUBLIC bundle is re-published so new initiators
   * use the fresh signed prekey.
   */
  private async rotateSignedPreKeyIfStale(): Promise<void> {
    if (!this.device) return;
    if (Date.now() - this.signedPreKeyRotatedAt < SIGNED_PREKEY_MAX_AGE_MS) return;
    const rotated = rotateSignedPreKey(this.device);
    this.device = {
      material: rotated.material,
      oneTimePreKeys: this.device.oneTimePreKeys,
      nextOneTimePreKeyId: this.device.nextOneTimePreKeyId
    };
    this.signedPreKeyRotatedAt = Date.now();
    await this.persistDevice();
    await this.publishBundle();
  }

  /** Days until the signed prekey is next due for rotation (0 = due now). Null if no device yet. */
  async signedPreKeyAgeDays(): Promise<number | null> {
    await this.ensureDevice();
    if (!this.signedPreKeyRotatedAt) return 0;
    return Math.floor((Date.now() - this.signedPreKeyRotatedAt) / (24 * 60 * 60 * 1000));
  }

  /** How many one-time prekeys this device still holds locally (its unconsumed pool). */
  async oneTimePreKeyPoolSize(): Promise<number> {
    await this.ensureDevice();
    return this.device?.oneTimePreKeys.size ?? 0;
  }

  /**
   * A compact health summary of this device's key material for a settings/security panel:
   * the one-time prekey pool size, its target, whether a top-up is due, and the signed-prekey age.
   */
  async keyHealth(): Promise<{
    oneTimePreKeys: number;
    target: number;
    lowThreshold: number;
    low: boolean;
    signedPreKeyAgeDays: number;
    signedPreKeyMaxAgeDays: number;
  }> {
    await this.ensureDevice();
    const pool = this.device?.oneTimePreKeys.size ?? 0;
    const ageDays = this.signedPreKeyRotatedAt
      ? Math.floor((Date.now() - this.signedPreKeyRotatedAt) / (24 * 60 * 60 * 1000))
      : 0;
    return {
      oneTimePreKeys: pool,
      target: ONE_TIME_PREKEY_TARGET,
      lowThreshold: REPLENISH_THRESHOLD,
      low: pool < REPLENISH_THRESHOLD,
      signedPreKeyAgeDays: ageDays,
      signedPreKeyMaxAgeDays: Math.floor(SIGNED_PREKEY_MAX_AGE_MS / (24 * 60 * 60 * 1000))
    };
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
    // A 1:1 secret message may actually carry a group's sender-key distribution (the pairwise
    // channel is how group keys travel). If so, import it and return a sentinel the UI hides,
    // rather than showing the raw JSON as a chat message.
    const imported = await this.importIfGroupDistribution(plaintext);
    if (imported) return GROUP_KEY_DISTRIBUTION_MARKER;
    return plaintext;
  }

  /**
   * If `plaintext` is a group sender-key distribution (received over a pairwise 1:1 channel),
   * import it into the right group and return true. Otherwise return false and do nothing.
   */
  private async importIfGroupDistribution(plaintext: string): Promise<boolean> {
    const envelope = parseGroupKeyDistributionWire(plaintext);
    if (!envelope) return false;
    const session = await this.ensureGroup(envelope.group);
    session.acceptDistribution(envelope.from, envelope.skd);
    await this.persistGroup(envelope.group);
    return true;
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

  /**
   * The safety number for a secret chat, or null if no session exists yet on this device (nothing
   * has been sent or received, so there are no bound identity keys to fingerprint). Opening the
   * session first (sending or receiving one message) is what makes a number available.
   */
  async safetyNumber(chatId: string): Promise<string | null> {
    await this.restoreSession(chatId);
    const session = this.sessions.get(chatId);
    if (!session) return null;
    const { local, peer } = session.identities();
    if (local.length === 0 || peer.length === 0) return null;
    return computeSafetyNumber(local, peer);
  }

  /** The QR payload mirroring the safety number, or null when no session exists yet. */
  async safetyNumberQr(chatId: string): Promise<string | null> {
    await this.restoreSession(chatId);
    const session = this.sessions.get(chatId);
    if (!session) return null;
    const { local, peer } = session.identities();
    if (local.length === 0 || peer.length === 0) return null;
    return safetyNumberQrPayload(local, peer);
  }

  /**
   * The verification state of a secret chat's peer key: whether the user has confirmed it out of
   * band and whether the key currently in the session still matches that confirmed value.
   * Returns "unverified" when no session exists yet (nothing to compare).
   */
  async verificationStatus(chatId: string): Promise<VerificationStatus> {
    await this.restoreSession(chatId);
    const session = this.sessions.get(chatId);
    if (!session) return "unverified";
    const { peer } = session.identities();
    if (peer.length === 0) return "unverified";
    const confirmed = await vaultGet<string>(VAULT_KEYS.verification(this.userId, chatId));
    return verificationStatus(confirmed, toBase64(peer));
  }

  /**
   * Record the current peer identity key as verified — called when the user confirms the safety
   * number matches out of band. Persists only the PUBLIC peer key so a later key change is
   * detectable as a "changed" state.
   */
  async markVerified(chatId: string): Promise<void> {
    await this.restoreSession(chatId);
    const session = this.sessions.get(chatId);
    if (!session) return;
    const { peer } = session.identities();
    if (peer.length === 0) return;
    await vaultPut(VAULT_KEYS.verification(this.userId, chatId), toBase64(peer));
  }

  /** Clear a previously recorded verification (e.g. the user chooses to re-verify). */
  async clearVerification(chatId: string): Promise<void> {
    await vaultDelete(VAULT_KEYS.verification(this.userId, chatId));
  }

  // ─── Secret GROUP chats (sender-key fan-out) ────────────────────────────────────────────────
  //
  // A secret group never establishes one shared ratchet. Instead every member owns a sender key
  // (group-session.ts) and distributes its PUBLIC half to each other member over the pairwise 1:1
  // secret channel. Thereafter a member encrypts each message once and the server fans the single
  // ciphertext out. The manager keeps one GroupSession per group chat, persisted device-locally.

  private async loadGroup(chatId: string): Promise<GroupSession | null> {
    const existing = this.groups.get(chatId);
    if (existing) return existing;
    const state = await vaultGet<GroupSessionState>(VAULT_KEYS.group(this.userId, chatId));
    if (!state) return null;
    const session = GroupSession.restore(state);
    this.groups.set(chatId, session);
    return session;
  }

  /** Load-or-create this member's sender-key state for a group and persist it. */
  async ensureGroup(chatId: string): Promise<GroupSession> {
    const loaded = await this.loadGroup(chatId);
    if (loaded) return loaded;
    const session = GroupSession.create();
    this.groups.set(chatId, session);
    await this.persistGroup(chatId);
    return session;
  }

  private async persistGroup(chatId: string): Promise<void> {
    const session = this.groups.get(chatId);
    if (!session) return;
    await vaultPut(VAULT_KEYS.group(this.userId, chatId), session.serialize());
  }

  /**
   * The wire payload carrying THIS member's sender key for `chatId`, to be delivered to each other
   * member over the pairwise 1:1 secret channel (the caller does the sending). `selfMemberId` is
   * how this member identifies itself to peers (its user id).
   */
  async groupDistributionWire(chatId: string, selfMemberId: string): Promise<string> {
    const session = await this.ensureGroup(chatId);
    return buildGroupKeyDistributionWire(chatId, selfMemberId, session.ownDistribution());
  }

  /**
   * Consume a sender-key distribution received over a pairwise channel. Returns the group chat id
   * it was for (so the caller can refresh that group) or null if the content is not a distribution.
   * Importing is idempotent-by-replacement: a peer's rotation simply overwrites its old key.
   */
  async acceptGroupDistributionWire(rawContent: string): Promise<string | null> {
    const envelope = parseGroupKeyDistributionWire(rawContent);
    if (!envelope) return null;
    const session = await this.ensureGroup(envelope.group);
    session.acceptDistribution(envelope.from, envelope.skd);
    await this.persistGroup(envelope.group);
    return envelope.group;
  }

  /** Encrypt a group message into the wire string stored as the chat's message content. */
  async encryptGroup(chatId: string, selfMemberId: string, plaintext: string): Promise<string> {
    const session = await this.ensureGroup(chatId);
    const message = session.encrypt(plaintext);
    await this.persistGroup(chatId);
    const wire = buildGroupMessageWire(selfMemberId, message);
    // We cannot decrypt our own outbound group ciphertext, so remember it for the server echo.
    this.rememberOwn(wire, plaintext);
    return wire;
  }

  /**
   * Decrypt an inbound group message. `rawContent` is the stored message body and `senderId` is
   * the server-attested author. A distribution payload or a non-group body returns the raw string
   * unchanged (service messages, or a key handshake the UI shows as a system notice). Throws only
   * when a genuine group ciphertext cannot be decrypted (missing/!matching sender key).
   */
  async decryptGroup(chatId: string, senderId: string, rawContent: string): Promise<string> {
    const own = this.ownPlaintext.get(rawContent);
    if (own !== undefined) return own; // our own message echoed back by the server
    const envelope = parseGroupMessageWire(rawContent);
    if (!envelope) return rawContent; // not a group ciphertext (service text, etc.)
    // The envelope's claimed sender must match the server-attested author: a mismatch means a
    // relabelled message. The sender key's signature (checked in group.ts) is the real authority,
    // but refusing a mismatch here closes an obvious spoof before any crypto runs.
    if (envelope.from !== senderId) throw new Error("e2ee: group message sender mismatch");
    const session = await this.loadGroup(chatId);
    if (!session) throw new Error("e2ee: no group session on this device");
    const plaintext = session.decrypt(senderId, envelope.msg);
    await this.persistGroup(chatId);
    return plaintext;
  }

  /** Whether this device holds the sender key for `senderId` in `chatId` (can decrypt them yet). */
  async hasGroupSenderKey(chatId: string, senderId: string): Promise<boolean> {
    const session = await this.loadGroup(chatId);
    return session?.hasPeer(senderId) ?? false;
  }

  /**
   * Rotate this member's sender key on a membership change and persist. The caller MUST then send
   * a fresh `groupDistributionWire` to every remaining member. `remainingMemberIds` excludes self.
   */
  async rotateGroup(chatId: string, remainingMemberIds: Iterable<string>): Promise<void> {
    const session = await this.ensureGroup(chatId);
    session.rotate(remainingMemberIds);
    await this.persistGroup(chatId);
  }

  /**
   * Hand this member's current sender key to every group member who does not already hold it, by
   * sending the distribution wire over each peer's pairwise 1:1 secret channel. `send(peerUserId,
   * wire)` is the injected transport (the UI wires it to the 1:1 secret-chat send against that
   * peer). `peerUserIds` excludes self. Returns the peers actually sent to; a failed send is left
   * un-seeded so a later call retries it. Delivery is tracked device-locally per group.
   */
  async distributeGroupKeys(
    chatId: string,
    selfMemberId: string,
    peerUserIds: Iterable<string>,
    send: (peerUserId: string, wire: string) => Promise<void>
  ): Promise<string[]> {
    const wire = await this.groupDistributionWire(chatId, selfMemberId);
    const seeded = await vaultGet<string[]>(VAULT_KEYS.groupSender(this.userId, chatId));
    const coordinator = new GroupKeyCoordinator(
      selfMemberId,
      wire,
      { sendToMember: send },
      seeded ?? []
    );
    const sent = await coordinator.distributeTo(peerUserIds);
    if (sent.length > 0) {
      const nowSeeded = [...new Set([...(seeded ?? []), ...sent])];
      await vaultPut(VAULT_KEYS.groupSender(this.userId, chatId), nowSeeded);
    }
    return sent;
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
