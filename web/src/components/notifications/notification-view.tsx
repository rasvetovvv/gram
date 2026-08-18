"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AtSign,
  Bell,
  BellDot,
  CheckCheck,
  Gift,
  Heart,
  MessageCircle,
  Star,
  UserPlus,
  WalletCards
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Chat, Notification } from "@/lib/types";
import { nameColor } from "@/lib/profile-color";
import { NotificationSettings } from "../profile/settings-switches";
import { BottomSheet } from "../ui/bottom-sheet";
import { UserAvatar } from "../user-avatar";

/**
 * The badge that sits on the actor's avatar, following the reference: a 20px circle in the
 * event's own colour, ringed to lift it off the photo.
 */
const KIND: Record<
  string,
  { icon: typeof Bell; background: string; verb: string }
> = {
  message: { icon: MessageCircle, background: "var(--primary)", verb: "написал(а) вам" },
  follow: { icon: UserPlus, background: "var(--link)", verb: "подписался(ась) на вас" },
  like: { icon: Heart, background: "#ec4899", verb: "поставил(а) лайк" },
  comment: {
    icon: MessageCircle,
    background: "var(--primary)",
    verb: "прокомментировал(а) вашу публикацию"
  },
  gift: { icon: Gift, background: "#f59e0b", verb: "отправил(а) подарок" },
  stars: { icon: Star, background: "var(--stars)", verb: "перевёл(а) звёзды" },
  subscription: { icon: WalletCards, background: "#10b981", verb: "оформил(а) подписку" },
  username: { icon: AtSign, background: "var(--identity)", verb: "юзернейм" },
  community: { icon: Bell, background: "var(--primary)", verb: "активность в сообществе" },
  system: { icon: Bell, background: "var(--primary)", verb: "" }
};

/** The reference writes minutes as "1м", not "1 мин" — the column is narrow. */
function compactTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60_000));
  if (minutes < 60) return `${minutes}м`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}ч`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}д`;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(iso));
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Сегодня";
  if (date.toDateString() === yesterday.toDateString()) return "Вчера";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" })
  }).format(date);
}

/**
 * What happened, split into a sentence and a quote.
 *
 * The server stores a message notice as "Имя: текст". Printing that whole string next to the
 * author's avatar said the name twice and buried the message; the name is the row's subject,
 * so the text becomes a quote beneath it.
 */
function describe(item: Notification, chats: Chat[]) {
  if (item.kind === "message") {
    const chat = chats.find((entry) => entry.id === item.entity_id);
    // "Имя: текст" is how the notice is stored, so the name can be recovered even when the
    // account behind it is gone — reporting a deleted author as "GRAM" would be a lie.
    const split = item.text.indexOf(": ");
    const named = split > 0 && split < 60;
    return {
      name: item.actor?.display_name ?? (named ? item.text.slice(0, split) : "Кто-то"),
      action: chat?.is_group ? `написал(а) в «${chat.title ?? "группе"}»` : "написал(а) вам",
      quote: named ? item.text.slice(split + 2) : item.text
    };
  }
  const name = item.actor?.display_name ?? "GRAM";
  const known = KIND[item.kind];
  if (known?.verb) return { name, action: known.verb, quote: undefined };
  const trimmed =
    item.actor && item.text.startsWith(item.actor.display_name)
      ? item.text.slice(item.actor.display_name.length).replace(/^[\s,–—-]+/, "")
      : item.text;
  return { name, action: trimmed, quote: undefined };
}

