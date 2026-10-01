// Wire envelopes for secret-group E2EE.
//
// Two opaque JSON shapes travel for a secret group, and the server reads neither:
//   - a GROUP MESSAGE ("gmsg"): the single ciphertext a sender produces, relayed as the group
//     chat's message `content` and fanned out to every member by the server;
//   - a SENDER-KEY DISTRIBUTION ("gskd"): a member's public sender key, sent over the PAIRWISE
//     1:1 secret channel to each other member so they can decrypt that member's group stream.
//
// Both are tagged and versioned so a 1:1 secret chat and a secret group never confuse each other's
// payloads, and so parsing a non-group or malformed body returns null rather than throwing. The
// parsers validate shape only — the cryptographic checks (signature, chain) live in group.ts.

import type { GroupMessage, SenderKeyDistribution } from "./group";

export const GROUP_WIRE_VERSION = 1;

export interface GroupMessageEnvelope {
  readonly v: number;
  readonly t: "gmsg";
  readonly from: string; // sender member id
  readonly msg: GroupMessage;
}

export interface GroupKeyDistributionEnvelope {
  readonly v: number;
  readonly t: "gskd";
  readonly group: string; // the group chat id this sender key is for
  readonly from: string; // the member id whose sender key this is
  readonly skd: SenderKeyDistribution;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGroupMessage(value: unknown): value is GroupMessage {
  if (!isObject(value)) return false;
  return (
    typeof value.chainId === "string" &&
    typeof value.index === "number" &&
    typeof value.ct === "string" &&
    typeof value.sig === "string" &&
    typeof value.nonce === "string"
  );
}

function isDistribution(value: unknown): value is SenderKeyDistribution {
  if (!isObject(value)) return false;
  return (
    typeof value.chainId === "string" &&
    typeof value.chainKey === "string" &&
    typeof value.index === "number" &&
    typeof value.signingPublic === "string"
  );
}

/** Serialize a group message to the string stored as the group chat's message content. */
export function buildGroupMessageWire(from: string, msg: GroupMessage): string {
  const envelope: GroupMessageEnvelope = { v: GROUP_WIRE_VERSION, t: "gmsg", from, msg };
  return JSON.stringify(envelope);
}

/** Parse a group message envelope, or null if the content is not one (shape-checked only). */
export function parseGroupMessageWire(raw: string): GroupMessageEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  if (parsed.v !== GROUP_WIRE_VERSION || parsed.t !== "gmsg") return null;
  if (typeof parsed.from !== "string" || !isGroupMessage(parsed.msg)) return null;
  return parsed as unknown as GroupMessageEnvelope;
}

/** Serialize a sender-key distribution for sending over the pairwise 1:1 secret channel. */
export function buildGroupKeyDistributionWire(
  group: string,
  from: string,
  skd: SenderKeyDistribution
): string {
  const envelope: GroupKeyDistributionEnvelope = {
    v: GROUP_WIRE_VERSION,
    t: "gskd",
    group,
    from,
    skd
  };
  return JSON.stringify(envelope);
}

/** Parse a sender-key distribution envelope, or null if the content is not one. */
export function parseGroupKeyDistributionWire(raw: string): GroupKeyDistributionEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  if (parsed.v !== GROUP_WIRE_VERSION || parsed.t !== "gskd") return null;
  if (
    typeof parsed.group !== "string" ||
    typeof parsed.from !== "string" ||
    !isDistribution(parsed.skd)
  ) {
    return null;
  }
  return parsed as unknown as GroupKeyDistributionEnvelope;
}
