// Sender-key group encryption for GRAM secret group chats.
//
// A pairwise Double Ratchet does not scale to N members (it would need N-1 ciphertexts per
// message). Instead, each member owns a "sender key": a per-member symmetric chain whose current
// chain key is distributed to every other member ONCE, over the pairwise 1:1 E2EE channel
// (session.ts). Thereafter a member encrypts each message once under its own advancing chain and
// the server fans out that single ciphertext.
//
// Properties:
//   - forward secrecy WITHIN a sender chain: the chain key is hashed forward per message, so a
//     leaked message key does not reveal earlier messages from that sender;
//   - on membership change the group MUST rotate: every member generates a fresh sender key and
//     redistributes it, so a removed member's retained chain key decrypts nothing new. Rotation
//     is the caller's responsibility (see rotateSenderKey); this module gives the primitives.
//
// The server never sees a sender key: distribution rides the pairwise ratchet, and only the
// resulting per-message ciphertext plus the sender's public signing key and counter are relayed.

import {
  AEAD_NONCE_LEN,
  SIGN_PUBLIC_LEN,
  aeadOpen,
  aeadSeal,
  concatBytes,
  generateSigningKeyPair,
  hmacSha256,
  secureRandom,
  sign,
  toBase64,
  fromBase64,
  verify,
  type KeyPair
} from "./primitives";

const CHAIN_ADVANCE_SEED = new Uint8Array([0x02]);
const MESSAGE_KEY_SEED = new Uint8Array([0x01]);
const GROUP_MESSAGE_CONTEXT = new TextEncoder().encode("GRAM-E2EE-v1/group-message");
const MAX_GROUP_SKIP = 2000;

/** The secret a member must distribute to peers to let them decrypt its stream. */
export interface SenderKeyState {
  readonly chainId: Uint8Array; // random id distinguishing this key generation from rotations
  chainKey: Uint8Array; // advances forward every message; forward-secret
  index: number;
  readonly signingKeyPair: KeyPair; // signs each message so peers authenticate the sender
}

/** The public half a peer needs to verify and decrypt a sender's stream. */
export interface SenderKeyDistribution {
  readonly chainId: string;
  readonly chainKey: string; // starting chain key (base64); advances identically on both sides
  readonly index: number;
  readonly signingPublic: string;
}

export interface GroupMessage {
  readonly chainId: string;
  readonly index: number;
  readonly ct: string; // ciphertext + tag (base64)
  readonly sig: string; // Ed25519 signature over (context || chainId || index || ct)
  readonly nonce: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Create a fresh sender key for this member. Call again to rotate on membership change. */
export function createSenderKey(): SenderKeyState {
  return {
    chainId: secureRandom(16),
    chainKey: secureRandom(32),
    index: 0,
    signingKeyPair: generateSigningKeyPair()
  };
}

/** The public distribution message to send to each peer over the pairwise 1:1 channel. */
export function distributionFor(state: SenderKeyState): SenderKeyDistribution {
  return {
    chainId: toBase64(state.chainId),
    chainKey: toBase64(state.chainKey),
    index: state.index,
    signingPublic: toBase64(state.signingKeyPair.publicKey)
  };
}

/** A peer's imported view of another member's sender key. */
export interface ReceiverSenderKey {
  readonly chainId: Uint8Array;
  chainKey: Uint8Array;
  index: number;
  readonly signingPublic: Uint8Array;
  readonly skipped: Map<number, Uint8Array>;
}

export function importDistribution(distribution: SenderKeyDistribution): ReceiverSenderKey {
  const signingPublic = fromBase64(distribution.signingPublic);
  if (signingPublic.length !== SIGN_PUBLIC_LEN) {
    throw new Error("e2ee: bad sender signing key length");
  }
  return {
    chainId: fromBase64(distribution.chainId),
    chainKey: fromBase64(distribution.chainKey),
    index: distribution.index,
    signingPublic,
    skipped: new Map()
  };
}

function advance(chainKey: Uint8Array): { messageKey: Uint8Array; next: Uint8Array } {
  return {
    messageKey: hmacSha256(chainKey, MESSAGE_KEY_SEED),
    next: hmacSha256(chainKey, CHAIN_ADVANCE_SEED)
  };
}

function signingPayload(chainId: Uint8Array, index: number, ciphertext: Uint8Array): Uint8Array {
  const meta = new Uint8Array(4);
  new DataView(meta.buffer).setUint32(0, index, false);
  return concatBytes(GROUP_MESSAGE_CONTEXT, chainId, meta, ciphertext);
}

export function encryptGroupMessage(state: SenderKeyState, plaintext: string): GroupMessage {
  const { messageKey, next } = advance(state.chainKey);
  const index = state.index;
  state.chainKey = next;
  state.index += 1;
  const nonce = secureRandom(AEAD_NONCE_LEN);
  const ciphertext = aeadSeal(
    messageKey,
    nonce,
    textEncoder.encode(plaintext),
    signingPayload(state.chainId, index, nonce)
  );
  const signature = sign(signingPayload(state.chainId, index, ciphertext), state.signingKeyPair.privateKey);
  return {
    chainId: toBase64(state.chainId),
    index,
    ct: toBase64(ciphertext),
    sig: toBase64(signature),
    nonce: toBase64(nonce)
  };
}

export function decryptGroupMessage(receiver: ReceiverSenderKey, message: GroupMessage): string {
  const chainId = fromBase64(message.chainId);
  let same = chainId.length === receiver.chainId.length;
  if (same) for (let i = 0; i < chainId.length; i += 1) same &&= chainId[i] === receiver.chainId[i];
  if (!same) throw new Error("e2ee: sender key generation mismatch (rotate/redistribute)");

  const ciphertext = fromBase64(message.ct);
  const signatureOk = verify(
    fromBase64(message.sig),
    signingPayload(receiver.chainId, message.index, ciphertext),
    receiver.signingPublic
  );
  if (!signatureOk) throw new Error("e2ee: group message signature rejected");

  const nonce = fromBase64(message.nonce);
  const ad = signingPayload(receiver.chainId, message.index, nonce);

  const cached = receiver.skipped.get(message.index);
  if (cached) {
    receiver.skipped.delete(message.index);
    return textDecoder.decode(aeadOpen(cached, nonce, ciphertext, ad));
  }

  if (message.index - receiver.index > MAX_GROUP_SKIP) {
    throw new Error("e2ee: too many skipped group messages");
  }
  while (receiver.index < message.index) {
    const { messageKey, next } = advance(receiver.chainKey);
    receiver.skipped.set(receiver.index, messageKey);
    if (receiver.skipped.size > MAX_GROUP_SKIP) {
      const oldest = receiver.skipped.keys().next().value;
      if (oldest !== undefined) receiver.skipped.delete(oldest);
    }
    receiver.chainKey = next;
    receiver.index += 1;
  }
  const { messageKey, next } = advance(receiver.chainKey);
  receiver.chainKey = next;
  receiver.index += 1;
  return textDecoder.decode(aeadOpen(messageKey, nonce, ciphertext, ad));
}

/** Rotate: discard the old sender key and mint a new generation. Redistribute to remaining peers. */
export function rotateSenderKey(): SenderKeyState {
  return createSenderKey();
}
