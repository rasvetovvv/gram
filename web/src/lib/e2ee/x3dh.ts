// X3DH (Extended Triple Diffie-Hellman) initial key agreement for GRAM secret chats.
//
// This is the Signal-style asynchronous handshake: the recipient publishes a signed prekey bundle
// while offline; the initiator combines several X25519 exchanges into one shared secret that both
// sides can later derive independently. The output seeds the Double Ratchet (see ratchet.ts).
//
// The server only ever stores and relays PUBLIC keys and ciphertext. It cannot derive this secret:
// it never holds any of the private keys that feed the DH combinations below.

import {
  DH_PUBLIC_LEN,
  SIGNATURE_LEN,
  concatBytes,
  diffieHellman,
  dhPublicKey,
  generateDhKeyPair,
  hkdfSha256,
  sign,
  verify,
  type KeyPair
} from "./primitives.js";

const X3DH_INFO = new TextEncoder().encode("GRAM-E2EE-v1/x3dh");
// A 32-byte 0xFF prefix on the DH concatenation domain-separates X25519 output from any other
// use of the same keys, exactly as the Signal X3DH specification prescribes.
const KDF_PREFIX = new Uint8Array(32).fill(0xff);
const PREKEY_SIGNATURE_CONTEXT = new TextEncoder().encode("GRAM-E2EE-v1/signed-prekey");

/** The long-lived and medium-lived key material a device keeps privately. */
export interface DeviceKeyMaterial {
  readonly identityDh: KeyPair; // X25519 identity key (also proves identity via the signing key)
  readonly identitySigning: KeyPair; // Ed25519 key that signs the published bundle
  readonly signedPreKey: KeyPair; // X25519 signed prekey, rotated periodically
  readonly signedPreKeyId: number;
}

/** Exactly what a recipient publishes to the server so others can start a session offline. */
export interface PublishedBundle {
  readonly identityDhPublic: Uint8Array;
  readonly identitySigningPublic: Uint8Array;
  readonly signedPreKeyId: number;
  readonly signedPreKeyPublic: Uint8Array;
  readonly signedPreKeySignature: Uint8Array;
  // One-time prekeys are optional but strongly recommended; each is consumed by exactly one
  // initiator. When the pool is empty the handshake still works with slightly weaker forward
  // secrecy against a future identity-key compromise.
  readonly oneTimePreKeyId?: number;
  readonly oneTimePreKeyPublic?: Uint8Array;
}

/** What the server hands an initiator when it fetches-and-consumes a bundle. Same shape. */
export type FetchedBundle = PublishedBundle;

export interface InitiatorResult {
  readonly sharedSecret: Uint8Array; // 32 bytes seeding the ratchet root key
  readonly associatedData: Uint8Array; // AD binding both identities into every ratchet frame
  // The ephemeral public key and consumed prekey ids the recipient needs to derive the same
  // secret. These travel in the first message header, in the clear — they are public keys.
  readonly ephemeralPublic: Uint8Array;
  readonly usedSignedPreKeyId: number;
  readonly usedOneTimePreKeyId?: number;
}

function preKeySigningPayload(signedPreKeyId: number, signedPreKeyPublic: Uint8Array): Uint8Array {
  const id = new Uint8Array(4);
  new DataView(id.buffer).setUint32(0, signedPreKeyId, false);
  return concatBytes(PREKEY_SIGNATURE_CONTEXT, id, signedPreKeyPublic);
}

/** Sign a device's signed prekey so a fetcher can prove it came from the identity key. */
export function signPreKey(material: DeviceKeyMaterial): Uint8Array {
  return sign(
    preKeySigningPayload(material.signedPreKeyId, material.signedPreKey.publicKey),
    material.identitySigning.privateKey
  );
}

/** Build the public bundle a device publishes. One-time prekey is supplied by the caller pool. */
export function buildBundle(
  material: DeviceKeyMaterial,
  oneTimePreKey?: { id: number; keyPair: KeyPair }
): PublishedBundle {
  return {
    identityDhPublic: material.identityDh.publicKey,
    identitySigningPublic: material.identitySigning.publicKey,
    signedPreKeyId: material.signedPreKeyId,
    signedPreKeyPublic: material.signedPreKey.publicKey,
    signedPreKeySignature: signPreKey(material),
    ...(oneTimePreKey
      ? {
          oneTimePreKeyId: oneTimePreKey.id,
          oneTimePreKeyPublic: oneTimePreKey.keyPair.publicKey
        }
      : {})
  };
}

/** Bind both parties' identity keys into the AEAD associated data for the whole session. */
function associatedData(
  initiatorIdentity: Uint8Array,
  recipientIdentity: Uint8Array
): Uint8Array {
  return concatBytes(initiatorIdentity, recipientIdentity);
}

