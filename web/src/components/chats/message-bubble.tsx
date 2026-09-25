"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { Check, CheckCheck, Clock, CornerUpRight, Gift, Pin, Sparkles } from "lucide-react";
import Link from "next/link";
import { memo } from "react";
import { api } from "@/lib/api";
import { nameColor } from "@/lib/profile-color";
import type { GiftSummary, Message, User } from "@/lib/types";
import { AdminMark } from "../admin-mark";
import { GiftDetailTrigger, type RichGift } from "../gifts/gift-gallery";
import { GiftImage, giftArtProps } from "../gifts/gift-image";
import { PremiumMark } from "../premium-mark";
import { MessageStoryCard } from "../stories/message-story-card";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";
import { VerifiedMark } from "../verified-mark";
import {
  MessageActionsButton,
  MessageContextMenu,
  useMessageActions,
} from "./message-actions";
import { MessageFile, MessageMedia } from "./message-attachments";
import { MessageText } from "./message-text";
import { ReactionChips, useReaction } from "./message-reactions";

/** Rarity is the one thing a collector reads first, so it gets its own colour. */
const RARITY: Record<string, { label: string; color: string }> = {
  rare: { label: "Rare", color: "#38bdf8" },
  epic: { label: "Epic", color: "#a78bfa" },
  legendary: { label: "Legendary", color: "#fbbf24" },
  mythic: { label: "Mythic", color: "#fb7185" }
};

/**
 * A sent gift renders as a card: its artwork on the collectible's own backdrop, the rarity it
 * rolled, its serial, and the note that came with it.
 *
 * A plain gift says so: it carries no model yet, and upgrading it for stars is a real action
 * its owner has not taken. Tapping opens the full collectible sheet, where that upgrade happens
 * against the actual record.
 */
function GiftMessageCard({ gift, mine }: { gift: GiftSummary; mine: boolean }) {
  const plain = gift.upgraded === false;
  const rarity = RARITY[gift.rarity] ?? RARITY.rare;
  return (
    <GiftDetailTrigger
      gift={gift as RichGift}
      className="block w-[244px] max-w-full border-0 bg-transparent p-0 text-left transition active:scale-[0.98]"
      label={`View gift ${gift.name} #${gift.serial_number}`}
    >
      <span
        className="block overflow-hidden rounded-[14px]"
        style={{
          background: mine ? "rgba(0,0,0,.22)" : "rgba(255,255,255,.05)",
          boxShadow: `inset 0 0 0 1px ${mine ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.08)"}`
        }}
      >
        <span
          className="relative grid place-items-center"
          style={{
            background: `radial-gradient(circle at 50% 34%, ${gift.accent || "#2a2e37"} 0%, ${
              gift.backdrop_edge || "#0b0b0e"
            } 78%)`
          }}
        >
          {/* `hover` rather than `always`: a thread with a dozen gift cards was running a dozen
              Lottie players at once, which is what made scrolling stutter. Pointing at a card —
              or tapping it on a phone — still brings it to life. */}
          <GiftImage {...giftArtProps(gift)} size={216} rounded="rounded-none" animate="hover" />
          {/* The rolled rarity, over the artwork's own darkest corner. */}
          <span
            className="absolute left-2 top-2 rounded-full px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[0.08em]"
            style={{ background: "rgba(0,0,0,.55)", color: rarity.color }}
          >
            {rarity.label}
          </span>
          {plain ? (
            <span className="absolute bottom-2 flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-extrabold text-white">
              <Sparkles size={11} className="text-[var(--stars)]" />
              {mine ? "Standard gift" : "Can be upgraded"}
            </span>
          ) : null}
        </span>

        <span className="block px-2.5 pb-2 pt-1.5">
          <span className="flex items-center gap-1.5">
            <Gift size={13} className={mine ? "text-white/70" : "text-[var(--muted)]"} />
            <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{gift.name}</span>
          </span>
          <span
            className={`mt-0.5 block text-[12px] ${mine ? "text-white/70" : "text-[var(--dim)]"}`}
          >
            Gift · #{gift.serial_number}
          </span>
          {gift.message ? (
            <span
              className={`mt-1.5 block border-l-2 pl-2 text-[12px] italic ${
                mine ? "border-white/35 text-white/80" : "border-[var(--line-strong)] text-[var(--muted)]"
              }`}
            >
              {gift.message}
            </span>
          ) : null}
        </span>
      </span>
    </GiftDetailTrigger>
  );
}

