"use client";

import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { api, type PostReportReason } from "@/lib/api";
import type { Post } from "@/lib/types";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";

const REASONS: { value: PostReportReason; label: string; hint: string }[] = [
  { value: "spam", label: "Спам", hint: "Реклама, накрутка, повторяющиеся записи." },
  { value: "abuse", label: "Оскорбления", hint: "Травля, вражда, угрозы." },
  { value: "adult", label: "Взрослый контент", hint: "Не для всех и без предупреждения." },
  { value: "fraud", label: "Обман", hint: "Мошенничество, фальшивые продажи." },
  { value: "violence", label: "Насилие", hint: "Жестокость и призывы к ней." },
  { value: "other", label: "Другое", hint: "Опишите, что не так." }
];

/**
 * A complaint about someone else's post.
 *
 * The reason is stored with the post, not answered by a toast and forgotten: the sheet says
 * «Жалоба отправлена» because a row was written, and sending it twice replaces the reason
 * rather than counting twice.
 */
export function PostReportSheet({
  post,
  open,
  onOpenChange
}: {
  post: Post;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { notify } = useToast();
  const [reason, setReason] = useState<PostReportReason>("spam");
  const [comment, setComment] = useState("");

  const send = useMutation({
    mutationFn: () => api.reportPost(post.id, reason, comment),
    onSuccess: () => {
      setComment("");
      notify("Жалоба отправлена", {
        variant: "success",
        detail: "Мы посмотрим на эту запись."
      });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Не удалось отправить", { variant: "error", detail: error.message })
  });

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Пожаловаться"
      description={`Запись @${post.author.username}`}
      footer={
        <button
          type="button"
          className="profile-primary-action w-full"
          disabled={send.isPending}
          onClick={() => send.mutate()}
        >
          {send.isPending ? "Отправляем…" : "Отправить жалобу"}
        </button>
      }
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Пожаловаться</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">
          Автор не узнает, кто пожаловался. Запись останется в ленте до решения.
        </p>

        <div role="radiogroup" aria-label="Причина жалобы" className="grid gap-1.5">
          {REASONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={reason === option.value}
              onClick={() => setReason(option.value)}
              className="flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition"
              style={
                reason === option.value
                  ? { background: "var(--surface-raised)" }
                  : undefined
              }
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[0.95rem] font-semibold">{option.label}</span>
                <span className="block text-[12px] leading-4 text-[var(--muted)]">
                  {option.hint}
                </span>
              </span>
              <span
                aria-hidden
                className="grid size-5 flex-none place-items-center rounded-full border"
                style={{
                  borderColor:
                    reason === option.value ? "var(--primary-strong)" : "var(--line-strong)",
                  background: reason === option.value ? "var(--primary-strong)" : "transparent"
                }}
              >
                {reason === option.value ? <Check size={13} /> : null}
              </span>
            </button>
          ))}
        </div>

        <label className="mt-3 grid gap-1.5">
          <span className="text-[0.95rem] font-bold">Что случилось</span>
          <textarea
            className="field min-h-20 resize-none px-4 py-3 text-sm"
            value={comment}
            maxLength={300}
            placeholder="Необязательно"
            aria-label="Подробности жалобы"
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
      </div>
    </BottomSheet>
  );
}
