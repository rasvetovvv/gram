import { describe, expect, it } from "vitest";
import {
  aeadOpen,
  aeadSeal,
  constantTimeEqual,
  diffieHellman,
  generateDhKeyPair,
  hkdfSha256,
  secureRandom
} from "./primitives.js";
import { createDevice, consumeOneTimePreKey, publishableBundle } from "./device.js";
import { InitiatorSession, ResponderSession } from "./session.js";
import {
  createSenderKey,
  distributionFor,
  encryptGroupMessage,
  decryptGroupMessage,
  importDistribution
} from "./group.js";
import type { KeyPair } from "./primitives.js";

describe("e2ee primitives", () => {
  it("agrees on the same X25519 shared secret from both sides", () => {
    const a = generateDhKeyPair();
    const b = generateDhKeyPair();
    expect(
      constantTimeEqual(
        diffieHellman(a.privateKey, b.publicKey),
        diffieHellman(b.privateKey, a.publicKey)
      )
    ).toBe(true);
  });

  it("AES-256-GCM round-trips and rejects tampered ciphertext or AD", () => {
    const key = hkdfSha256(secureRandom(32), new Uint8Array(32), new TextEncoder().encode("k"), 32);
    const nonce = secureRandom(12);
    const ad = new TextEncoder().encode("header");
    const ct = aeadSeal(key, nonce, new TextEncoder().encode("secret text"), ad);
    expect(new TextDecoder().decode(aeadOpen(key, nonce, ct, ad))).toBe("secret text");
    const tampered = ct.slice();
    tampered[0] ^= 0x01;
    expect(() => aeadOpen(key, nonce, tampered, ad)).toThrow();
    expect(() => aeadOpen(key, nonce, ct, new TextEncoder().encode("wrong"))).toThrow();
  });

  it("rejects a non-contributory (all-zero) key exchange", () => {
    const a = generateDhKeyPair();
    expect(() => diffieHellman(a.privateKey, new Uint8Array(32))).toThrow();
  });
});

