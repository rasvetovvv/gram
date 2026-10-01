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
  // The two long-lived identity DH public keys bound into this session (base64). Public values,
  // kept so the safety-number fingerprint can be shown without re-fetching the peer bundle.
  localIdentityDh: string;
  peerIdentityDh: string;
}

export interface ResponderSessionState {
  role: "responder";
  ratchet: RatchetState;
  localIdentityDh: string;
  peerIdentityDh: string;
}

export type SessionState = InitiatorSessionState | ResponderSessionState;

/** The pair of identity DH public keys bound into a session, for the safety-number fingerprint. */
export interface SessionIdentities {
  readonly local: Uint8Array;
  readonly peer: Uint8Array;
}

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
  private localIdentityDh!: Uint8Array;
  private peerIdentityDh!: Uint8Array;

  constructor(ownIdentityDh: KeyPair, ownIdentitySigningPublic: Uint8Array, bundle: FetchedBundle) {
    const x3dh = initiateX3DH(ownIdentityDh, ownIdentitySigningPublic, bundle);
    this.ratchet = DoubleRatchet.initSender(
      x3dh.sharedSecret,
      x3dh.associatedData,
      bundle.signedPreKeyPublic
    );
    this.localIdentityDh = ownIdentityDh.publicKey;
    this.peerIdentityDh = bundle.identityDhPublic;
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

  /** The identity public keys bound into this session, for the safety-number fingerprint. */
  identities(): SessionIdentities {
    return { local: this.localIdentityDh, peer: this.peerIdentityDh };
  }

  /** SECRET session state for device-local persistence. Never send to the server. */
  serialize(): InitiatorSessionState {
    return {
      role: "initiator",
      ratchet: this.ratchet.serialize(),
      preludeSent: this.preludeSent,
      prelude: this.prelude,
      localIdentityDh: toBase64(this.localIdentityDh),
      peerIdentityDh: toBase64(this.peerIdentityDh)
    };
  }

  static restore(state: InitiatorSessionState): InitiatorSession {
    const session: InitiatorSession = Object.create(InitiatorSession.prototype);
    session.ratchet = DoubleRatchet.deserialize(state.ratchet);
    session.preludeSent = state.preludeSent;
    session.prelude = state.prelude;
    // Older persisted sessions predate the stored identities; fall back to the prelude's own
    // initiator identity for the local half and leave the peer half empty rather than crash.
    session.localIdentityDh = fromBase64(state.localIdentityDh ?? state.prelude.ik);
    session.peerIdentityDh = state.peerIdentityDh ? fromBase64(state.peerIdentityDh) : new Uint8Array();
    return session;
  }
}

/** Responder session — created lazily from the first inbound envelope's prelude. */
export class ResponderSession {
  private readonly ratchet: DoubleRatchet;
  private localIdentityDh: Uint8Array;
  private peerIdentityDh: Uint8Array;

  private constructor(
    ratchet: DoubleRatchet,
    localIdentityDh: Uint8Array = new Uint8Array(),
    peerIdentityDh: Uint8Array = new Uint8Array()
  ) {
    this.ratchet = ratchet;
    this.localIdentityDh = localIdentityDh;
    this.peerIdentityDh = peerIdentityDh;
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
    // The responder's own identity is the local half; the initiator's (from the prelude) is the peer.
    const session = new ResponderSession(
      ratchet,
      material.identityDh.publicKey,
      fromBase64(prelude.ik)
    );
    const firstPlaintext = session.decrypt(firstEnvelope);
    return { session, firstPlaintext };
  }

  encrypt(plaintext: string): EncryptedEnvelope {
    return serialize(this.ratchet.encrypt(textEncoder.encode(plaintext)));
  }

  decrypt(envelope: EncryptedEnvelope): string {
    return textDecoder.decode(this.ratchet.decrypt(deserialize(envelope)));
  }

  /** The identity public keys bound into this session, for the safety-number fingerprint. */
  identities(): SessionIdentities {
    return { local: this.localIdentityDh, peer: this.peerIdentityDh };
  }

  /** SECRET session state for device-local persistence. Never send to the server. */
  serialize(): ResponderSessionState {
    return {
      role: "responder",
      ratchet: this.ratchet.serialize(),
      localIdentityDh: toBase64(this.localIdentityDh),
      peerIdentityDh: toBase64(this.peerIdentityDh)
    };
  }

  static restore(state: ResponderSessionState): ResponderSession {
    return new ResponderSession(
      DoubleRatchet.deserialize(state.ratchet),
      state.localIdentityDh ? fromBase64(state.localIdentityDh) : new Uint8Array(),
      state.peerIdentityDh ? fromBase64(state.peerIdentityDh) : new Uint8Array()
    );
  }
}
