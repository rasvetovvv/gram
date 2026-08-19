"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { api } from "@/lib/api";
import type { Post, PostPoll as PollShape } from "@/lib/types";
import { plural } from "@/lib/utils";
import { useToast } from "../ui/toast";

/**
 * The poll a post asks.
 *
 * Before answering, four buttons; after, the same rows with a filled bar behind each and the
 * share of the vote. The counts come from rows on the server, so nothing here is a guess, and a
 * vote is final — the reference's poll is a snapshot, not a survey.
 */
export function PostPoll({ post, poll }: { post: Post; poll: PollShape }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const answered = poll.my_choice !== null && poll.my_choice !== undefined;

  const vote = useMutation({
    mutationFn: (index: number) => api.voteInPoll(post.id, index),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feed"] }),
        queryClient.invalidateQueries({ queryKey: ["post", post.id] }),
        queryClient.invalidateQueries({ queryKey: ["community", post.community_slug, "posts"] })
      ]);
    },
    onError: (error: Error) =>
      notify("Голос не учтён", { variant: "error", detail: error.message })
  });

  const total = poll.total_votes;
  return (
    <div className="mt-2 grid gap-1.5" data-keep-click>
      {poll.options.map((option) => {
        const share = total ? Math.round((option.votes / total) * 100) : 0;
        const mine = poll.my_choice === option.index;
        if (!answered)
          return (
            <button
              key={option.index}
              type="button"
              disabled={vote.isPending}
              onClick={() => vote.mutate(option.index)}
              className="flex min-h-10 items-center justify-center rounded-full border border-[var(--line-strong)] px-4 text-[15px] font-semibold text-[var(--link)] transition hover:bg-white/[0.04] active:scale-[0.99] disabled:opacity-60"
            >
              {option.text}
            </button>
          );
        return (
          <div
            key={option.index}
            className="relative min-h-10 overflow-hidden rounded-[12px] bg-[var(--surface-raised)]"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 transition-[width] duration-500"
              style={{
                width: `${share}%`,
                background: mine ? "var(--primary)" : "rgba(255,255,255,.10)"
              }}
            />
            <span className="relative flex min-h-10 items-center gap-2 px-3 text-[15px]">
              <span className="min-w-0 flex-1 truncate font-semibold">{option.text}</span>
              {mine ? <Check size={15} className="flex-none" /> : null}
              <span className="flex-none tabular-nums text-[var(--muted)]">{share}%</span>
            </span>
          </div>
        );
      })}
      <span className="text-[13px] text-[var(--dim)]">
        {total
          ? `${total} ${plural(total, "голос", "голоса", "голосов")}`
          : "Ещё никто не ответил"}
        {answered ? " · ваш голос учтён" : ""}
      </span>
    </div>
  );
}