describe("1:1 X3DH + Double Ratchet session", () => {
  function pair() {
    const alice = createDevice(5);
    const bob = createDevice(5);
    const bobBundle = publishableBundle(bob, true);
    const initiator = new InitiatorSession(
      alice.material.identityDh,
      alice.material.identitySigning.publicKey,
      bobBundle
    );
    const resolveOtk = (id: number): KeyPair | null => consumeOneTimePreKey(bob, id);
    return { alice, bob, initiator, resolveOtk, bobBundle };
  }

  it("establishes a session and decrypts the first message via the prelude", () => {
    const { bob, initiator, resolveOtk } = pair();
    const first = initiator.encrypt("hello bob");
    expect(first.prelude).toBeDefined();
    const { session: responder, firstPlaintext } = ResponderSession.accept(
      bob.material,
      first,
      resolveOtk
    );
    expect(firstPlaintext).toBe("hello bob");
    // Reply flows back and forth.
    const reply = responder.encrypt("hi alice");
    expect(initiator.decrypt(reply)).toBe("hi alice");
    const second = initiator.encrypt("how are you");
    expect(responder.decrypt(second)).toBe("how are you");
  });

  it("only the first message carries the prelude", () => {
    const { bob, initiator, resolveOtk } = pair();
    const first = initiator.encrypt("m1");
    ResponderSession.accept(bob.material, first, resolveOtk);
    expect(initiator.encrypt("m2").prelude).toBeUndefined();
  });

  it("consumes the one-time prekey exactly once (second accept fails)", () => {
    const { bob, initiator, resolveOtk } = pair();
    const first = initiator.encrypt("once");
    ResponderSession.accept(bob.material, first, resolveOtk);
    // A replay of the same first envelope can no longer find the consumed one-time prekey.
    expect(() => ResponderSession.accept(bob.material, first, resolveOtk)).toThrow();
  });

  it("decrypts out-of-order messages (skipped message keys retained)", () => {
    const { bob, initiator, resolveOtk } = pair();
    const first = initiator.encrypt("m0");
    const { session: responder } = ResponderSession.accept(bob.material, first, resolveOtk);
    const m1 = initiator.encrypt("m1");
    const m2 = initiator.encrypt("m2");
    const m3 = initiator.encrypt("m3");
    // Deliver 3, then 1, then 2 — all must decrypt correctly.
    expect(responder.decrypt(m3)).toBe("m3");
    expect(responder.decrypt(m1)).toBe("m1");
    expect(responder.decrypt(m2)).toBe("m2");
  });

  it("forward secrecy: an old ratchet message still decrypts after many DH turns", () => {
    const { bob, initiator, resolveOtk } = pair();
    const first = initiator.encrypt("start");
    const { session: responder } = ResponderSession.accept(bob.material, first, resolveOtk);
    // Many turns of the DH ratchet.
    for (let i = 0; i < 20; i += 1) {
      const out = initiator.encrypt(`a${i}`);
      expect(responder.decrypt(out)).toBe(`a${i}`);
      const back = responder.encrypt(`b${i}`);
      expect(initiator.decrypt(back)).toBe(`b${i}`);
    }
  });

  it("a wrong recipient (different device) cannot decrypt", () => {
    const { initiator } = pair();
    const mallory = createDevice(5);
    const first = initiator.encrypt("private");
    const resolveOtk = (id: number): KeyPair | null => consumeOneTimePreKey(mallory, id);
    expect(() => ResponderSession.accept(mallory.material, first, resolveOtk)).toThrow();
  });

  it("works without any one-time prekey (empty pool)", () => {
    const alice = createDevice(0);
    const bob = createDevice(0);
    const bundle = publishableBundle(bob, true);
    expect(bundle.oneTimePreKeyId).toBeUndefined();
    const initiator = new InitiatorSession(
      alice.material.identityDh,
      alice.material.identitySigning.publicKey,
      bundle
    );
    const first = initiator.encrypt("no otk");
    const { firstPlaintext } = ResponderSession.accept(bob.material, first, () => null);
    expect(firstPlaintext).toBe("no otk");
  });
});

describe("group sender-key encryption", () => {
  it("fans one ciphertext out to multiple members who each decrypt it", () => {
    const alice = createSenderKey();
    const distribution = distributionFor(alice);
    const bobView = importDistribution(distribution);
    const carolView = importDistribution(distribution);
    const message = encryptGroupMessage(alice, "hello group");
    expect(decryptGroupMessage(bobView, message)).toBe("hello group");
    expect(decryptGroupMessage(carolView, message)).toBe("hello group");
  });

  it("advances the sender chain and decrypts in order and out of order", () => {
    const alice = createSenderKey();
    const view = importDistribution(distributionFor(alice));
    const m0 = encryptGroupMessage(alice, "g0");
    const m1 = encryptGroupMessage(alice, "g1");
    const m2 = encryptGroupMessage(alice, "g2");
    expect(decryptGroupMessage(view, m2)).toBe("g2");
    expect(decryptGroupMessage(view, m0)).toBe("g0");
    expect(decryptGroupMessage(view, m1)).toBe("g1");
  });

  it("rejects a message forged under a different signing key", () => {
    const alice = createSenderKey();
    const view = importDistribution(distributionFor(alice));
    const forged = encryptGroupMessage(createSenderKey(), "evil");
    // Force the chain id to match so it reaches signature verification.
    const spoofed = { ...forged, chainId: distributionFor(alice).chainId };
    expect(() => decryptGroupMessage(view, spoofed)).toThrow();
  });

  it("a rotated (new-generation) key does not decrypt under the old view", () => {
    const alice = createSenderKey();
    const view = importDistribution(distributionFor(alice));
    const rotated = createSenderKey();
    const message = encryptGroupMessage(rotated, "after rotation");
    expect(() => decryptGroupMessage(view, message)).toThrow();
  });
});
