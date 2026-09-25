"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Post } from "@/lib/types";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";

/**
 * Rewriting one's own post.
 *
 * The pictures stay as they were: they are what the post already is, and replacing them would
 * make an edit indistinguishable from a different post. The text and the link card are what
 * the reference lets an author fix, so they are what this changes.
 *
 * Mounted only while it is open, so every visit starts from what the post says now.
 */
export function PostEditSheet({
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
  const [content, setContent] = useState(post.content);
  const [linkUrl, setLinkUrl] = useState(post.link_url ?? "");
  const [linkTitle, setLinkTitle] = useState(post.link_title ?? "");
  const [sensitive, setSensitive] = useState(Boolean(post.sensitive));

  const save = useMutation({
    mutationFn: () =>
      api.editPost(
        post.id,
        content.trim(),
        { url: linkUrl.trim(), title: linkTitle.trim() },
        sensitive
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feed"] }),
        queryClient.invalidateQueries({ queryKey: ["post", post.id] })
      ]);
      notify("Post updated", { variant: "success" });
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Couldn't update", { variant: "error", detail: error.message })
  });

  const unchanged =
    content.trim() === post.content &&
    linkUrl.trim() === (post.link_url ?? "") &&
    linkTitle.trim() === (post.link_title ?? "") &&
    sensitive === Boolean(post.sensitive);

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit post"
      description="The post text and the link beneath it"
      footer={
        <button
          type="button"
          className="profile-primary-action w-full"
          disabled={save.isPending || !content.trim() || unchanged}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      }
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Edit post</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">
          Likes, comments, and views stay put — an &quot;edited&quot; note appears next to the date.
        </p>

        <label className="grid gap-1.5">
          <span className="text-[0.95rem] font-bold">Text</span>
          <textarea
            className="field min-h-32 resize-none px-4 py-3 text-[15px] leading-6"
            value={content}
            maxLength={4000}
            aria-label="Post text"
            onChange={(event) => setContent(event.target.value)}
          />
        </label>

        {post.image_urls?.length || post.video_url ? (
          <label className="mt-3 flex items-center gap-3 rounded-[16px] bg-[var(--surface-raised)] p-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[0.95rem] font-bold">18+ content</span>
              <span className="block text-[12px] leading-4 text-[var(--muted)]">
                Attachments arrive hidden — the reader decides whether to look.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={sensitive}
              aria-label="18+ content"
              onClick={() => setSensitive((current) => !current)}
              className="relative h-6 w-11 flex-none rounded-full transition"
              style={{ background: sensitive ? "var(--stars)" : "rgba(255,255,255,.16)" }}
            >
              <span
                aria-hidden
                className="absolute top-0.5 size-5 rounded-full bg-white transition-all"
                style={{ left: sensitive ? "22px" : "2px" }}
              />
            </button>
          </label>
        ) : null}

        <div className="mt-3 grid gap-2 rounded-[16px] bg-[var(--surface-raised)] p-3">
          <span className="text-[0.95rem] font-bold">Link beneath the post</span>
          <span className="text-[12px] leading-4 text-[var(--muted)]">
            An empty field removes the card. Opening it asks for confirmation — just like in the feed.
          </span>
          <input
            className="field px-4"
            value={linkUrl}
            inputMode="url"
            placeholder="https://…"
            aria-label="Post link"
            onChange={(event) => setLinkUrl(event.target.value)}
          />
          <input
            className="field px-4"
            value={linkTitle}
            maxLength={120}
            placeholder="Link caption"
            aria-label="Link caption"
            onChange={(event) => setLinkTitle(event.target.value)}
          />
        </div>
      </div>
    </BottomSheet>
  );
}
