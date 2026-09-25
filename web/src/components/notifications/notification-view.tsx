"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AtSign,
  Bell,
  BellDot,
  BrushCleaning,
  CheckCheck,
  Gift,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Star,
  Trash2,
  UserPlus,
  WalletCards,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Chat, Notification } from "@/lib/types";
import { nameColor } from "@/lib/profile-color";
import { NotificationSettings } from "../profile/settings-switches";
import { FollowRequests } from "./follow-requests";
import { BottomSheet } from "../ui/bottom-sheet";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";

/**
 * The badge that sits on the actor's avatar, following the reference: a 20px circle in the
 * event's own colour, ringed to lift it off the photo.
 */
const KIND: Record<
  string,
  { icon: typeof Bell; background: string; verb: string }
> = {
  message: { icon: MessageCircle, background: "var(--primary)", verb: "messaged you" },
  follow: { icon: UserPlus, background: "var(--link)", verb: "followed you" },
  follow_request: {
    icon: UserPlus,
    background: "var(--link)",
    verb: "wants to follow you"
  },
  like: { icon: Heart, background: "#ec4899", verb: "liked your post" },
  comment: {
    icon: MessageCircle,
    background: "var(--primary)",
    verb: "commented on your post"
  },
  gift: { icon: Gift, background: "#f59e0b", verb: "sent a gift" },
  stars: { icon: Star, background: "var(--stars)", verb: "sent stars" },
  subscription: { icon: WalletCards, background: "#10b981", verb: "subscribed" },
  username: { icon: AtSign, background: "var(--identity)", verb: "username" },
  community: { icon: Bell, background: "var(--primary)", verb: "community activity" },
  system: { icon: Bell, background: "var(--primary)", verb: "" }
};

/** One row shape for the list's own menu; 44px tall so a thumb can hit it. */
const MENU_ITEM =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-[15px] outline-none transition-colors focus:bg-[#27272a] data-[disabled]:pointer-events-none data-[disabled]:opacity-40";

/** The reference writes minutes as "1m", not "1 min" — the column is narrow. */
function compactTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(new Date(iso));
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" })
  }).format(date);
}

/**
 * What happened, split into a sentence and a quote.
 *
 * The server stores a message notice as "Name: text". Printing that whole string next to the
 * author's avatar said the name twice and buried the message; the name is the row's subject,
 * so the text becomes a quote beneath it.
 */
