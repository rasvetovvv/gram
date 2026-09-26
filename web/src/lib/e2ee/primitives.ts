// Low-level cryptographic primitives for GRAM end-to-end encryption.
//
// Everything here is a thin, auditable wrapper over audited @noble implementations and the
// platform's AES-GCM. No key material is ever persisted or logged by this module; callers own
// storage and lifetime. This file deliberately contains no chat, transport or session policy.

import { x25519, ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/hashes/utils.js";

export const DH_PUBLIC_LEN = 32;
export const DH_PRIVATE_LEN = 32;
export const SIGN_PUBLIC_LEN = 32;
export const SIGNATURE_LEN = 64;
export const AEAD_KEY_LEN = 32;
export const AEAD_NONCE_LEN = 12;

export interface KeyPair {
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
}

/** Constant across @noble minor versions: some expose randomSecretKey, older randomPrivateKey. */
function randomX25519Secret(): Uint8Array {
  const utils = x25519.utils as {
    randomSecretKey?: () => Uint8Array;
    randomPrivateKey?: () => Uint8Array;
  };
  if (utils.randomSecretKey) return utils.randomSecretKey();
  if (utils.randomPrivateKey) return utils.randomPrivateKey();
  return randomBytes(DH_PRIVATE_LEN);
}

function randomEd25519Secret(): Uint8Array {
  const utils = ed25519.utils as {
    randomSecretKey?: () => Uint8Array;
    randomPrivateKey?: () => Uint8Array;
  };
  if (utils.randomSecretKey) return utils.randomSecretKey();
  if (utils.randomPrivateKey) return utils.randomPrivateKey();
  return randomBytes(DH_PRIVATE_LEN);
}

/** A fresh X25519 key agreement key pair. */
export function generateDhKeyPair(): KeyPair {
  const privateKey = randomX25519Secret();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/** A fresh Ed25519 signing key pair — used only to sign published prekey bundles. */
export function generateSigningKeyPair(): KeyPair {
  const privateKey = randomEd25519Secret();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export function dhPublicKey(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

/** X25519 shared secret. Throws on an all-zero (low-order) result, per RFC 7748 guidance. */
export function diffieHellman(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const shared = x25519.getSharedSecret(privateKey, publicKey);
  let acc = 0;
  for (const byte of shared) acc |= byte;
  if (acc === 0) throw new Error("e2ee: non-contributory key exchange");
  return shared;
}

export function sign(message: Uint8Array, signingPrivateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, signingPrivateKey);
}

export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  signingPublicKey: Uint8Array
): boolean {
  try {
    return ed25519.verify(signature, message, signingPublicKey);
  } catch {
    return false;
  }
}

export function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  return hkdf(sha256, ikm, salt, info, length);
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha256, key, data);
}

/** AES-256-GCM seal. The 16-byte tag is appended to the ciphertext by @noble. */
export function aeadSeal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  associatedData: Uint8Array
): Uint8Array {
  return gcm(key, nonce, associatedData).encrypt(plaintext);
}

/** AES-256-GCM open. Throws if the tag or associated data does not authenticate. */
export function aeadOpen(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  associatedData: Uint8Array
): Uint8Array {
  return gcm(key, nonce, associatedData).decrypt(ciphertext);
}

export function secureRandom(length: number): Uint8Array {
  return randomBytes(length);
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Constant-time equality; length mismatch returns false without early exit on content. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

export function fromBase64(text: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(text, "base64"));
}
