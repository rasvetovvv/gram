"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import type { Chat, Notification } from "@/lib/types";
import { useToast } from "./ui/toast";
import type { ToastKind } from "./ui/toast";

/**
 * Surfaces newly arrived notifications as Dynamic-Island notices, so a follow, like, gift or
 * message appears without the visitor reloading anything.
 *
 * This rides the notification poll rather than a socket: the reference polls too, so the
 * behaviour matches, though the latency is the poll interval rather than instant.
 */
const POLL_MS = 10_000;

/** Short phrases for the kinds whose action is fixed; anything else keeps the server text. */
const PHRASES: Partial<Record<Notification["kind"], string>> = {
  follow: "подписался(ась) на вас",
  like: "поставил(а) лайк",
  comment: "прокомментировал(а) вашу публикацию",
  subscription: "оформил(а) платную подписку",
  community: "активность в сообществе",
  stars: "перевёл(а) звёзды"
};

/** Which badge sits on the avatar; unmapped kinds fall back to the bell. */
const BADGES: Partial<Record<Notification["kind"], ToastKind>> = {
  message: "message",
  follow: "follow",
  like: "like",
  comment: "message",
  gift: "gift",
  stars: "stars"
};

/**
 * The server writes a message notice as "Имя: текст". The name is shown separately and in
 * bold, so the text is split off and quoted rather than repeated inside the sentence.
 */
function splitMessage(item: Notification) {
  const split = item.text.indexOf(": ");
  const named = split > 0 && split < 60;
  return {
    name: item.actor?.display_name ?? (named ? item.text.slice(0, split) : "Кто-то"),
    quote: named ? item.text.slice(split + 2) : item.text
  };
}

/**
 * Server text reads "Имя сделал(а) то-то". The name is shown separately, so it is stripped
 * from the sentence rather than printed twice.
 */
function describe(item: Notification, chats: Chat[]) {
  const name = item.actor?.display_name;
  if (item.kind === "message") {
    const chat = chats.find((entry) => entry.id === item.entity_id);
    // Naming the group answers "where", which a bare "написал вам" cannot.
    const where = chat?.is_group ? `написал(а) в «${chat.title ?? "группе"}»` : "написал(а) вам";
    const { name: author, quote } = splitMessage(item);
    return { title: author, body: where, quote };
  }
  const phrase = PHRASES[item.kind];
  if (phrase) return { title: name ?? "GRAM", body: phrase, quote: undefined };
  if (name && item.text.startsWith(name)) {
    return {
      title: name,
      body: item.text.slice(name.length).replace(/^[\s,–—-]+/, ""),
      quote: undefined
    };
  }
  return { title: name ?? "GRAM", body: item.text, quote: undefined };
}

export function LiveNotifications() {
  const { notify } = useToast();
  const pathname = usePathname();
  const params = useSearchParams();
  const seen = useRef<Set<string> | null>(null);
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: api.notifications,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false
  });
  // Naming the chat needs the list, which is already cached for the chats screen.
  const { data: chats = [] } = useQuery({ queryKey: ["chats"], queryFn: api.chats, enabled: false });

  /**
   * The conversation on screen right now.
   *
   * Announcing a message from the person you are reading is noise: the message itself is
   * already visible a few centimetres below the notice.
   */
  const openChatId = pathname?.startsWith("/chats") ? params.get("chat") : null;

  useEffect(() => {
    if (!data) return;
    // The first response is history, not news: record it silently.
    if (seen.current === null) {
      seen.current = new Set(data.map((item) => item.id));
      return;
    }
    const fresh = data.filter((item) => !seen.current!.has(item.id));
    fresh.forEach((item) => seen.current!.add(item.id));
    // Oldest first so a burst reads in the order it happened.
    [...fresh].reverse().forEach((item) => {
      if (item.kind === "message" && item.entity_id && item.entity_id === openChatId) return;
      const { title, body, quote } = describe(item, chats);
      notify(title, {
        variant: "event",
        kind: BADGES[item.kind] ?? "system",
        avatarUrl: item.actor?.avatar_url ?? null,
        fallbackInitial: (item.actor?.display_name ?? "G").slice(0, 1),
        detail: body,
        quote,
        href:
          item.kind === "message" && item.entity_id
            ? `/chats?chat=${item.entity_id}`
            : item.actor
              ? `/u/${item.actor.username}`
              : "/notifications"
      });
    });
    // Re-running on a route change is harmless: everything already seen stays in `seen`.
  }, [data, chats, notify, openChatId]);

  return null;
}