/**
 * A gift dropped into a group is nobody's until a member takes it, so the card carries the
 * button that decides it — and, afterwards, the name of whoever was first.
 */
function ClaimableGiftCard({
  message,
  chatId,
  mine
}: {
  message: Message;
  chatId: string;
  mine: boolean;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const claim = useMutation({
    mutationFn: () => api.claimChatGift(chatId, message.id),
    onSuccess: async (claimed) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", chatId] }),
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["chat-info", chatId] })
      ]);
      notify(`The "${claimed.gift?.name ?? ""}" gift is yours`, { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't claim", { variant: "error", detail: error.message })
  });

  const taken = message.gift_claimed_by;
  return (
    <span className="block w-[244px] max-w-full">
      {message.gift ? <GiftMessageCard gift={message.gift} mine={mine} /> : null}
      {taken ? (
        <span
          className={`mt-2 flex items-center gap-1.5 rounded-[12px] px-2.5 py-1.5 text-[12px] ${
            mine ? "bg-white/15 text-white/85" : "bg-white/[0.07] text-[var(--muted)]"
          }`}
        >
          <Gift size={13} />
          Claimed by {taken.display_name}
        </span>
      ) : mine ? (
        <span
          className="mt-2 block rounded-[12px] bg-white/15 px-2.5 py-1.5 text-center text-[12px] text-white/85"
        >
          Waiting to be claimed
        </span>
      ) : (
        <button
          type="button"
          onClick={() => claim.mutate()}
          disabled={claim.isPending}
          className="mt-2 w-full rounded-[12px] px-2.5 py-2 text-[13px] font-semibold text-white transition active:scale-95 disabled:opacity-60"
          style={{ background: "var(--chat-accent, var(--primary))" }}
        >
          {claim.isPending ? "Claiming…" : "Claim gift"}
        </button>
      )}
    </span>
  );
}

/** One formatter for every bubble: building one per row per render is pure waste. */
const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" });

/**
 * Who wrote this, above their words — the line a group needs and a direct chat does not.
 *
 * Everything here is a link to the author: in a group the name is often the only thing that
 * identifies a stranger, and having to leave for the member list to find out who they are is what
 * made a busy group unreadable. The marks travel with the author for the same reason they do in the
 * feed — a premium star, a staff badge, a tick and the gift worn beside the name all say something
 * about who is speaking, and a chat is exactly where that is worth knowing.
 */
function SenderLine({ author }: { author: User }) {
  return (
    <span className="mb-0.5 flex min-w-0 items-center gap-1">
      {author.is_admin ? <AdminMark size={12} /> : null}
      <Link
        href={`/u/${author.username}`}
        onClick={(event) => event.stopPropagation()}
        className="min-w-0 truncate text-[13px] font-bold leading-4 hover:underline"
        style={{ color: nameColor(author.profile_color) }}
      >
        {author.display_name}
      </Link>
      {author.verified ? <VerifiedMark size={12} /> : null}
      {author.is_premium ? (
        <PremiumMark size={11} profileColor={author.profile_color} />
      ) : null}
      {author.name_gift ? (
        <GiftDetailTrigger
          gift={author.name_gift as RichGift}
          className="inline-grid size-[16px] shrink-0 place-items-center border-0 bg-transparent p-0 transition-transform duration-150 hover:scale-[1.12] active:scale-95"
          label={`View gift ${author.name_gift.name}`}
        >
          <GiftImage {...giftArtProps(author.name_gift)} size={16} bare />
        </GiftDetailTrigger>
      ) : null}
    </span>
  );
}

/**
 * One message row: the bubble, its reply quote, and both ways into the action list. Kept as
 * its own component because the action list is a hook, and hooks cannot be called from a
 * `.map()` over a changing number of messages.
 */
