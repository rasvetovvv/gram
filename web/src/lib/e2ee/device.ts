// Device key material generation and one-time prekey pool management for GRAM E2EE.
//
// A "device" owns: a long-lived X25519 identity DH key, a long-lived Ed25519 signing key, a
// periodically rotated signed prekey, and a pool of single-use one-time prekeys. PRIVATE halves
// never leave the device; only the public bundle (see x3dh.buildBundle) is published to the
// server. Persistence of private keys is the caller's concern (e.g. IndexedDB, non-extractable
// where possible); this module only mints and formats the values.

import {
  generateDhKeyPair,
  generateSigningKeyPair,
  toBase64,
  type KeyPair
} from "./primitives";
import { buildBundle, signPreKey, type DeviceKeyMaterial, type PublishedBundle } from "./x3dh";

export interface OneTimePreKey {
  readonly id: number;
  readonly keyPair: KeyPair;
}

export interface DeviceState {
  readonly material: DeviceKeyMaterial;
  readonly oneTimePreKeys: Map<number, KeyPair>;
  nextOneTimePreKeyId: number;
}

const DEFAULT_ONE_TIME_PREKEY_COUNT = 50;

/** Create fresh device key material and an initial pool of one-time prekeys. */
export function createDevice(oneTimePreKeyCount = DEFAULT_ONE_TIME_PREKEY_COUNT): DeviceState {
  const material: DeviceKeyMaterial = {
    identityDh: generateDhKeyPair(),
    identitySigning: generateSigningKeyPair(),
    signedPreKey: generateDhKeyPair(),
    signedPreKeyId: 1
  };
  const state: DeviceState = {
    material,
    oneTimePreKeys: new Map(),
    nextOneTimePreKeyId: 1
  };
  replenishOneTimePreKeys(state, oneTimePreKeyCount);
  return state;
}

/** Mint `count` new one-time prekeys into the pool and return their public halves for publishing. */
export function replenishOneTimePreKeys(
  state: DeviceState,
  count: number
): Array<{ id: number; publicKey: string }> {
  const minted: Array<{ id: number; publicKey: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const id = state.nextOneTimePreKeyId;
    state.nextOneTimePreKeyId += 1;
    const keyPair = generateDhKeyPair();
    state.oneTimePreKeys.set(id, keyPair);
    minted.push({ id, publicKey: toBase64(keyPair.publicKey) });
  }
  return minted;
}

/** Look up (and remove) a one-time prekey the initiator consumed. Single-use by construction. */
export function consumeOneTimePreKey(state: DeviceState, id: number): KeyPair | null {
  const keyPair = state.oneTimePreKeys.get(id);
  if (!keyPair) return null;
  state.oneTimePreKeys.delete(id);
  return keyPair;
}

/** The public bundle to publish, optionally advertising one available one-time prekey. */
export function publishableBundle(
  state: DeviceState,
  advertiseOneTimePreKey = true
): PublishedBundle {
  if (advertiseOneTimePreKey) {
    const first = state.oneTimePreKeys.entries().next();
    if (!first.done) {
      const [id, keyPair] = first.value;
      return buildBundle(state.material, { id, keyPair });
    }
  }
  return buildBundle(state.material);
}

/** Rotate the signed prekey (call periodically, e.g. weekly). Returns the new signed public info. */
export function rotateSignedPreKey(state: DeviceState): {
  material: DeviceKeyMaterial;
  signedPreKeyId: number;
  signedPreKeyPublic: string;
  signature: string;
} {
  const rotated: DeviceKeyMaterial = {
    identityDh: state.material.identityDh,
    identitySigning: state.material.identitySigning,
    signedPreKey: generateDhKeyPair(),
    signedPreKeyId: state.material.signedPreKeyId + 1
  };
  // Callers hold DeviceState.material as readonly; return the rotated material for them to store.
  const signature = signPreKey(rotated);
  return {
    material: rotated,
    signedPreKeyId: rotated.signedPreKeyId,
    signedPreKeyPublic: toBase64(rotated.signedPreKey.publicKey),
    signature: toBase64(signature)
  };
}
