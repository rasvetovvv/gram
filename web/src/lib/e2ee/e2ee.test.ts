import { describe, expect, it } from "vitest";
import {
  aeadOpen,
  aeadSeal,
  constantTimeEqual,
  diffieHellman,
  generateDhKeyPair,
  hkdfSha256,
  secureRandom,
  toBase64
} from "./primitives";
import { createDevice, consumeOneTimePreKey, publishableBundle, rotateSignedPreKey } from "./device";
import { InitiatorSession, ResponderSession } from "./session";
import type { InitiatorSessionState, ResponderSessionState } from "./session";
import {
  createSenderKey,
  distributionFor,
  encryptGroupMessage,
  decryptGroupMessage,
  importDistribution
} from "./group";
import {
  computeSafetyNumber,
  formatSafetyNumber,
  safetyNumberQrPayload,
  verificationStatus
} from "./fingerprint";
import { GroupSession } from "./group-session";
import { GroupKeyCoordinator, type GroupKeyTransport } from "./group-coordinator";
import {
  buildGroupKeyDistributionWire,
  buildGroupMessageWire,
  parseGroupKeyDistributionWire,
  parseGroupMessageWire
} from "./group-wire";
import type { KeyPair } from "./primitives";

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

  it("survives serialize/restore of both sessions (page reload)", () => {
    const { bob, initiator, resolveOtk } = pair();
    const first = initiator.encrypt("before reload");
    const { session: responder } = ResponderSession.accept(bob.material, first, resolveOtk);

    // Round-trip both sessions through their persisted state, as a reload would.
    const initiatorState: InitiatorSessionState = initiator.serialize();
    const responderState: ResponderSessionState = responder.serialize();
    const initiator2 = InitiatorSession.restore(initiatorState);
    const responder2 = ResponderSession.restore(responderState);

    const afterA = initiator2.encrypt("after reload a");
    expect(responder2.decrypt(afterA)).toBe("after reload a");
    const afterB = responder2.encrypt("after reload b");
    expect(initiator2.decrypt(afterB)).toBe("after reload b");
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

  it("rotates the signed prekey without disturbing identity keys or the pool", () => {
    const bob = createDevice(5);
    const beforeSpkId = bob.material.signedPreKeyId;
    const beforeSpkPub = toBase64(bob.material.signedPreKey.publicKey);
    const beforeIdentity = toBase64(bob.material.identityDh.publicKey);
    const beforeSigning = toBase64(bob.material.identitySigning.publicKey);
    const beforePool = bob.oneTimePreKeys.size;

    const rotated = rotateSignedPreKey(bob);

    // Signed prekey advances to a new id and a new public value...
    expect(rotated.signedPreKeyId).toBe(beforeSpkId + 1);
    expect(rotated.signedPreKeyPublic).not.toBe(beforeSpkPub);
    // ...while the long-lived identity and signing keys are untouched.
    expect(toBase64(rotated.material.identityDh.publicKey)).toBe(beforeIdentity);
    expect(toBase64(rotated.material.identitySigning.publicKey)).toBe(beforeSigning);
    // The one-time prekey pool is the caller's, not touched by rotation.
    expect(bob.oneTimePreKeys.size).toBe(beforePool);

    // A session built on the rotated signed prekey still completes the handshake.
    const alice = createDevice(5);
    const bundle = publishableBundle({ ...bob, material: rotated.material }, true);
    const initiator = new InitiatorSession(
      alice.material.identityDh,
      alice.material.identitySigning.publicKey,
      bundle
    );
    const first = initiator.encrypt("post-rotation");
    const { firstPlaintext } = ResponderSession.accept(
      { ...bob.material, ...rotated.material },
      first,
      (id) => consumeOneTimePreKey({ ...bob, material: rotated.material }, id)
    );
    expect(firstPlaintext).toBe("post-rotation");
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

describe("safety numbers (key fingerprints)", () => {
  it("both parties derive the identical 60-digit number regardless of key order", () => {
    const alice = generateDhKeyPair();
    const bob = generateDhKeyPair();
    const fromAlice = computeSafetyNumber(alice.publicKey, bob.publicKey);
    const fromBob = computeSafetyNumber(bob.publicKey, alice.publicKey);
    expect(fromAlice).toBe(fromBob);
    expect(fromAlice).toMatch(/^\d{60}$/);
  });

  it("changes when either identity key changes (a swapped key is visible)", () => {
    const alice = generateDhKeyPair();
    const bob = generateDhKeyPair();
    const mallory = generateDhKeyPair();
    const honest = computeSafetyNumber(alice.publicKey, bob.publicKey);
    const mitm = computeSafetyNumber(alice.publicKey, mallory.publicKey);
    expect(honest).not.toBe(mitm);
  });

  it("formats into twelve space-separated groups of five", () => {
    const alice = generateDhKeyPair();
    const bob = generateDhKeyPair();
    const formatted = formatSafetyNumber(computeSafetyNumber(alice.publicKey, bob.publicKey));
    const groups = formatted.split(" ");
    expect(groups).toHaveLength(12);
    for (const group of groups) expect(group).toMatch(/^\d{5}$/);
  });

  it("produces an order-independent QR payload both devices agree on", () => {
    const alice = generateDhKeyPair();
    const bob = generateDhKeyPair();
    const fromAlice = safetyNumberQrPayload(alice.publicKey, bob.publicKey);
    const fromBob = safetyNumberQrPayload(bob.publicKey, alice.publicKey);
    expect(fromAlice).toBe(fromBob);
    expect(fromAlice.startsWith("GRAM-SN:v1:")).toBe(true);
  });

  it("tracks verification state: unverified, verified, then changed", () => {
    const bob = generateDhKeyPair();
    const bobKey = toBase64(bob.publicKey);
    // Never confirmed anything yet.
    expect(verificationStatus(null, bobKey)).toBe("unverified");
    // Confirmed bob's key and it still matches.
    expect(verificationStatus(bobKey, bobKey)).toBe("verified");
    // Confirmed bob's key but the current key is now someone else's — a change to warn about.
    const mallory = generateDhKeyPair();
    expect(verificationStatus(bobKey, toBase64(mallory.publicKey))).toBe("changed");
  });
});

describe("GroupSession (multi-member sender-key engine)", () => {
  // A small helper: wire three members so each holds the other two's sender keys.
  function trio() {
    const alice = GroupSession.create();
    const bob = GroupSession.create();
    const carol = GroupSession.create();
    // Each distributes its own key to the other two (over the pairwise channel, mocked as a copy).
    bob.acceptDistribution("alice", alice.ownDistribution());
    carol.acceptDistribution("alice", alice.ownDistribution());
    alice.acceptDistribution("bob", bob.ownDistribution());
    carol.acceptDistribution("bob", bob.ownDistribution());
    alice.acceptDistribution("carol", carol.ownDistribution());
    bob.acceptDistribution("carol", carol.ownDistribution());
    return { alice, bob, carol };
  }

  it("fans one ciphertext out: both other members decrypt it", () => {
    const { alice, bob, carol } = trio();
    const message = alice.encrypt("hi group");
    expect(bob.decrypt("alice", message)).toBe("hi group");
    expect(carol.decrypt("alice", message)).toBe("hi group");
  });

  it("decrypts each sender under their own key, in and out of order", () => {
    const { alice, bob, carol } = trio();
    const a0 = alice.encrypt("a0");
    const a1 = alice.encrypt("a1");
    const b0 = bob.encrypt("b0");
    expect(carol.decrypt("alice", a1)).toBe("a1");
    expect(carol.decrypt("alice", a0)).toBe("a0");
    expect(carol.decrypt("bob", b0)).toBe("b0");
  });

  it("refuses to decrypt a sender whose key was never imported", () => {
    const alice = GroupSession.create();
    const outsider = GroupSession.create();
    const message = outsider.encrypt("intruder");
    expect(() => alice.decrypt("outsider", message)).toThrow();
  });

  it("rotation drops a removed member: their later messages no longer decrypt", () => {
    const { alice, bob, carol } = trio();
    // Carol is removed. Alice rotates and keeps only bob, then redistributes to bob.
    alice.rotate(["bob"]);
    bob.acceptDistribution("alice", alice.ownDistribution());
    const afterRotation = alice.encrypt("secret after carol left");
    // Bob (still in the group) decrypts fine with the fresh key.
    expect(bob.decrypt("alice", afterRotation)).toBe("secret after carol left");
    // Carol still holds alice's OLD sender key; the new generation does not match it.
    expect(() => carol.decrypt("alice", afterRotation)).toThrow();
  });

  it("survives serialize/restore (page reload) and keeps decrypting", () => {
    const { alice, bob } = trio();
    const before = alice.encrypt("before reload");
    expect(bob.decrypt("alice", before)).toBe("before reload");

    const restoredBob = GroupSession.restore(bob.serialize());
    const after = alice.encrypt("after reload");
    expect(restoredBob.decrypt("alice", after)).toBe("after reload");
  });

  it("rotateOwnKey locks out a departed member but keeps remaining members' history", () => {
    const { alice, bob, carol } = trio();
    // Carol leaves. Alice rotates only her OWN key and re-shares it with bob (not carol).
    const beforeLeave = bob.encrypt("bob before");
    alice.rotateOwnKey();
    bob.acceptDistribution("alice", alice.ownDistribution());
    const afterLeave = alice.encrypt("alice after carol left");
    // Bob reads alice's new messages with the fresh key.
    expect(bob.decrypt("alice", afterLeave)).toBe("alice after carol left");
    // Alice can still read bob's history: rotateOwnKey kept bob's imported key.
    expect(alice.decrypt("bob", beforeLeave)).toBe("bob before");
    // Carol, holding only alice's OLD key, cannot read the new generation.
    expect(() => carol.decrypt("alice", afterLeave)).toThrow();
  });
});

describe("group wire envelopes", () => {
  it("round-trips a group message envelope and binds the sender", () => {
    const alice = GroupSession.create();
    // Distribute first (as the real flow does), then encrypt — the receiver starts at index 0.
    const bob = GroupSession.create();
    bob.acceptDistribution("alice", alice.ownDistribution());
    const message = alice.encrypt("wire test");
    const wire = buildGroupMessageWire("alice", message);
    const parsed = parseGroupMessageWire(wire);
    expect(parsed).not.toBeNull();
    expect(parsed?.from).toBe("alice");
    expect(bob.decrypt(parsed!.from, parsed!.msg)).toBe("wire test");
  });

  it("round-trips a sender-key distribution envelope", () => {
    const alice = GroupSession.create();
    const wire = buildGroupKeyDistributionWire("chat-1", "alice", alice.ownDistribution());
    const parsed = parseGroupKeyDistributionWire(wire);
    expect(parsed).not.toBeNull();
    expect(parsed?.group).toBe("chat-1");
    expect(parsed?.from).toBe("alice");
    // The parsed distribution is importable and decrypts alice's stream.
    const bob = GroupSession.create();
    bob.acceptDistribution(parsed!.from, parsed!.skd);
    const message = alice.encrypt("via wire skd");
    expect(bob.decrypt("alice", message)).toBe("via wire skd");
  });

  it("rejects cross-type and malformed payloads without throwing", () => {
    const alice = GroupSession.create();
    const msgWire = buildGroupMessageWire("alice", alice.encrypt("x"));
    const skdWire = buildGroupKeyDistributionWire("c", "alice", alice.ownDistribution());
    // A message wire is not a distribution and vice versa.
    expect(parseGroupKeyDistributionWire(msgWire)).toBeNull();
    expect(parseGroupMessageWire(skdWire)).toBeNull();
    // Garbage and plain text parse to null, never an exception.
    expect(parseGroupMessageWire("not json")).toBeNull();
    expect(parseGroupKeyDistributionWire("{}")).toBeNull();
    expect(parseGroupMessageWire(JSON.stringify({ v: 1, t: "gmsg" }))).toBeNull();
  });
});

describe("GroupKeyCoordinator (distribution bookkeeping)", () => {
  // A transport that records every (member, wire) it was asked to send, and can be made to fail.
  function recordingTransport() {
    const sends: Array<{ memberId: string; wire: string }> = [];
    let failNext = false;
    const transport: GroupKeyTransport = {
      async sendToMember(memberId, wire) {
        if (failNext) {
          failNext = false;
          throw new Error("transport down");
        }
        sends.push({ memberId, wire });
      }
    };
    return { sends, transport, failOnce: () => (failNext = true) };
  }

  it("sends to each member once and never to self", async () => {
    const { sends, transport } = recordingTransport();
    const coord = new GroupKeyCoordinator("me", "wire-gen-1", transport);
    const sent = await coord.distributeTo(["me", "bob", "carol"]);
    expect(sent.sort()).toEqual(["bob", "carol"]);
    // A second pass sends to nobody already seeded (and a newly added member is picked up).
    const again = await coord.distributeTo(["bob", "carol", "dave"]);
    expect(again).toEqual(["dave"]);
    expect(sends.map((s) => s.memberId).sort()).toEqual(["bob", "carol", "dave"]);
  });

  it("retries a member whose send failed (not marked seeded on failure)", async () => {
    const { transport, failOnce } = recordingTransport();
    const coord = new GroupKeyCoordinator("me", "wire-gen-1", transport);
    failOnce();
    await expect(coord.distributeTo(["bob"])).rejects.toThrow();
    expect(coord.hasSeeded("bob")).toBe(false);
    // The retry succeeds and marks bob seeded.
    const sent = await coord.distributeTo(["bob"]);
    expect(sent).toEqual(["bob"]);
    expect(coord.hasSeeded("bob")).toBe(true);
  });

  it("rotation re-seeds everyone with the fresh generation", async () => {
    const { sends, transport } = recordingTransport();
    const coord = new GroupKeyCoordinator("me", "wire-gen-1", transport);
    await coord.distributeTo(["bob", "carol"]);
    coord.onRotated("wire-gen-2");
    // After rotation nobody is seeded, so a distribute re-sends the NEW wire to the remaining set.
    const sent = await coord.distributeTo(["bob"]);
    expect(sent).toEqual(["bob"]);
    const lastSend = sends[sends.length - 1];
    expect(lastSend.wire).toBe("wire-gen-2");
  });
});
