// Sender-key distribution coordinator for a secret group.
//
// GroupSession (group-session.ts) owns the crypto; this coordinator owns the BOOKKEEPING of who
// still needs this member's current sender-key generation. Distribution itself is confidential and
// rides each peer's pairwise 1:1 secret channel, so the actual send is injected as a transport —
// this class never touches the network, which keeps it fully unit-testable.
//
// Rules it enforces:
//   - send our key to each member exactly once per generation (no redundant re-sends);
//   - a new member added mid-life only needs the current key, not a rotation;
//   - a rotation (member removed) clears the "already sent" set so every remaining member is
//     re-seeded with the fresh generation.
//
// `selfMemberId` is excluded from every target set: a member never distributes to itself.

/** Confidentially deliver one wire string to one member (over that member's pairwise channel). */
export interface GroupKeyTransport {
  sendToMember(memberId: string, wire: string): Promise<void>;
}

export class GroupKeyCoordinator {
  private readonly selfMemberId: string;
  private readonly transport: GroupKeyTransport;
  // The wire payload carrying our CURRENT sender-key generation (rebuilt on rotation).
  private distributionWire: string;
  // Members we have already handed the current generation to.
  private readonly sentTo = new Set<string>();

  constructor(selfMemberId: string, distributionWire: string, transport: GroupKeyTransport) {
    this.selfMemberId = selfMemberId;
    this.transport = transport;
    this.distributionWire = distributionWire;
  }

  /**
   * Ensure every member in `memberIds` (minus self) holds our current sender key, sending to only
   * those not yet seeded this generation. Returns the member ids actually sent to. A failed send
   * is NOT marked, so a later call retries it.
   */
  async distributeTo(memberIds: Iterable<string>): Promise<string[]> {
    const sent: string[] = [];
    for (const memberId of memberIds) {
      if (memberId === this.selfMemberId) continue;
      if (this.sentTo.has(memberId)) continue;
      await this.transport.sendToMember(memberId, this.distributionWire);
      this.sentTo.add(memberId);
      sent.push(memberId);
    }
    return sent;
  }

  /** Whether this member has already been seeded with the current generation. */
  hasSeeded(memberId: string): boolean {
    return this.sentTo.has(memberId);
  }

  /**
   * Adopt a freshly rotated generation: swap in its distribution wire and forget who was seeded,
   * so the next distributeTo re-sends to everyone still in the group.
   */
  onRotated(distributionWire: string): void {
    this.distributionWire = distributionWire;
    this.sentTo.clear();
  }

  /** Drop a member from the seeded set (e.g. they left before a rotation). */
  forget(memberId: string): void {
    this.sentTo.delete(memberId);
  }
}