export function NotificationView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: api.notifications
  });
  const { data: chats = [] } = useQuery({ queryKey: ["chats"], queryFn: api.chats });

  const markOne = useMutation({
    mutationFn: (id: string) => api.readNotification(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });
  const markAll = useMutation({
    mutationFn: api.readAllNotifications,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });

  const unread = items.filter((item) => !item.read).length;
  // Grouped by day, in the order the API already returns (newest first).
  const days = useMemo(() => {
    const buckets = new Map<string, Notification[]>();
    for (const item of items) {
      const key = dayLabel(item.created_at);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(item);
      else buckets.set(key, [item]);
    }
    return [...buckets.entries()];
  }, [items]);

  function open(item: Notification) {
    if (!item.read) markOne.mutate(item.id);
    // A notice is a pointer to something: a message leads to its chat, a like or a comment to
    // the post it happened on, a person to their page.
    if (item.kind === "message" && item.entity_id) router.push(`/chats?chat=${item.entity_id}`);
    else if ((item.kind === "like" || item.kind === "comment") && item.entity_id)
      router.push(`/post/${item.entity_id}`);
    else if (item.actor) router.push(`/u/${item.actor.username}`);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line-structural)] px-4 py-4">
        <h1 className="m-0 text-xl font-extrabold">Уведомления</h1>
        <button
          type="button"
          aria-label="Настройки уведомлений"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex size-9 items-center justify-center rounded-full text-[var(--dim)] transition hover:bg-[var(--surface-raised)] hover:text-[var(--ink)]"
        >
          <BellDot size={20} />
        </button>
      </div>
      <BottomSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Уведомления"
        description="Что показывать в списке и во всплывающих подсказках"
      >
        <h2 className="m-0 text-[19px] font-bold">Уведомления</h2>
        <NotificationSettings />
      </BottomSheet>

      <div className="space-y-2 px-2 py-2 sm:px-3">
        <div className="flex items-center justify-between px-2 pb-0.5">
          <p className="m-0 text-sm text-[var(--muted)]">
            Непрочитано: <span className="font-semibold text-white">{unread}</span>
          </p>
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={!unread || markAll.isPending}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-medium transition hover:bg-[var(--surface-raised)] disabled:opacity-40"
          >
            <CheckCheck size={17} />
            Прочитать всё
          </button>
        </div>

        {isLoading
          ? [0, 1, 2, 3].map((index) => (
              <div key={index} className="flex items-center gap-3 rounded-[20px] bg-[#1c1c1f] px-4 py-3.5">
                <div className="skeleton size-10 rounded-full" />
                <div className="min-w-0 flex-1">
                  <div className="skeleton h-4 w-2/3 rounded" />
                  <div className="skeleton mt-2 h-3 w-16 rounded" />
                </div>
              </div>
            ))
          : null}

        {days.map(([label, group]) => (
          <section key={label} className="space-y-2">
            <div className="px-2 pb-0.5 pt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--dim)]">
              {label}
            </div>
            <AnimatePresence initial={false}>
              {group.map((item) => {
                const kind = KIND[item.kind] ?? KIND.system;
                const BadgeIcon = kind.icon;
                const { name, action, quote } = describe(item, chats);
                return (
                  <motion.button
                    key={item.id}
                    layout
                    type="button"
                    onClick={() => open(item)}
                    initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
                    animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                    exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="flex w-full items-center gap-3 rounded-[20px] px-4 py-3.5 text-left transition-colors hover:bg-[#2b2b30]"
                    style={{
                      background: item.read ? "#1c1c1f" : "#221f2c",
                      boxShadow: item.read ? undefined : "inset 0 0 0 1px rgba(109,95,196,.45)"
                    }}
                  >
                    <span className="relative shrink-0">
                      {item.actor ? (
                        <UserAvatar
                          src={item.actor.avatar_url}
                          name={item.actor.display_name}
                          size={40}
                          ringColor="transparent"
                        />
                      ) : (
                        <span className="grid size-10 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--primary-strong)]">
                          <BadgeIcon size={19} />
                        </span>
                      )}
                      <span
                        aria-hidden
                        className="absolute -right-1 bottom-0 grid size-5 place-items-center rounded-full border-2 border-[var(--canvas)] text-white shadow-md"
                        style={{ background: kind.background }}
                      >
                        <BadgeIcon size={11} />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] leading-5">
                        <strong
                          className="font-semibold"
                          style={{ color: nameColor(item.actor?.profile_color) }}
                        >
                          {name}
                        </strong>{" "}
                        <span className="text-[var(--muted)]">{action}</span>
                      </span>
                      {quote ? (
                        <span className="mt-1 block truncate text-[14px] leading-[18px] text-[var(--ink)]">
                          {quote}
                        </span>
                      ) : null}
                      <span className="mt-1 block text-xs text-[var(--dim)]">
                        {compactTime(item.created_at)}
                      </span>
                    </span>
                    {!item.read ? (
                      <span
                        className="size-2 flex-none rounded-full bg-[var(--primary)]"
                        aria-label="Новое"
                      />
                    ) : null}
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </section>
        ))}

        {!isLoading && !items.length ? (
          <div className="empty-state">
            <Bell className="mx-auto mb-3" />
            <p>Новых уведомлений нет</p>
            <button className="quiet-button mt-3" onClick={() => refetch()}>
              Обновить
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
