"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { Check, CheckCheck, CornerUpRight, Gift, Pin, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import type { GiftSummary, Message } from "@/lib/types";
import { GiftDetailTrigger, type RichGift } from "../gifts/gift-gallery";
import { GiftImage, giftArtProps } from "../gifts/gift-image";
import { useToast } from "../ui/toast";
import {
  MessageActionsButton,
  MessageContextMenu,
  useMessageActions,
} from "./message-actions";
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
      label={`Показать подарок ${gift.name} #${gift.serial_number}`}
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
          <GiftImage {...giftArtProps(gift)} size={216} rounded="rounded-none" animate="always" />
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
              {mine ? "Обычный подарок" : "Можно улучшить"}
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
            Подарок · #{gift.serial_number}
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
      notify(`Подарок «${claimed.gift?.name ?? ""}» ваш`, { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось забрать", { variant: "error", detail: error.message })
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
          Забрал(а) {taken.display_name}
        </span>
      ) : mine ? (
        <span
          className="mt-2 block rounded-[12px] bg-white/15 px-2.5 py-1.5 text-center text-[12px] text-white/85"
        >
          Ждёт, кто заберёт
        </span>
      ) : (
        <button
          type="button"
          onClick={() => claim.mutate()}
          disabled={claim.isPending}
          className="mt-2 w-full rounded-[12px] px-2.5 py-2 text-[13px] font-semibold text-white transition active:scale-95 disabled:opacity-60"
          style={{ background: "var(--chat-accent, var(--primary))" }}
        >
          {claim.isPending ? "Забираем…" : "Забрать подарок"}
        </button>
      )}
    </span>
  );
}

/**
 * One message row: the bubble, its reply quote, and both ways into the action list. Kept as
 * its own component because the action list is a hook, and hooks cannot be called from a
 * `.map()` over a changing number of messages.
 */
export function MessageBubble({
  message,
  chatId,
  onReply,
  onEdit,
  onForward,
  onSelect,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  message: Message;
  chatId: string;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onForward: (message: Message) => void;
  onSelect: (message: Message) => void;
  /** Selection mode swaps the action list for a checkbox, as the reference does. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const actions = useMessageActions({ message, chatId, onReply, onEdit, onForward, onSelect });
  const reaction = useReaction(chatId, message.id);
  const reduceMotion = useReducedMotion();
  const time = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(message.created_at));

  // Entrances rise from the sender's side; exits fall away, so a delete is visible.
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
        layout
        {...motionProps}
        className="flex justify-center py-2.5"
      >
        <span className="chat-service-notice">{message.content}</span>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      {...motionProps}
      id={`message-${message.id}`}
      onClick={selectable ? onToggleSelect : undefined}
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
      <div
        className={`flex max-w-[86%] min-w-0 flex-col ${message.is_mine ? "items-end" : "items-start"}`}
      >
        <div
          className={`group flex min-w-0 max-w-full items-center gap-1 ${message.is_mine ? "flex-row" : "flex-row-reverse"}`}
        >
          {/* Actions sit outside the bubble so they never cover the text. */}
          {selectable ? null : (
            <MessageActionsButton
              actions={actions}
              alignEnd={message.is_mine}
              onReact={(emoji) => reaction.mutate(emoji)}
            />
          )}
          <MessageContextMenu
            actions={actions}
            onReact={(emoji) => reaction.mutate(emoji)}
            disabled={selectable}
          >
            <div
              className={`min-w-0 max-w-full rounded-[15px] px-2 pb-[5px] pt-1 text-[16px] leading-6 ${
                message.is_mine
                  ? "rounded-br-[5px] rounded-tr-[5px] bg-[var(--bubble-out)] text-white"
                  : "rounded-bl-[5px] rounded-tl-[5px] bg-[var(--bubble-in)] text-[var(--ink)]"
              }`}
            >
              {message.forwarded_from ? (
                <span
                  className={`mb-1 flex items-center gap-1 text-[12px] font-semibold ${
                    message.is_mine ? "text-white/75" : "text-[var(--primary-strong)]"
                  }`}
                >
                  <CornerUpRight size={12} />
                  Переслано от {message.forwarded_from.display_name}
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
                /* A picture is the message, so it bleeds to the bubble's edges: the negative
                   margins cancel the bubble's own padding without changing its width. The
                   caption below keeps that padding. Opening the original in a tab beats a
                   half-built viewer that cannot zoom. */
                <a
                  href={message.media_url}
                  target="_blank"
                  rel="noreferrer"
                  className="-mx-2 -mt-1 mb-1 block overflow-hidden rounded-[13px]"
                  aria-label="Открыть изображение"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- served from the API's own /media, not the Next image pipeline */}
                  <img
                    src={message.media_url}
                    alt={message.content || "Изображение"}
                    className="block max-h-[340px] w-[260px] max-w-full object-cover"
                  />
                </a>
              ) : null}
              {message.gift ? (
                message.gift_claimable || message.gift_claimed_by ? (
                  <ClaimableGiftCard message={message} chatId={chatId} mine={message.is_mine} />
                ) : (
                  <GiftMessageCard gift={message.gift} mine={message.is_mine} />
                )
              ) : message.content ? (
                <MessageText text={message.content} mine={message.is_mine} />
              ) : null}
              <span
                className={`mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-none ${
                  message.is_mine ? "text-white/70" : "text-[var(--muted)]"
                }`}
              >
                {message.pinned ? <Pin size={11} /> : null}
                {message.edited_at ? "изменено · " : null}
                {time}
                {/* One tick on send, two once everyone else has read past it. */}
                {message.is_mine ? (
                  message.read ? (
                    <CheckCheck size={13} aria-label="Прочитано" />
                  ) : (
                    <Check size={13} aria-label="Отправлено" />
                  )
                ) : null}
              </span>
            </div>
          </MessageContextMenu>
        </div>
        <ReactionChips message={message} chatId={chatId} />
      </div>
    </motion.div>
  );
}
