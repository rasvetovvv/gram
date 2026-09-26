// Message-level E2EE session for GRAM 1:1 secret chats.
//
// Wraps X3DH + Double Ratchet into an encrypt/decrypt API over a JSON-friendly wire envelope.
// The envelope carries only public keys, counters and ciphertext (all base64) — nothing the
// server can decrypt. The FIRST message additionally carries the initiator's X3DH prelude so the
// responder can complete the handshake with no prior round trip.

import { DoubleRatchet, type RatchetMessage, type RatchetState } from "./ratchet";
import {
  initiateX3DH,
  respondX3DH,
  type FetchedBundle,
  type DeviceKeyMaterial
} from "./x3dh";
import { fromBase64, toBase64, type KeyPair } from "./primitives";

export const E2EE_WIRE_VERSION = 1;

/** SECRET persisted session state (contains live ratchet keys). Device-local storage only. */
export interface InitiatorSessionState {
  role: "initiator";
  ratchet: RatchetState;
  preludeSent: boolean;
  prelude: Prelude;
}

export interface ResponderSessionState {
  role: "responder";
  ratchet: RatchetState;
}

export type SessionState = InitiatorSessionState | ResponderSessionState;

/** X3DH prelude present only on the first ciphertext of a session. */
interface Prelude {
  readonly ik: string; // initiator identity DH public
  readonly ek: string; // initiator ephemeral public
  readonly spk: number; // signed prekey id consumed
  readonly opk?: number; // one-time prekey id consumed (if any)
}

/** The full envelope the client sends as the message "content" of a secret chat. */
export interface EncryptedEnvelope {
  readonly v: number;
  readonly prelude?: Prelude;
  readonly dh: string; // ratchet header public key (base64)
  readonly pn: number; // previous chain length
  readonly n: number; // message number
  readonly ct: string; // ciphertext + tag (base64)
}

function serialize(message: RatchetMessage, prelude?: Prelude): EncryptedEnvelope {
  return {
    v: E2EE_WIRE_VERSION,
    ...(prelude ? { prelude } : {}),
    dh: toBase64(message.header.dhPublic),
    pn: message.header.previousChainLength,
    n: message.header.messageNumber,
    ct: toBase64(message.ciphertext)
  };
}

function deserialize(envelope: EncryptedEnvelope): RatchetMessage {
  if (envelope.v !== E2EE_WIRE_VERSION) throw new Error("e2ee: unsupported envelope version");
  return {
    header: {
      dhPublic: fromBase64(envelope.dh),
      previousChainLength: envelope.pn,
      messageNumber: envelope.n
    },
    ciphertext: fromBase64(envelope.ct)
  };
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Initiator session — created once the initiator has fetched-and-consumed the peer bundle. */
export class InitiatorSession {
  private ratchet: DoubleRatchet;
  private preludeSent = false;
  private prelude: Prelude;

  constructor(ownIdentityDh: KeyPair, ownIdentitySigningPublic: Uint8Array, bundle: FetchedBundle) {
    const x3dh = initiateX3DH(ownIdentityDh, ownIdentitySigningPublic, bundle);
    this.ratchet = DoubleRatchet.initSender(
      x3dh.sharedSecret,
      x3dh.associatedData,
      bundle.signedPreKeyPublic
    );
    this.prelude = {
      ik: toBase64(ownIdentityDh.publicKey),
      ek: toBase64(x3dh.ephemeralPublic),
      spk: x3dh.usedSignedPreKeyId,
      ...(x3dh.usedOneTimePreKeyId !== undefined ? { opk: x3dh.usedOneTimePreKeyId } : {})
    };
  }

  encrypt(plaintext: string): EncryptedEnvelope {
    const message = this.ratchet.encrypt(textEncoder.encode(plaintext));
    const envelope = serialize(message, this.preludeSent ? undefined : this.prelude);
    this.preludeSent = true;
    return envelope;
  }

  decrypt(envelope: EncryptedEnvelope): string {
    return textDecoder.decode(this.ratchet.decrypt(deserialize(envelope)));
  }

  /** SECRET session state for device-local persistence. Never send to the server. */
  serialize(): InitiatorSessionState {
    return { role: "initiator", ratchet: this.ratchet.serialize(), preludeSent: this.preludeSent, prelude: this.prelude };
  }

  static restore(state: InitiatorSessionState): InitiatorSession {
    const session: InitiatorSession = Object.create(InitiatorSession.prototype);
    session.ratchet = DoubleRatchet.deserialize(state.ratchet);
    session.preludeSent = state.preludeSent;
    session.prelude = state.prelude;
    return session;
  }
}

/** Responder session — created lazily from the first inbound envelope's prelude. */
export class ResponderSession {
  private readonly ratchet: DoubleRatchet;

  private constructor(ratchet: DoubleRatchet) {
    this.ratchet = ratchet;
  }

  /**
   * Complete X3DH from the first envelope. `resolveOneTimePreKey` returns the PRIVATE one-time
   * prekey the initiator consumed (looked up by id in the device's local pool), or null if that
   * id is unknown/spent.
   */
  static accept(
    material: DeviceKeyMaterial,
    firstEnvelope: EncryptedEnvelope,
    resolveOneTimePreKey: (id: number) => KeyPair | null
  ): { session: ResponderSession; firstPlaintext: string } {
    const prelude = firstEnvelope.prelude;
    if (!prelude) throw new Error("e2ee: first envelope is missing the X3DH prelude");
    if (prelude.spk !== material.signedPreKeyId) {
      throw new Error("e2ee: prelude references an unknown signed prekey");
    }
    const usedOneTimePreKey =
      prelude.opk !== undefined ? resolveOneTimePreKey(prelude.opk) : null;
    if (prelude.opk !== undefined && !usedOneTimePreKey) {
      throw new Error("e2ee: one-time prekey already consumed or unknown");
    }

    const x3dh = respondX3DH(material.identityDh, material.signedPreKey, {
      initiatorIdentityDhPublic: fromBase64(prelude.ik),
      initiatorEphemeralPublic: fromBase64(prelude.ek),
      ...(usedOneTimePreKey ? { usedOneTimePreKey } : {})
    });
    const ratchet = DoubleRatchet.initReceiver(
      x3dh.sharedSecret,
      x3dh.associatedData,
      material.signedPreKey
    );
    const session = new ResponderSession(ratchet);
    const firstPlaintext = session.decrypt(firstEnvelope);
    return { session, firstPlaintext };
  }

  encrypt(plaintext: string): EncryptedEnvelope {
    return serialize(this.ratchet.encrypt(textEncoder.encode(plaintext)));
  }

  decrypt(envelope: EncryptedEnvelope): string {
    return textDecoder.decode(this.ratchet.decrypt(deserialize(envelope)));
  }

  /** SECRET session state for device-local persistence. Never send to the server. */
  serialize(): ResponderSessionState {
    return { role: "responder", ratchet: this.ratchet.serialize() };
  }

  static restore(state: ResponderSessionState): ResponderSession {
    return new ResponderSession(DoubleRatchet.deserialize(state.ratchet));
  }
}
