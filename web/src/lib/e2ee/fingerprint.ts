// Safety numbers (key fingerprints) for GRAM secret chats.
//
// A safety number lets the two people in a secret chat confirm, out of band, that no one is
// sitting in the middle swapping keys. It is derived ONLY from the two long-lived identity public
// keys, so it is stable for the life of both devices' identities and changes if either identity
// key changes (a re-install, a new device, or a man-in-the-middle). Both sides compute the exact
// same 60-digit number because the two per-party fingerprints are concatenated in sorted order.
//
// The construction mirrors Signal's NumericFingerprintGenerator: an iterated SHA-512 over the
// identity key, truncated to 30 bytes, encoded as six 5-digit chunks per party. Nothing secret is
// involved — these are public keys — so this module can run anywhere and persist nothing.

import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes, toBase64, type KeyPair } from "./primitives";

// Signal uses 5200 iterations; matching it keeps the brute-force cost of forging a colliding
// number far above any value an attacker gets from a 60-digit human-comparable string.
const ITERATIONS = 5200;
// A 2-byte version prefix, so a future format change produces visibly different numbers.
const VERSION = new Uint8Array([0x00, 0x00]);
const CHUNKS_PER_PARTY = 6; // 6 chunks × 5 digits = a 30-digit half per party
const DIGITS_PER_CHUNK = 5;
const GROUP_SIZE = 5; // the 60 digits are shown in twelve groups of five

/**
 * One party's 30-digit fingerprint half: iterated SHA-512 over its identity key, then six 5-digit
 * chunks taken from the first 30 bytes of the final hash.
 */
function partyFingerprint(identityKey: Uint8Array): string {
  let hash = sha512(concatBytes(VERSION, identityKey, identityKey));
  for (let i = 0; i < ITERATIONS; i += 1) {
    hash = sha512(concatBytes(hash, identityKey));
  }
  let digits = "";
  for (let chunk = 0; chunk < CHUNKS_PER_PARTY; chunk += 1) {
    digits += encodeChunk(hash, chunk * 5);
  }
  return digits;
}

/** Read five bytes as a big-endian 40-bit integer and reduce to a zero-padded 5-digit string. */
function encodeChunk(hash: Uint8Array, offset: number): string {
  // Plain multiplication, not bit shifts: a 40-bit value overflows JavaScript's 32-bit bitwise ops.
  const value =
    hash[offset] * 0x100000000 +
    hash[offset + 1] * 0x1000000 +
    hash[offset + 2] * 0x10000 +
    hash[offset + 3] * 0x100 +
    hash[offset + 4];
  return (value % 100000).toString().padStart(DIGITS_PER_CHUNK, "0");
}

/**
 * The 60-digit safety number shared by both parties. The two 30-digit halves are concatenated in
 * ascending lexical order so the result is identical regardless of which key is "local" — exactly
 * the property that lets both people read out the same number.
 */
export function computeSafetyNumber(identityA: Uint8Array, identityB: Uint8Array): string {
  const a = partyFingerprint(identityA);
  const b = partyFingerprint(identityB);
  return a <= b ? a + b : b + a;
}

/** Group the 60-digit number into twelve space-separated blocks of five for display. */
export function formatSafetyNumber(number: string): string {
  const groups: string[] = [];
  for (let i = 0; i < number.length; i += GROUP_SIZE) {
    groups.push(number.slice(i, i + GROUP_SIZE));
  }
  return groups.join(" ");
}

/**
 * A deterministic, order-independent string encoding both identity keys, used as the QR payload.
 * Two devices that share the same key pair render a byte-identical QR, so holding the phones side
 * by side is a valid visual comparison even without a camera scanner.
 */
export function safetyNumberQrPayload(identityA: Uint8Array, identityB: Uint8Array): string {
  const [first, second] = [identityA, identityB].sort(compareBytes);
  return `GRAM-SN:v1:${toBase64(concatBytes(first, second))}`;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export type { KeyPair };