function assertLength(name: string, value: Uint8Array, length: number): void {
  if (value.length !== length) throw new Error(`e2ee: ${name} must be ${length} bytes`);
}

/**
 * Initiator side of X3DH. Verifies the recipient's signed prekey, performs the DH combinations
 * (DH1..DH4) and derives the 32-byte root secret. `identity` and `signing` are the initiator's
 * own long-lived keys.
 */
export function initiateX3DH(
  ownIdentityDh: KeyPair,
  ownIdentitySigningPublic: Uint8Array,
  bundle: FetchedBundle
): InitiatorResult {
  assertLength("identity DH public", bundle.identityDhPublic, DH_PUBLIC_LEN);
  assertLength("signed prekey public", bundle.signedPreKeyPublic, DH_PUBLIC_LEN);
  assertLength("signed prekey signature", bundle.signedPreKeySignature, SIGNATURE_LEN);

  const signatureOk = verify(
    bundle.signedPreKeySignature,
    preKeySigningPayload(bundle.signedPreKeyId, bundle.signedPreKeyPublic),
    bundle.identitySigningPublic
  );
  if (!signatureOk) throw new Error("e2ee: signed prekey signature rejected");

  const ephemeral = generateDhKeyPair();

  // DH1 = DH(IK_a, SPK_b)  binds initiator identity to recipient signed prekey
  // DH2 = DH(EK_a, IK_b)   binds fresh ephemeral to recipient identity
  // DH3 = DH(EK_a, SPK_b)  binds fresh ephemeral to recipient signed prekey
  // DH4 = DH(EK_a, OPK_b)  optional, binds ephemeral to a one-time prekey (best forward secrecy)
  const dh1 = diffieHellman(ownIdentityDh.privateKey, bundle.signedPreKeyPublic);
  const dh2 = diffieHellman(ephemeral.privateKey, bundle.identityDhPublic);
  const dh3 = diffieHellman(ephemeral.privateKey, bundle.signedPreKeyPublic);
  const dhParts = [dh1, dh2, dh3];
  if (bundle.oneTimePreKeyPublic) {
    assertLength("one-time prekey public", bundle.oneTimePreKeyPublic, DH_PUBLIC_LEN);
    dhParts.push(diffieHellman(ephemeral.privateKey, bundle.oneTimePreKeyPublic));
  }

  const ikm = concatBytes(KDF_PREFIX, ...dhParts);
  const sharedSecret = hkdfSha256(ikm, new Uint8Array(32), X3DH_INFO, 32);

  return {
    sharedSecret,
    associatedData: associatedData(ownIdentityDh.publicKey, bundle.identityDhPublic),
    ephemeralPublic: ephemeral.publicKey,
    usedSignedPreKeyId: bundle.signedPreKeyId,
    ...(bundle.oneTimePreKeyId !== undefined
      ? { usedOneTimePreKeyId: bundle.oneTimePreKeyId }
      : {})
  };
}

/** What the recipient reads out of the first inbound message header to complete X3DH. */
export interface ResponderInput {
  readonly initiatorIdentityDhPublic: Uint8Array;
  readonly initiatorEphemeralPublic: Uint8Array;
  readonly usedOneTimePreKey?: KeyPair; // the private one-time prekey the initiator consumed
}

export interface ResponderResult {
  readonly sharedSecret: Uint8Array;
  readonly associatedData: Uint8Array;
}

/**
 * Responder side of X3DH. Re-derives the identical shared secret from its own private keys and
 * the public values the initiator sent. The four DH terms mirror the initiator, with roles
 * swapped so each product is identical.
 */
export function respondX3DH(
  ownIdentityDh: KeyPair,
  ownSignedPreKey: KeyPair,
  input: ResponderInput
): ResponderResult {
  assertLength("initiator identity DH", input.initiatorIdentityDhPublic, DH_PUBLIC_LEN);
  assertLength("initiator ephemeral", input.initiatorEphemeralPublic, DH_PUBLIC_LEN);

  const dh1 = diffieHellman(ownSignedPreKey.privateKey, input.initiatorIdentityDhPublic);
  const dh2 = diffieHellman(ownIdentityDh.privateKey, input.initiatorEphemeralPublic);
  const dh3 = diffieHellman(ownSignedPreKey.privateKey, input.initiatorEphemeralPublic);
  const dhParts = [dh1, dh2, dh3];
  if (input.usedOneTimePreKey) {
    dhParts.push(
      diffieHellman(input.usedOneTimePreKey.privateKey, input.initiatorEphemeralPublic)
    );
  }

  const ikm = concatBytes(KDF_PREFIX, ...dhParts);
  const sharedSecret = hkdfSha256(ikm, new Uint8Array(32), X3DH_INFO, 32);

  return {
    sharedSecret,
    associatedData: associatedData(input.initiatorIdentityDhPublic, ownIdentityDh.publicKey)
  };
}

export { dhPublicKey };
