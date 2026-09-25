"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Film, Image as ImageIcon, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Post } from "@/lib/types";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";

/**
 * The queue: written, waiting for its moment, visible to nobody else.
 *
 * A queued post is in no feed at all until it goes out — not even its author's — so this drawer is
 * where it lives in the meantime. Two things can be done to one: send it out now, or throw it
 * away. Moving it to another moment is the same field the composer used, reopened here.
 */
function moment(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

/*
 * The earliest moment the pickers offer. Read once at module load: a clock read during render is
 * what React's purity rule forbids, and this is only a hint — the server is the authority.
 */
const EARLIEST_SCHEDULE = new Date(Date.now() + 60_000).toISOString().slice(0, 16);

/** `datetime-local` wants a local wall-clock string, which is not what an ISO stamp is. */
function localValue(value: string) {
  const when = new Date(value);
  const shifted = new Date(when.getTime() - when.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function ScheduledSheet({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const queued = useQuery({
    queryKey: ["scheduled-posts"],
    queryFn: api.scheduledPosts,
    enabled: open
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scheduled-posts"] }),
      queryClient.invalidateQueries({ queryKey: ["feed"] })
    ]);

  const move = useMutation({
    mutationFn: ({ id, at }: { id: string; at: string | null }) => api.reschedulePost(id, at),
    onSuccess: async (post) => {
      await refresh();
      notify(post.scheduled ? "Time updated" : "Published", {
        variant: "success",
        detail: post.publish_at ? moment(post.publish_at) : undefined
      });
    },
    onError: (error: Error) =>
      notify("Something went wrong", { variant: "error", detail: error.message })
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deletePost(id),
    onSuccess: async () => {
      await refresh();
      notify("Scheduled post deleted", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't delete", { variant: "error", detail: error.message })
  });

  const items: Post[] = queued.data ?? [];
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Scheduled"
      description="Posts that publish themselves at the chosen time"
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Scheduled</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">
          Until its moment, only you can see the post. It publishes itself — nothing to press.
        </p>

        {queued.isLoading ? (
          <div className="grid gap-2">
            <span className="skeleton h-20 rounded-[16px]" />
            <span className="skeleton h-20 rounded-[16px]" />
          </div>
        ) : items.length ? (
          <div className="grid gap-2">
            {items.map((post) => (
              <div key={post.id} className="rounded-[16px] bg-[var(--surface-raised)] p-2.5">
                <span className="block truncate text-[0.95rem] font-semibold">
                  {post.content.trim() || "No text"}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--muted)]">
                  <span className="inline-flex items-center gap-1 font-semibold text-[var(--primary-strong)]">
                    <CalendarClock size={12} />
                    {post.publish_at ? moment(post.publish_at) : "—"}
                  </span>
                  {post.community_slug ? <span>@{post.community_slug}</span> : null}
                  {post.image_urls?.length ? (
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon size={12} />
                      {post.image_urls.length}
                    </span>
                  ) : null}
                  {post.video_url ? <Film size={12} /> : null}
                </span>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    aria-label="New publish time"
                    defaultValue={post.publish_at ? localValue(post.publish_at) : undefined}
                    min={EARLIEST_SCHEDULE}
                    onChange={(event) => {
                      if (!event.target.value) return;
                      move.mutate({ id: post.id, at: new Date(event.target.value).toISOString() });
                    }}
                    className="field min-w-0 flex-1 px-3 text-[14px]"
                  />
                  <button
                    type="button"
                    className="quiet-button !min-h-10"
                    disabled={move.isPending}
                    onClick={() => move.mutate({ id: post.id, at: null })}
                  >
                    <Send size={14} />
                    Publish
                  </button>
                  <button
                    type="button"
                    className="icon-button !size-10"
                    aria-label={`Delete scheduled post: ${post.content.slice(0, 40) || "no text"}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(post.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 flex items-center gap-2 rounded-[14px] bg-white/[0.04] p-3 text-[13px] text-[var(--muted)]">
            <CalendarClock size={15} className="flex-none" />
            The queue is empty. “Schedule post” is in the “More” menu next to the input field.
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
