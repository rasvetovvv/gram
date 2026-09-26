// Double Ratchet for GRAM secret chats (Signal-style), 1:1.
//
// Combines a Diffie-Hellman ratchet (a fresh X25519 key pair every time the direction of the
// conversation turns) with two symmetric-key ratchets (one per direction). The result:
//   - forward secrecy: a compromised current key does not reveal earlier messages;
//   - post-compromise security ("break-in recovery"): once a fresh DH ratchet step happens, a
//     previously-compromised session heals.
//
// Skipped-message keys are retained (bounded) so out-of-order / dropped frames still decrypt.
// The server sees only the header public key, counters and ciphertext — never a message key.

import {
  AEAD_KEY_LEN,
  AEAD_NONCE_LEN,
  aeadOpen,
  aeadSeal,
  concatBytes,
  diffieHellman,
  fromBase64 as unb64,
  generateDhKeyPair,
  hkdfSha256,
  hmacSha256,
  toBase64 as b64,
  type KeyPair
} from "./primitives";

const ROOT_INFO = new TextEncoder().encode("GRAM-E2EE-v1/root");
const MESSAGE_KEY_SEED = new Uint8Array([0x01]);
const CHAIN_KEY_SEED = new Uint8Array([0x02]);
const MAX_SKIP = 1000; // hard cap on skipped message keys retained per chain (DoS guard)

interface SerializedChain {
  key: string;
  index: number;
}

/** Full serialized ratchet state. SECRET — device-local encrypted storage only, never the server. */
export interface RatchetState {
  rootKey: string;
  selfPrivate: string;
  selfPublic: string;
  remotePublic: string | null;
  sendingChain: SerializedChain | null;
  receivingChain: SerializedChain | null;
  sentCount: number;
  receivedCount: number;
  previousSendingChainLength: number;
  associatedData: string;
  skipped: Record<string, string>;
}

export interface RatchetHeader {
  readonly dhPublic: Uint8Array; // sender's current ratchet public key
  readonly previousChainLength: number; // messages sent under the previous sending chain
  readonly messageNumber: number; // index within the current sending chain
}

export interface RatchetMessage {
  readonly header: RatchetHeader;
  readonly ciphertext: Uint8Array;
}

interface ChainKey {
  key: Uint8Array;
  index: number;
}

function skipKey(dhPublic: Uint8Array, index: number): string {
  let hex = "";
  for (const byte of dhPublic) hex += byte.toString(16).padStart(2, "0");
  return `${hex}:${index}`;
}

/**
 * A live Double Ratchet session. Construct with `initSender` (the X3DH initiator) or
 * `initReceiver` (the X3DH responder). Instances are mutable and single-threaded per direction.
 */
export class DoubleRatchet {
  private rootKey: Uint8Array;
  private selfKeyPair: KeyPair;
  private remotePublic: Uint8Array | null;
  private sendingChain: ChainKey | null = null;
  private receivingChain: ChainKey | null = null;
  private sentCount = 0;
  private receivedCount = 0;
  private previousSendingChainLength = 0;
  private readonly associatedData: Uint8Array;
  // Retained keys for messages that arrived out of order or are still in flight.
  private readonly skipped = new Map<string, Uint8Array>();

  private constructor(
    rootKey: Uint8Array,
    selfKeyPair: KeyPair,
    remotePublic: Uint8Array | null,
    associatedData: Uint8Array
  ) {
    this.rootKey = rootKey;
    this.selfKeyPair = selfKeyPair;
    this.remotePublic = remotePublic;
    this.associatedData = associatedData;
  }

