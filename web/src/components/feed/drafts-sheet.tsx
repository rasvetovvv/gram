"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Image as ImageIcon, ListOrdered, Paperclip, Film, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { PostDraft } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";

/**
 * The drafts drawer.
 *
 * A draft lives on the server, so one started on a phone can be finished at a desk. Picking one
 * loads it back into the composer whole — text, pictures, clip, file, poll, link and the 18+
 * mark — and publishing it removes it, because a published draft is a post.
 */
export function DraftsSheet({
  open,
  onOpenChange,
  onPick
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (draft: PostDraft) => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const drafts = useQuery({ queryKey: ["post-drafts"], queryFn: api.postDrafts, enabled: open });

  const remove = useMutation({
    mutationFn: (id: string) => api.deletePostDraft(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["post-drafts"] });
      notify("Черновик удалён", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось удалить", { variant: "error", detail: error.message })
  });

  const items = drafts.data ?? [];
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Черновики"
      description="Незаконченные записи, сохранённые на сервере"
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Черновики</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">
          Начните на телефоне, закончите за столом. Опубликованный черновик исчезает сам.
        </p>

        {drafts.isLoading ? (
          <div className="grid gap-2">
            <span className="skeleton h-16 rounded-[16px]" />
            <span className="skeleton h-16 rounded-[16px]" />
          </div>
        ) : items.length ? (
          <div className="grid gap-2">
            {items.map((draft) => (
              <div
                key={draft.id}
                className="flex items-start gap-2 rounded-[16px] bg-[var(--surface-raised)] p-2.5"
              >
                <button
                  type="button"
                  onClick={() => {
                    onPick(draft);
                    onOpenChange(false);
                  }}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left"
                >
                  <span className="block truncate text-[0.95rem] font-semibold">
                    {draft.content.trim() || "Без текста"}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--muted)]">
                    <span>{relativeTime(draft.updated_at)}</span>
                    {draft.community_slug ? <span>@{draft.community_slug}</span> : null}
                    {draft.image_urls?.length ? (
                      <span className="inline-flex items-center gap-1">
                        <ImageIcon size={12} />
                        {draft.image_urls.length}
                      </span>
                    ) : null}
                    {draft.video_url ? <Film size={12} /> : null}
                    {draft.file_url ? <Paperclip size={12} /> : null}
                    {draft.poll_options?.length ? <ListOrdered size={12} /> : null}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button !size-9"
                  aria-label={`Удалить черновик: ${draft.content.slice(0, 40) || "без текста"}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(draft.id)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 flex items-center gap-2 rounded-[14px] bg-white/[0.04] p-3 text-[13px] text-[var(--muted)]">
            <FileText size={15} className="flex-none" />
            Пока ничего не сохранено. «Сохранить черновик» — в меню «Ещё» рядом с полем ввода.
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
