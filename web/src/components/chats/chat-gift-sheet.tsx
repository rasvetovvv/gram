"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Gift as GiftIcon, Star, Users, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Chat, GiftModel } from "@/lib/types";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";
import { GiftCatalogBrowser } from "../gifts/gift-catalog-browser";
import { GiftDesignPanel } from "../gifts/gift-design-panel";

/**
 * Gifting from inside a conversation.
 *
 * A direct chat has one possible recipient, so it asks nothing. A group has two genuinely
 * different intents — a gift for one member, or a drop for whoever takes it first — so it
 * asks which before showing the catalogue. The design sheet, message field and anonymity
 * toggle are the same components the profile purchase uses, so a gift is bought one way.
 */
export function ChatGiftSheet({
  chat,
  open,
  onOpenChange
}: {
  chat: Chat;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [target, setTarget] = useState<string | null>(null);
  const [claimable, setClaimable] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const isGroup = Boolean(chat.is_group);

  const me = useQuery({ queryKey: ["me"], queryFn: api.currentUser, enabled: open });
  const info = useQuery({
    queryKey: ["chat-info", chat.id],
    queryFn: () => api.chatInfo(chat.id),
    enabled: open && isGroup
  });

  const send = useMutation({
    mutationFn: (input: { slug: string; message: string; hideMyName: boolean }) =>
      api.sendChatGift(chat.id, {
        slug: input.slug,
        to_username: claimable ? null : (target ?? chat.participant?.username ?? null),
        claimable,
        message: input.message,
        hide_my_name: input.hideMyName
      }),
    onSuccess: async (message) => {
      setSlug(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", chat.id] }),
        queryClient.invalidateQueries({ queryKey: ["chats"] }),
        queryClient.invalidateQueries({ queryKey: ["chat-info", chat.id] }),
        queryClient.invalidateQueries({ queryKey: ["gift-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["gift-design"] }),
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["stars-wallet"] })
      ]);
      notify(message.gift_claimable ? "Gift is waiting in the chat" : `"${message.gift?.name ?? ""}" sent`, {
        variant: "success",
        detail: message.gift_claimable ? "First to tap gets it" : "The recipient will open it themselves"
      });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Gift wasn't sent", { variant: "error", detail: error.message })
  });

  const balance = me.data?.stars_balance ?? 0;
  const members = (info.data?.members ?? []).filter((entry) => entry.user.id !== me.data?.id);
  const chosen = members.find((entry) => entry.user.username === target);
  // In a group nothing is picked by default: guessing a recipient would spend Stars for them.
  const ready = !isGroup || claimable || Boolean(target);

  function close() {
    onOpenChange(false);
    setSlug(null);
    setTarget(null);
    setClaimable(false);
    send.reset();
  }

  function pick(model: GiftModel) {
    send.reset();
    setSlug(model.slug);
  }

  const recipientName = claimable
    ? "open gift"
    : isGroup
      ? (chosen?.user.display_name ?? null)
      : (chat.participant?.display_name ?? null);

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Send a gift"
      description={
        isGroup
          ? `Gift to "${chat.title ?? "the group"}"`
          : `Gift for ${chat.participant?.display_name ?? ""}`
      }
    >
      {slug ? (
        <GiftDesignPanel
          slug={slug}
          recipientUsername={claimable ? null : (target ?? chat.participant?.username ?? null)}
          recipientName={recipientName}
          recipientAvatar={chosen?.user.avatar_url ?? chat.participant?.avatar_url}
          balance={balance}
          allowMessage
          actionLabel={claimable ? "Leave in the chat" : "Send"}
          submitting={send.isPending}
          errorMessage={send.error?.message}
          onBack={() => setSlug(null)}
          onSubmit={({ message, hideMyName }) => send.mutate({ slug, message, hideMyName })}
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={close}
              className="icon-button !size-9 bg-[#1a1a1f] text-white"
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <Link
              href="/stars"
              className="flex min-h-9 items-center gap-1.5 rounded-full bg-[#1a1a1f] px-3 text-sm font-extrabold text-[var(--stars)]"
            >
              <Star size={16} fill="currentColor" />
              {balance}
            </Link>
          </div>

          <div className="mt-2 flex items-center gap-3">
            {isGroup ? (
              <span className="grid size-16 flex-none place-items-center rounded-[20px] bg-[#1a1a1f] text-[var(--stars)]">
                <Users size={28} />
              </span>
            ) : (
              <UserAvatar
                src={chat.participant?.avatar_url}
                name={chat.participant?.display_name ?? "Chat"}
                size={64}
                ringColor="transparent"
              />
            )}
            <div className="min-w-0">
              <p className="mb-0 text-xl font-extrabold leading-tight tracking-[-0.02em]">
                Send a gift
              </p>
              <p className="mb-0 mt-0.5 truncate text-[15px] text-[var(--muted)]">
                {isGroup ? (chat.title ?? "group") : `for ${chat.participant?.display_name ?? ""}`}
              </p>
            </div>
          </div>

          {isGroup ? (
            <fieldset className="mt-4 border-0 p-0">
              <legend className="mb-2 text-[13px] font-semibold uppercase tracking-[.06em] text-[var(--faint)]">
                To whom
              </legend>
              <button
                type="button"
                onClick={() => {
                  setClaimable(true);
                  setTarget(null);
                }}
                aria-pressed={claimable}
                className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition"
                style={
                  claimable
                    ? { background: "rgba(109,95,196,.22)", boxShadow: "inset 0 0 0 1px var(--primary)" }
                    : { background: "#1a1a1f" }
                }
              >
                <span className="grid size-10 flex-none place-items-center rounded-full bg-black/40 text-[var(--stars)]">
                  <GiftIcon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-[15px]">Open gift</strong>
                  <span className="block text-[13px] text-[var(--muted)]">
                    First to tap the button takes it
                  </span>
                </span>
                {claimable ? <Check size={18} className="flex-none text-[var(--primary-strong)]" /> : null}
              </button>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {members.map((entry) => {
                  const picked = target === entry.user.username;
                  return (
                    <button
                      key={entry.user.id}
                      type="button"
                      onClick={() => {
                        setTarget(entry.user.username);
                        setClaimable(false);
                      }}
                      aria-pressed={picked}
                      className="flex w-16 shrink-0 flex-col items-center gap-1 rounded-[14px] p-1.5 transition"
                      style={picked ? { background: "rgba(109,95,196,.22)" } : undefined}
                    >
                      <UserAvatar
                        src={entry.user.avatar_url}
                        name={entry.user.display_name}
                        size={44}
                        ringColor="transparent"
                      />
                      <span className="w-full truncate text-center text-[11px] text-[var(--muted)]">
                        {entry.user.display_name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {!ready ? (
            <p className="mt-4 rounded-[16px] bg-[#1a1a1f] p-3 text-sm text-[var(--muted)]">
              Choose a member or open the gift for everyone
            </p>
          ) : null}

          <div style={ready ? undefined : { opacity: 0.5, pointerEvents: "none" }}>
            <GiftCatalogBrowser balance={balance} onPick={pick} />
          </div>
        </>
      )}
    </BottomSheet>
  );
}
