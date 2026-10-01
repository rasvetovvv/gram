// Group E2EE orchestration for GRAM secret group chats.
//
// `group.ts` gives the sender-key primitives; this module is the per-member engine that ties them
// together into one group's state:
//   - this member's OWN sender key (its advancing chain + signing key);
//   - a map of every OTHER member's imported sender key (keyed by that member's id);
//   - encrypt once under our own chain (the server fans the single ciphertext out);
//   - decrypt an inbound message by looking up the sender's imported key;
//   - rotate on membership change: mint a fresh own key and drop departed members, so a removed
//     member's retained chain decrypts nothing sent after the rotation.
//
// Distribution of a sender key to peers rides the pairwise 1:1 E2EE channel (session.ts): the
// `SenderKeyDistribution` is serialized to JSON and sent as an ordinary secret-chat message to
// each peer. This module is transport-agnostic — it only produces/consumes those values — so it
// is fully unit-testable without a browser or the server.

import {
  createSenderKey,
  decryptGroupMessage,
  distributionFor,
  encryptGroupMessage,
  importDistribution,
  type GroupMessage,
  type ReceiverSenderKey,
  type SenderKeyDistribution,
  type SenderKeyState
} from "./group";
import { fromBase64, toBase64, type KeyPair } from "./primitives";

/** Persisted, base64 form of this member's own sender key. SECRET — device-local storage only. */
interface StoredOwnSenderKey {
  chainId: string;
  chainKey: string;
  index: number;
  signingPrivate: string;
  signingPublic: string;
}

/** Persisted form of one peer's imported sender key, including retained skipped-message keys. */
interface StoredPeerSenderKey {
  chainId: string;
  chainKey: string;
  index: number;
  signingPublic: string;
  skipped: Record<number, string>;
}

/** Full serialized group state for one member. Device-local encrypted storage only. */
export interface GroupSessionState {
  own: StoredOwnSenderKey;
  peers: Record<string, StoredPeerSenderKey>;
}

function serializeOwn(state: SenderKeyState): StoredOwnSenderKey {
  return {
    chainId: toBase64(state.chainId),
    chainKey: toBase64(state.chainKey),
    index: state.index,
    signingPrivate: toBase64(state.signingKeyPair.privateKey),
    signingPublic: toBase64(state.signingKeyPair.publicKey)
  };
}

function deserializeOwn(stored: StoredOwnSenderKey): SenderKeyState {
  const signingKeyPair: KeyPair = {
    privateKey: fromBase64(stored.signingPrivate),
    publicKey: fromBase64(stored.signingPublic)
  };
  return {
    chainId: fromBase64(stored.chainId),
    chainKey: fromBase64(stored.chainKey),
    index: stored.index,
    signingKeyPair
  };
}

function serializePeer(peer: ReceiverSenderKey): StoredPeerSenderKey {
  const skipped: Record<number, string> = {};
  for (const [index, key] of peer.skipped) skipped[index] = toBase64(key);
  return {
    chainId: toBase64(peer.chainId),
    chainKey: toBase64(peer.chainKey),
    index: peer.index,
    signingPublic: toBase64(peer.signingPublic),
    skipped
  };
}

function deserializePeer(stored: StoredPeerSenderKey): ReceiverSenderKey {
  const skipped = new Map<number, Uint8Array>();
  for (const [index, key] of Object.entries(stored.skipped)) {
    skipped.set(Number(index), fromBase64(key));
  }
  return {
    chainId: fromBase64(stored.chainId),
    chainKey: fromBase64(stored.chainKey),
    index: stored.index,
    signingPublic: fromBase64(stored.signingPublic),
    skipped
  };
}

/**
 * One member's live view of a secret group. Mutable; one instance per (user, group) and never
 * shared across groups. All ciphertext here is opaque to the server, which only relays it.
 */
export class GroupSession {
  private own: SenderKeyState;
  private readonly peers = new Map<string, ReceiverSenderKey>();

  private constructor(own: SenderKeyState) {
    this.own = own;
  }

  /** Start a fresh group membership for this member (mints this member's first sender key). */
  static create(): GroupSession {
    return new GroupSession(createSenderKey());
  }

  /** The distribution message to hand each peer over the pairwise 1:1 channel. */
  ownDistribution(): SenderKeyDistribution {
    return distributionFor(this.own);
  }

  /**
   * Import (or replace) a peer's sender key received over the pairwise channel. Replacing is how a
   * peer's rotation is absorbed: the new generation simply overwrites the old imported key.
   */
  acceptDistribution(memberId: string, distribution: SenderKeyDistribution): void {
    this.peers.set(memberId, importDistribution(distribution));
  }

  /** Whether this member can currently decrypt messages from `memberId` (has their sender key). */
  hasPeer(memberId: string): boolean {
    return this.peers.has(memberId);
  }

  /** Encrypt one plaintext under this member's own advancing chain (single ciphertext for all). */
  encrypt(plaintext: string): GroupMessage {
    return encryptGroupMessage(this.own, plaintext);
  }

  /** Decrypt an inbound group message from `memberId`. Throws if that peer's key is unknown. */
  decrypt(memberId: string, message: GroupMessage): string {
    const peer = this.peers.get(memberId);
    if (!peer) throw new Error("e2ee: no sender key for this group member");
    return decryptGroupMessage(peer, message);
  }

  /**
   * Rotate on a membership change: mint a fresh own sender key and drop any members no longer in
   * the group. After this the caller MUST redistribute `ownDistribution()` to every remaining
   * member, and a removed member — whose retained key is now a stale generation — can decrypt
   * nothing sent under the new chain. `remainingMemberIds` is the set to keep (excluding self).
   */
  rotate(remainingMemberIds: Iterable<string>): void {
    this.own = createSenderKey();
    const keep = new Set(remainingMemberIds);
    for (const memberId of [...this.peers.keys()]) {
      if (!keep.has(memberId)) this.peers.delete(memberId);
    }
  }

  /** SECRET serialized state for device-local persistence. Never send to the server. */
  serialize(): GroupSessionState {
    const peers: Record<string, StoredPeerSenderKey> = {};
    for (const [memberId, peer] of this.peers) peers[memberId] = serializePeer(peer);
    return { own: serializeOwn(this.own), peers };
  }

  static restore(state: GroupSessionState): GroupSession {
    const session = new GroupSession(deserializeOwn(state.own));
    for (const [memberId, stored] of Object.entries(state.peers)) {
      session.peers.set(memberId, deserializePeer(stored));
    }
    return session;
  }
}
