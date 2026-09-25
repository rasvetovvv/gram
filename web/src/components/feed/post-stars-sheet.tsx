"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Post } from "@/lib/types";
import { compactNumber } from "@/lib/utils";
import { BottomSheet } from "../ui/bottom-sheet";
import { TopUpButton } from "../stars/top-up-button";
import { useToast } from "../ui/toast";

const PRESETS = [5, 25, 100, 500];

/**
 * Supporting one post with stars.
 *
 * Aimed at the post rather than at its author in general, which is what lets the card show
 * what it earned: the transfer is recorded against this post in both wallets' ledgers.
 */
export function PostStarsSheet({
  post,
  open,
  onOpenChange
}: {
  post: Post;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [amount, setAmount] = useState(25);
  const [message, setMessage] = useState("");
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const balance = me?.stars_balance ?? 0;

  const send = useMutation({
    mutationFn: () => api.sendStars(post.author.username, amount, message, post.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feed"] }),
        queryClient.invalidateQueries({ queryKey: ["post", post.id] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["stars"] })
      ]);
      notify(`Sent ${amount} ★`, {
        variant: "success",
        detail: `@${post.author.username} will be notified`
      });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Couldn't send", { variant: "error", detail: error.message })
  });

  const short = amount > balance;
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Support with stars"
      description={`Post by @${post.author.username}`}
      footer={
        short ? (
          // An empty wallet has one honest answer, and it is the payment rather than a sentence.
          <TopUpButton label="Top up stars" className="profile-primary-action w-full" />
        ) : (
          <button
            type="button"
            className="profile-primary-action w-full"
            disabled={send.isPending || amount < 1}
            onClick={() => send.mutate()}
          >
            {send.isPending ? "Sending…" : `Send ${amount} ★`}
          </button>
        )
      }
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Support with stars</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">
          Stars go to the author right away. Balance: {compactNumber(balance)} ★
        </p>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={amount === preset}
              onClick={() => setAmount(preset)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-bold transition"
              style={
                amount === preset
                  ? { background: "var(--stars)", color: "#1a1205" }
                  : { background: "var(--surface-raised)", color: "var(--ink)" }
              }
            >
              <Star size={14} fill="currentColor" />
              {preset}
            </button>
          ))}
        </div>

        <label className="mt-4 grid gap-1.5">
          <span className="text-[0.95rem] font-bold">How many</span>
          <input
            className="field px-4"
            type="number"
            min={1}
            max={1_000_000}
            value={amount}
            aria-label="Number of stars"
            onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))}
          />
        </label>

        <label className="mt-3 grid gap-1.5">
          <span className="text-[0.95rem] font-bold">Message</span>
          <input
            className="field px-4"
            value={message}
            maxLength={160}
            placeholder="Optional"
            aria-label="Message with your transfer"
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
      </div>
    </BottomSheet>
  );
}
