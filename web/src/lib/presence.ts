/**
 * How a person's presence is worded, in one place.
 *
 * Three states rather than two: online, hidden by their own setting, and last seen at a known
 * time. The hidden case must not fall back to "не в сети" — that would be a claim about
 * someone who has simply asked not to be tracked.
 */
import type { User } from "./types";
import { relativeTime } from "./utils";

/** Profile-style, matching the reference's own line: «В сети» / «Был(а) в сети 5 мин назад». */
export function presenceText(user: Pick<User, "is_online" | "last_seen_at" | "presence_hidden">) {
  if (user.is_online) return "В сети";
  if (user.presence_hidden) return "Был(а) в сети недавно";
  if (user.last_seen_at) return `Был(а) в сети ${relativeTime(user.last_seen_at)}`;
  return "Не в сети";
}

/** Chat-header style: lower case and short, since it sits under a name. */
export function presenceShort(user: Pick<User, "is_online" | "last_seen_at" | "presence_hidden">) {
  if (user.is_online) return "в сети";
  if (user.presence_hidden) return "был(а) недавно";
  if (user.last_seen_at) return `был(а) ${relativeTime(user.last_seen_at)}`;
  return "";
}

/** The owner's own status, ready to sit beside their name. */
export function statusLine(user: Pick<User, "status_emoji" | "status_text">) {
  const parts = [user.status_emoji, user.status_text].filter(Boolean);
  return parts.length ? parts.join(" ") : "";
}