  /**
   * Initiator (Alice). She already knows Bob's signed prekey public value, which acts as his
   * initial ratchet key, so she can perform the first DH ratchet step immediately and send the
   * first message without a round trip.
   */
  static initSender(
    sharedSecret: Uint8Array,
    associatedData: Uint8Array,
    remoteSignedPreKeyPublic: Uint8Array
  ): DoubleRatchet {
    const selfKeyPair = generateDhKeyPair();
    const ratchet = new DoubleRatchet(
      sharedSecret,
      selfKeyPair,
      remoteSignedPreKeyPublic,
      associatedData
    );
    const dh = diffieHellman(selfKeyPair.privateKey, remoteSignedPreKeyPublic);
    const [rootKey, chainKey] = ratchet.kdfRoot(dh);
    ratchet.rootKey = rootKey;
    ratchet.sendingChain = { key: chainKey, index: 0 };
    return ratchet;
  }

  /**
   * Responder (Bob). His signed prekey pair is the initial ratchet key pair; he takes his first
   * DH ratchet step lazily, the moment Alice's first message header arrives.
   */
  static initReceiver(
    sharedSecret: Uint8Array,
    associatedData: Uint8Array,
    signedPreKeyPair: KeyPair
  ): DoubleRatchet {
    return new DoubleRatchet(sharedSecret, signedPreKeyPair, null, associatedData);
  }

  get selfPublicKey(): Uint8Array {
    return this.selfKeyPair.publicKey;
  }

  private kdfRoot(dhOutput: Uint8Array): [Uint8Array, Uint8Array] {
    const derived = hkdfSha256(dhOutput, this.rootKey, ROOT_INFO, 64);
    return [derived.slice(0, 32), derived.slice(32, 64)];
  }

  private static advanceChain(chain: ChainKey): { messageKey: Uint8Array; next: ChainKey } {
    const messageKey = hmacSha256(chain.key, MESSAGE_KEY_SEED);
    const nextChainKey = hmacSha256(chain.key, CHAIN_KEY_SEED);
    return { messageKey, next: { key: nextChainKey, index: chain.index + 1 } };
  }

  private static nonce(): Uint8Array {
    // Every message key is unique (derived from a one-way chain that never repeats a key), so a
    // fixed zero nonce is safe under AES-GCM: the (key, nonce) pair is never reused.
    return new Uint8Array(AEAD_NONCE_LEN);
  }

  private static header(header: RatchetHeader): Uint8Array {
    const meta = new Uint8Array(8);
    const view = new DataView(meta.buffer);
    view.setUint32(0, header.previousChainLength, false);
    view.setUint32(4, header.messageNumber, false);
    return concatBytes(header.dhPublic, meta);
  }

  encrypt(plaintext: Uint8Array): RatchetMessage {
    if (!this.sendingChain) throw new Error("e2ee: sending chain not initialised");
    const { messageKey, next } = DoubleRatchet.advanceChain(this.sendingChain);
    const header: RatchetHeader = {
      dhPublic: this.selfKeyPair.publicKey,
      previousChainLength: this.previousSendingChainLength,
      messageNumber: this.sendingChain.index
    };
    this.sendingChain = next;
    this.sentCount += 1;
    if (messageKey.length !== AEAD_KEY_LEN) throw new Error("e2ee: bad message key length");
    const ad = concatBytes(this.associatedData, DoubleRatchet.header(header));
    const ciphertext = aeadSeal(messageKey, DoubleRatchet.nonce(), plaintext, ad);
    return { header, ciphertext };
  }

  decrypt(message: RatchetMessage): Uint8Array {
    const cached = this.trySkipped(message);
    if (cached) return cached;

    const isNewRatchetKey =
      this.remotePublic === null ||
      skipKey(this.remotePublic, 0) !== skipKey(message.header.dhPublic, 0);

    if (isNewRatchetKey) {
      this.skipReceiving(message.header.previousChainLength);
      this.dhRatchet(message.header.dhPublic);
    }
    this.skipReceiving(message.header.messageNumber);

    if (!this.receivingChain) throw new Error("e2ee: receiving chain not initialised");
    const { messageKey, next } = DoubleRatchet.advanceChain(this.receivingChain);
    this.receivingChain = next;
    this.receivedCount += 1;
    const ad = concatBytes(this.associatedData, DoubleRatchet.header(message.header));
    return aeadOpen(messageKey, DoubleRatchet.nonce(), message.ciphertext, ad);
  }

