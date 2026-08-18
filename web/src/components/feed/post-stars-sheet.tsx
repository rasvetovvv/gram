"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Post } from "@/lib/types";
import { compactNumber } from "@/lib/utils";
import { BottomSheet } from "../ui/bottom-sheet";
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
      notify(`Отправлено ${amount} ★`, {
        variant: "success",
        detail: `@${post.author.username} узнает об этом`
      });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Не удалось отправить", { variant: "error", detail: error.message })
  });

  const short = amount > balance;
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Поддержать звёздами"
      description={`Публикация @${post.author.username}`}
      footer={
        <button
          type="button"
          className="profile-primary-action w-full"
          disabled={send.isPending || short || amount < 1}
          onClick={() => send.mutate()}
        >
          {send.isPending ? "Отправляем…" : short ? "Недостаточно звёзд" : `Отправить ${amount} ★`}
        </button>
      }
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Поддержать звёздами</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">
          Звёзды уйдут автору сразу. На балансе: {compactNumber(balance)} ★
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
          <span className="text-[0.95rem] font-bold">Сколько</span>
          <input
            className="field px-4"
            type="number"
            min={1}
            max={1_000_000}
            value={amount}
            aria-label="Количество звёзд"
            onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))}
          />
        </label>

        <label className="mt-3 grid gap-1.5">
          <span className="text-[0.95rem] font-bold">Сообщение</span>
          <input
            className="field px-4"
            value={message}
            maxLength={160}
            placeholder="Необязательно"
            aria-label="Сообщение к переводу"
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
      </div>
    </BottomSheet>
  );
}