function describe(item: Notification, chats: Chat[]) {
  if (item.kind === "message") {
    const chat = chats.find((entry) => entry.id === item.entity_id);
    // "Name: text" is how the notice is stored, so the name can be recovered even when the
    // account behind it is gone — reporting a deleted author as "GRAM" would be a lie.
    const split = item.text.indexOf(": ");
    const named = split > 0 && split < 60;
    return {
      name: item.actor?.display_name ?? (named ? item.text.slice(0, split) : "Someone"),
      action: chat?.is_group ? `wrote in "${chat.title ?? "the group"}"` : "messaged you",
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
  const { notify } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Which clear-the-list confirmation is open, if any. */
  const [confirmClear, setConfirmClear] = useState<"all" | "read" | null>(null);
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

  /**
   * Removing a notice, which the list could not do at all before.
   *
   * Optimistic, because a row you asked to delete must not sit there while a request travels —
   * that is what makes people press it again. `onError` puts the list back and says so.
   */
  const removeOne = useMutation({
    mutationFn: (id: string) => api.deleteNotification(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const previous = queryClient.getQueryData<Notification[]>(["notifications"]);
      queryClient.setQueryData<Notification[]>(["notifications"], (current) =>
        current?.filter((item) => item.id !== id)
      );
      return { previous };
    },
    onError: (error: Error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(["notifications"], context.previous);
      notify("Could not delete", { variant: "error", detail: error.message });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });

  /** Empty the list: everything, or only what has already been read. */
  const clear = useMutation({
    mutationFn: (scope: "all" | "read") => api.clearNotifications(scope),
    onSuccess: async (_result, scope) => {
      setConfirmClear(null);
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      notify(scope === "all" ? "Notifications deleted" : "Read notifications deleted", {
        variant: "success"
      });
    },
    onError: (error: Error) =>
      notify("Could not clear", { variant: "error", detail: error.message })
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
    if (item.kind === "follow_request") return;
    if (item.kind === "message" && item.entity_id) router.push(`/chats?chat=${item.entity_id}`);
    else if ((item.kind === "like" || item.kind === "comment") && item.entity_id)
      router.push(`/post/${item.entity_id}`);
    else if (item.actor) router.push(`/u/${item.actor.username}`);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line-structural)] px-4 py-4">
        <h1 className="m-0 text-xl font-extrabold">Notifications</h1>
        <span className="flex items-center gap-1">
          {/* Everything the list can do, in one place — the earlier screen offered only
              "Mark all as read", so there was no answer to "how to delete notifications". */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="List actions"
                className="inline-flex size-11 items-center justify-center rounded-full text-[var(--dim)] transition hover:bg-[var(--surface-raised)] hover:text-[var(--ink)]"
              >
                <MoreHorizontal size={20} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-[110] min-w-[232px] rounded-[16px] bg-[#17171d] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,.55)]"
              >
                <DropdownMenu.Item
                  disabled={!unread}
                  onSelect={() => markAll.mutate()}
                  className={MENU_ITEM}
                >
                  <CheckCheck size={17} />
                  Mark all as read
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  disabled={!items.length}
                  onSelect={() => setConfirmClear("read")}
                  className={MENU_ITEM}
                >
                  <BrushCleaning size={17} />
                  Delete read
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  disabled={!items.length}
                  onSelect={() => setConfirmClear("all")}
                  className={`${MENU_ITEM} text-[var(--danger)]`}
                >
                  <Trash2 size={17} />
                  Clear all
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-[var(--line)]" />
                <DropdownMenu.Item onSelect={() => setSettingsOpen(true)} className={MENU_ITEM}>
                  <BellDot size={17} />
                  Notification settings
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </span>
      </div>
      <BottomSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Notifications"
        description="What to show in the list and in pop-up hints"
      >
        <h2 className="m-0 text-[19px] font-bold">Notifications</h2>
        <NotificationSettings />
      </BottomSheet>

      <FollowRequests />

      <div className="space-y-2 px-2 py-2 sm:px-3">
        <div className="flex items-center justify-between px-2 pb-0.5">
          <p className="m-0 text-sm text-[var(--muted)]">
            Unread: <span className="font-semibold text-white">{unread}</span>
          </p>
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={!unread || markAll.isPending}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-medium transition hover:bg-[var(--surface-raised)] disabled:opacity-40"
          >
            <CheckCheck size={17} />
            Mark all as read
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
            <AnimatePresence initial={false} mode="popLayout">
              {group.map((item) => {
                const kind = KIND[item.kind] ?? KIND.system;
                const BadgeIcon = kind.icon;
                const { name, action, quote } = describe(item, chats);
                return (
                  /* A row is a container, not a button: a delete control cannot be nested inside
                     one, which is why removing a notice had nowhere to live before. */
                  <motion.div
                    key={item.id}
                    layout={reduceMotion ? false : "position"}
                    initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
                    animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                    exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98, transition: { duration: 0.16 } }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="group relative flex items-center gap-1 rounded-[20px] transition-colors hover:bg-[#2b2b30]"
                    style={{
                      background: item.read ? "#1c1c1f" : "#221f2c",
                      boxShadow: item.read ? undefined : "inset 0 0 0 1px rgba(109,95,196,.45)"
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => open(item)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-[20px] py-3.5 pl-4 pr-1 text-left"
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
                          aria-label="New"
                        />
                      ) : null}
                    </button>
                    {/* Always present on touch, revealed on hover with a pointer: a 44px target,
                        which is the smallest thing a thumb hits reliably. */}
                    <button
                      type="button"
                      onClick={() => removeOne.mutate(item.id)}
                      aria-label="Delete notification"
                      title="Delete notification"
                      className="mr-1.5 grid size-11 flex-none place-items-center rounded-full text-[var(--dim)] transition hover:bg-white/10 hover:text-[var(--danger)] focus-visible:opacity-100 active:scale-90 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                    >
                      <X size={17} />
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </section>
        ))}

        {!isLoading && !items.length ? (
          <div className="empty-state">
            <Bell className="mx-auto mb-3" />
            <p>No new notifications</p>
            <button className="quiet-button mt-3" onClick={() => refetch()}>
              Refresh
            </button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmClear !== null}
        onOpenChange={(next) => (next ? undefined : setConfirmClear(null))}
        title={confirmClear === "all" ? "Clear all notifications?" : "Delete read notifications?"}
        description={
          confirmClear === "all"
            ? "The list will empty completely, including unread ones. Deleted notifications cannot be recovered."
            : "Unread ones stay in place — only the notifications you have already opened will be deleted."
        }
        confirmLabel={clear.isPending ? "Deleting…" : confirmClear === "all" ? "Clear" : "Delete"}
        tone="danger"
        error={clear.error?.message}
        pending={clear.isPending}
        onConfirm={() => {
          if (confirmClear) clear.mutate(confirmClear);
        }}
      />
    </>
  );
}
