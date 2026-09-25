"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Message } from "@/lib/types";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";

/** The reference's own quick set, in its order. */
export const QUICK_REACTIONS = ["❤️", "😂", "👍", "👏", "🎮", "🔥"];

/** One reaction per person, so the mutation is a toggle rather than an add. */
export function useReaction(chatId: string, messageId: string) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  return useMutation({
    mutationFn: (emoji: string) => api.toggleReaction(chatId, messageId, emoji),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages", chatId] }),
    onError: (error: Error) =>
      notify("Couldn't add reaction", { variant: "error", detail: error.message })
  });
}

/** Emoji row pinned above the message actions, the way the reference attaches it. */
export function ReactionPicker({
  onPick,
  disabled
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-0.5 rounded-full bg-[#17171d] p-1 shadow-[0_10px_30px_rgba(0,0,0,.45)]">
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          disabled={disabled}
          aria-label={`React with ${emoji}`}
          onClick={() => onPick(emoji)}
          className="grid size-9 place-items-center rounded-full border-0 bg-transparent text-[20px] leading-none transition hover:bg-white/[0.08] active:scale-90 disabled:opacity-50"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/**
 * Chips under a bubble. The reference shows the emoji with a small avatar of who reacted,
 * so a one-person reaction reads as "who", not just "how many".
 */
export function ReactionChips({
  message,
  chatId
}: {
  message: Message;
  chatId: string;
}) {
  const reaction = useReaction(chatId, message.id);
  const reactions = message.reactions ?? [];
  if (!reactions.length) return null;
  return (
    <div className={`mt-0.5 flex flex-wrap gap-1 ${message.is_mine ? "justify-end" : ""}`}>
      {reactions.map((item) => (
        <button
          key={item.emoji}
          type="button"
          onClick={() => reaction.mutate(item.emoji)}
          disabled={reaction.isPending}
          aria-label={`${item.mine ? "Remove reaction" : "Add reaction"} ${item.emoji}`}
          aria-pressed={item.mine}
          className="flex h-7 items-center gap-1 rounded-full border-0 px-1.5 text-[13px] transition active:scale-95 disabled:opacity-60"
          style={{
            background: item.mine ? "var(--primary)" : "rgba(0,0,0,.35)",
            color: "#ffffff"
          }}
        >
          <span className="text-[15px] leading-none">{item.emoji}</span>
          {item.count > 1 ? (
            <span className="font-semibold tabular-nums">{item.count}</span>
          ) : (
            item.users[0] && (
              <UserAvatar
                src={item.users[0].avatar_url}
                name={item.users[0].display_name}
                size={18}
                ringColor="transparent"
              />
            )
          )}
        </button>
      ))}
    </div>
  );
}