function MessageBubbleRow({
  message,
  chatId,
  onReply,
  onEdit,
  onForward,
  onSelect,
  onReport,
  selectable = false,
  selected = false,
  onToggleSelect,
  showSender = false,
  showAvatar = false,
  showGutter = false,
}: {
  message: Message;
  chatId: string;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onForward: (message: Message) => void;
  onSelect: (message: Message) => void;
  onReport: (message: Message) => void;
  /** Selection mode swaps the action list for a checkbox, as the reference does. */
  selectable?: boolean;
  selected?: boolean;
  /** Takes the id so the prop stays stable across renders and `memo` can do its job. */
  onToggleSelect?: (id: string) => void;
  /** Group chats name the author over the first bubble of each run. */
  showSender?: boolean;
  /** And put their picture beside that first bubble. */
  showAvatar?: boolean;
  /**
   * Keep the picture's width free even where no picture is drawn.
   *
   * Every bubble in a run needs this, not just the one with the avatar: without it the second
   * message of a run started where the avatar does and the first started 40px further in, so a
   * person's own messages did not line up with each other.
   */
  showGutter?: boolean;
}) {
  const actions = useMessageActions({
    message,
    chatId,
    onReply,
    onEdit,
    onForward,
    onSelect,
    onReport
  });
  const reaction = useReaction(chatId, message.id);
  const reduceMotion = useReducedMotion();
  const time = TIME_FORMAT.format(new Date(message.created_at));

  // Entrances rise from the sender's side; exits fall away, so a delete is visible.
  // A bubble that started as an optimistic row is already on screen by the time the server's
  // copy folds in, so its entrance must not play a second time.
  const motionProps = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 10, scale: 0.96 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, scale: 0.94, transition: { duration: 0.14 } },
        transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const },
      };

  if (message.service) {
    return (
      <motion.div
        {...motionProps}
        className="flex justify-center py-2.5"
      >
        <span className="chat-service-notice">{message.content}</span>
      </motion.div>
    );
  }

  return (
    <motion.div
      {...motionProps}
      id={`message-${message.id}`}
      onClick={selectable && onToggleSelect ? () => onToggleSelect(message.id) : undefined}
      className={`flex items-center gap-2 px-0.5 py-[3px] ${
        message.is_mine ? "justify-end" : "justify-start"
      } ${selectable ? "cursor-pointer rounded-[12px]" : ""} ${
        selected ? "bg-[var(--primary)]/12" : ""
      }`}
    >
      {selectable ? (
        <span
          aria-hidden
          className="order-first inline-flex size-6 flex-none items-center justify-center rounded-full border transition"
          style={
            selected
              ? { borderColor: "var(--primary)", background: "var(--primary)", color: "#fff" }
              : { borderColor: "rgba(255,255,255,.22)" }
          }
        >
          {selected ? <Check size={15} /> : null}
        </span>
      ) : null}
      {/* The gutter is held open for the whole run, so consecutive bubbles from one person line up
          under the first instead of starting 40px to its left where no picture is drawn. */}
      {showGutter || showAvatar ? (
        <span className="order-first flex size-8 flex-none items-start self-start">
          {showAvatar ? (
            <Link
              href={`/u/${message.sender.username}`}
              onClick={(event) => event.stopPropagation()}
              aria-label={`${message.sender.display_name}'s profile`}
              className="transition-transform duration-150 hover:scale-105 active:scale-95"
            >
              <UserAvatar
                src={message.sender.avatar_url}
                name={message.sender.display_name}
                size={32}
              />
            </Link>
          ) : null}
        </span>
      ) : null}
      <div
        className={`flex max-w-[86%] min-w-0 flex-col ${message.is_mine ? "items-end" : "items-start"}`}
      >
        <div
          className={`group flex min-w-0 max-w-full items-center gap-1 ${message.is_mine ? "flex-row" : "flex-row-reverse"}`}
        >
          {/* Actions sit outside the bubble so they never cover the text. A row the server has
              not acknowledged has no id anyone can act on, so it offers nothing yet. */}
          {selectable || message.pending ? null : (
            <MessageActionsButton
              actions={actions}
              alignEnd={message.is_mine}
              onReact={(emoji) => reaction.mutate(emoji)}
            />
          )}
          <MessageContextMenu
            actions={actions}
            onReact={(emoji) => reaction.mutate(emoji)}
            disabled={selectable || Boolean(message.pending)}
          >
            <div
              className={`min-w-0 max-w-full rounded-[15px] px-2 pb-[5px] pt-1 text-[16px] leading-6 ${
                message.is_mine
                  ? "rounded-br-[5px] rounded-tr-[5px] bg-[var(--bubble-out)] text-white"
                  : "rounded-bl-[5px] rounded-tl-[5px] bg-[var(--bubble-in)] text-[var(--ink)]"
              }`}
            >
              {showSender ? <SenderLine author={message.sender} /> : null}
              {message.forwarded_from ? (
                <span
                  className={`mb-1 flex items-center gap-1 text-[12px] font-semibold ${
                    message.is_mine ? "text-white/75" : "text-[var(--primary-strong)]"
                  }`}
                >
                  <CornerUpRight size={12} />
                  Forwarded from {message.forwarded_from.display_name}
                </span>
              ) : null}
              {message.reply_to ? (
                <span className="mb-1.5 block border-l-2 border-white/40 pl-2 text-[0.8rem] leading-5 opacity-80">
                  <strong className="block truncate font-semibold">
                    {message.reply_to.sender_name}
                  </strong>
                  <span className="block truncate">
                    {message.reply_to.content}
                  </span>
                </span>
              ) : null}
              {message.media_url ? (
                <MessageMedia
                  url={message.media_url}
                  kind={message.media_kind === "video" ? "video" : "image"}
                  caption={message.content}
                />
              ) : null}
              {message.file_url ? (
                <MessageFile
                  url={message.file_url}
                  name={message.file_name ?? "File"}
                  size={message.file_size}
                  mine={message.is_mine}
                />
              ) : null}
              {message.story ? (
                <MessageStoryCard story={message.story} mine={message.is_mine} />
              ) : null}
              {message.gift ? (
                message.gift_claimable || message.gift_claimed_by ? (
                  <ClaimableGiftCard message={message} chatId={chatId} mine={message.is_mine} />
                ) : (
                  <GiftMessageCard gift={message.gift} mine={message.is_mine} />
                )
              ) : message.content ? (
                <MessageText text={message.content} mine={message.is_mine} />
              ) : message.story || message.media_url || message.file_url ? null : (
                /* Nothing left to draw: a shared story whose author took it down leaves the
                   bubble where it was, and an empty rectangle would read as a bug. */
                <span className={`text-[14px] italic ${message.is_mine ? "text-white/65" : "text-[var(--dim)]"}`}>
                  Message unavailable
                </span>
              )}
              <span
                className={`mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-none ${
                  message.is_mine ? "text-white/70" : "text-[var(--muted)]"
                }`}
              >
                {message.pinned ? <Pin size={11} /> : null}
                {message.edited_at ? "edited · " : null}
                {time}
                {/* A clock while the server has not answered, one tick once it has, two once
                    everyone else has read past it. */}
                {message.is_mine ? (
                  message.pending ? (
                    <Clock size={12} aria-label="Sending" className="opacity-80" />
                  ) : message.read ? (
                    <CheckCheck size={13} aria-label="Read" />
                  ) : (
                    <Check size={13} aria-label="Sent" />
                  )
                ) : null}
              </span>
            </div>
          </MessageContextMenu>
        </div>
        {/* Mounted only when there is something to show: the chips carry a mutation of their
            own, and a hundred bubbles with no reactions were paying for a hundred of them. */}
        {message.reactions?.length ? <ReactionChips message={message} chatId={chatId} /> : null}
      </div>
    </motion.div>
  );
}


/**
 * Memoised on purpose.
 *
 * A thread of a hundred bubbles re-rendered on every keystroke in the composer, and each row
 * carries three mutations, a reaction hook, a context menu and — for a gift — a Lottie player.
 * The parent now passes stable callbacks, so this bails out unless the message itself, its
 * selection state or the chat changed.
 */
export const MessageBubble = memo(MessageBubbleRow);
