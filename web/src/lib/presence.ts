/**
 * How a person's presence is worded, in one place.
 *
 * Three states rather than two: online, hidden by their own setting, and last seen at a known
 * time. The hidden case must not fall back to "offline" — that would be a claim about
 * someone who has simply asked not to be tracked.
 */
import type { User } from "./types";
import { relativeTime } from "./utils";

/** Profile-style, matching the reference's own line: «Online» / «Last seen 5 min ago». */
export function presenceText(user: Pick<User, "is_online" | "last_seen_at" | "presence_hidden">) {
  if (user.is_online) return "Online";
  if (user.presence_hidden) return "Last seen recently";
  if (user.last_seen_at) return `Last seen ${relativeTime(user.last_seen_at)} ago`;
  return "Offline";
}

/** Chat-header style: lower case and short, since it sits under a name. */
export function presenceShort(user: Pick<User, "is_online" | "last_seen_at" | "presence_hidden">) {
  if (user.is_online) return "online";
  if (user.presence_hidden) return "last seen recently";
  if (user.last_seen_at) return `last seen ${relativeTime(user.last_seen_at)} ago`;
  return "";
}

/** The owner's own status, ready to sit beside their name. */
export function statusLine(user: Pick<User, "status_emoji" | "status_text">) {
  const parts = [user.status_emoji, user.status_text].filter(Boolean);
  return parts.length ? parts.join(" ") : "";
}