  private trySkipped(message: RatchetMessage): Uint8Array | null {
    const id = skipKey(message.header.dhPublic, message.header.messageNumber);
    const key = this.skipped.get(id);
    if (!key) return null;
    this.skipped.delete(id);
    const ad = concatBytes(this.associatedData, DoubleRatchet.header(message.header));
    return aeadOpen(key, DoubleRatchet.nonce(), message.ciphertext, ad);
  }

  private skipReceiving(until: number): void {
    if (!this.receivingChain) return;
    if (until - this.receivingChain.index > MAX_SKIP) {
      throw new Error("e2ee: too many skipped messages");
    }
    while (this.receivingChain.index < until) {
      const { messageKey, next } = DoubleRatchet.advanceChain(this.receivingChain);
      if (this.remotePublic) {
        this.skipped.set(skipKey(this.remotePublic, this.receivingChain.index), messageKey);
        if (this.skipped.size > MAX_SKIP) {
          const oldest = this.skipped.keys().next().value;
          if (oldest !== undefined) this.skipped.delete(oldest);
        }
      }
      this.receivingChain = next;
    }
  }

  private dhRatchet(remotePublic: Uint8Array): void {
    this.previousSendingChainLength = this.sendingChain?.index ?? 0;
    this.remotePublic = remotePublic;

    const receiveDh = diffieHellman(this.selfKeyPair.privateKey, remotePublic);
    const [rootAfterReceive, receivingChainKey] = this.kdfRoot(receiveDh);
    this.rootKey = rootAfterReceive;
    this.receivingChain = { key: receivingChainKey, index: 0 };

    this.selfKeyPair = generateDhKeyPair();
    const sendDh = diffieHellman(this.selfKeyPair.privateKey, remotePublic);
    const [rootAfterSend, sendingChainKey] = this.kdfRoot(sendDh);
    this.rootKey = rootAfterSend;
    this.sendingChain = { key: sendingChainKey, index: 0 };
  }

  /**
   * Serialize the full mutable ratchet state so a session survives a page reload. Every value is
   * base64. This is SECRET state (it contains live chain keys and the self private key) and must
   * only ever be written to device-local encrypted-at-rest storage, never sent to the server.
   */
  serialize(): RatchetState {
    const skipped: Record<string, string> = {};
    for (const [id, key] of this.skipped) skipped[id] = b64(key);
    return {
      rootKey: b64(this.rootKey),
      selfPrivate: b64(this.selfKeyPair.privateKey),
      selfPublic: b64(this.selfKeyPair.publicKey),
      remotePublic: this.remotePublic ? b64(this.remotePublic) : null,
      sendingChain: this.sendingChain
        ? { key: b64(this.sendingChain.key), index: this.sendingChain.index }
        : null,
      receivingChain: this.receivingChain
        ? { key: b64(this.receivingChain.key), index: this.receivingChain.index }
        : null,
      sentCount: this.sentCount,
      receivedCount: this.receivedCount,
      previousSendingChainLength: this.previousSendingChainLength,
      associatedData: b64(this.associatedData),
      skipped
    };
  }

  static deserialize(state: RatchetState): DoubleRatchet {
    const ratchet = new DoubleRatchet(
      unb64(state.rootKey),
      { privateKey: unb64(state.selfPrivate), publicKey: unb64(state.selfPublic) },
      state.remotePublic ? unb64(state.remotePublic) : null,
      unb64(state.associatedData)
    );
    ratchet.sendingChain = state.sendingChain
      ? { key: unb64(state.sendingChain.key), index: state.sendingChain.index }
      : null;
    ratchet.receivingChain = state.receivingChain
      ? { key: unb64(state.receivingChain.key), index: state.receivingChain.index }
      : null;
    ratchet.sentCount = state.sentCount;
    ratchet.receivedCount = state.receivedCount;
    ratchet.previousSendingChainLength = state.previousSendingChainLength;
    for (const [id, key] of Object.entries(state.skipped)) ratchet.skipped.set(id, unb64(key));
    return ratchet;
  }
}
