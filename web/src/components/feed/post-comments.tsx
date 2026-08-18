"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Heart, MessageCircle, MoreHorizontal, Pencil, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api, type CommentSort } from "@/lib/api";
import type { Comment, Post } from "@/lib/types";
import { nameColor } from "@/lib/profile-color";
import { plural, relativeTime } from "@/lib/utils";
import { GiftDetailTrigger, type RichGift } from "../gifts/gift-gallery";
import { GiftImage, giftArtProps } from "../gifts/gift-image";
import { PremiumMark } from "../premium-mark";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";
import { VerifiedMark } from "../verified-mark";
import { RichText } from "./rich-text";

/** The reference's own three orders over one thread. */
const SORTS: { value: CommentSort; label: string }[] = [
  { value: "new", label: "Новые" },
  { value: "old", label: "Старые" },
  { value: "top", label: "Популярные" }
];

/**
 * The comment thread under a post, the way the reference draws it: plain text under the name
 * rather than chat bubbles, the like on the right edge, and replies folded under their root.
 *
 * It lives on the post page and not in a sheet, because that is where the reference's comment
 * button leads.
 */
export function PostComments({ post }: { post: Post }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [sort, setSort] = useState<CommentSort>("new");
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [editing, setEditing] = useState<Comment | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);

  const comments = useQuery({
    queryKey: ["comments", post.id, sort],
    queryFn: () => api.comments(post.id, sort)
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["comments", post.id] }),
      queryClient.invalidateQueries({ queryKey: ["feed"] }),
      queryClient.invalidateQueries({ queryKey: ["post", post.id] })
    ]);

  const send = useMutation({
    mutationFn: () =>
      editing
        ? api.editComment(post.id, editing.id, draft.trim())
        : api.createComment(post.id, draft.trim(), replyTo?.id),
    onSuccess: async () => {
      const wasEditing = Boolean(editing);
      if (replyTo) setExpanded((current) => [...new Set([...current, replyTo.id])]);
      setDraft("");
      setReplyTo(null);
      setEditing(null);
      await refresh();
      if (wasEditing) notify("Комментарий изменён", { variant: "success" });
    },
    onError: (error: Error) =>
      notify(editing ? "Не удалось изменить" : "Комментарий не отправлен", {
        variant: "error",
        detail: error.message
      })
  });

  const { roots, byParent } = useMemo(() => {
    const all = comments.data ?? [];
    const groups = new Map<string, Comment[]>();
    for (const item of all) {
      if (!item.parent_id) continue;
      groups.set(item.parent_id, [...(groups.get(item.parent_id) ?? []), item]);
    }
    return { roots: all.filter((item) => !item.parent_id), byParent: groups };
  }, [comments.data]);

  return (
    <section className="surface mt-3 px-4 py-4 md:px-5 md:py-5">
      <h2 className="m-0 text-[15px] font-bold">
        {post.comments_count
          ? `${post.comments_count} ${plural(post.comments_count, "комментарий", "комментария", "комментариев")}`
          : "Комментарии"}
      </h2>

      {replyTo || editing ? (
        <div className="mt-3 flex items-center gap-2 rounded-[12px] bg-[var(--surface-raised)] px-3 py-1.5 text-[13px]">
          <span className="min-w-0 flex-1 truncate text-[var(--muted)]">
            {editing ? "Изменение комментария" : `Ответ ${replyTo?.author.display_name ?? ""}`}
          </span>
          <button
            type="button"
            className="icon-button !size-7"
            aria-label="Отменить"
            onClick={() => {
              setReplyTo(null);
              setEditing(null);
              setDraft("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) send.mutate();
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={1}
          maxLength={1000}
          aria-label="Комментарий..."
          className="field min-h-11 flex-1 resize-none px-4 py-3 text-sm"
          placeholder={replyTo ? "Ваш ответ" : "Комментарий..."}
        />
        <button
          className="signal-button !size-11 !p-0"
          disabled={!draft.trim() || send.isPending}
          aria-label={editing ? "Сохранить комментарий" : "Отправить комментарий"}
        >
          <Send size={18} />
        </button>
      </form>

      <div className="mt-3 flex gap-1.5">
        {SORTS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={sort === option.value}
            onClick={() => setSort(option.value)}
            className="h-8 rounded-full px-3 text-[13px] font-semibold transition"
            style={
              sort === option.value
                ? { background: "var(--surface-raised)", color: "var(--ink)" }
                : { color: "var(--muted)" }
            }
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="min-h-24 space-y-4 py-3">
        {comments.isLoading
          ? [0, 1, 2].map((row) => (
              <div key={row} className="flex gap-3">
                <div className="skeleton size-10 rounded-full" />
                <div className="skeleton h-14 flex-1 rounded-[16px]" />
              </div>
            ))
          : roots.map((comment) => (
              <div key={comment.id}>
                <CommentRow
                  comment={comment}
                  postId={post.id}
                  onReply={() => {
                    setEditing(null);
                    setReplyTo(comment);
                  }}
                  onEdit={() => {
                    setReplyTo(null);
                    setEditing(comment);
                    setDraft(comment.content);
                  }}
                  onChanged={refresh}
                />
                {comment.replies_count ? (
                  <div className="ml-[52px] mt-2">
                    {expanded.includes(comment.id) ? (
                      <div className="space-y-4 border-l border-[var(--line)] pl-3">
                        {(byParent.get(comment.id) ?? []).map((reply) => (
                          <CommentRow
                            key={reply.id}
                            comment={reply}
                            postId={post.id}
                            compact
                            onReply={() => {
                              setEditing(null);
                              setReplyTo(comment);
                            }}
                            onEdit={() => {
                              setReplyTo(null);
                              setEditing(reply);
                              setDraft(reply.content);
                            }}
                            onChanged={refresh}
                          />
                        ))}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((current) =>
                          current.includes(comment.id)
                            ? current.filter((id) => id !== comment.id)
                            : [...current, comment.id]
                        )
                      }
                      className="mt-1 text-[13px] font-semibold text-[var(--link)]"
                    >
                      {expanded.includes(comment.id)
                        ? "Скрыть ответы"
                        : `Посмотреть ответы (${comment.replies_count})`}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
        {!comments.isLoading && !roots.length ? (
          <div className="empty-state py-8">
            <MessageCircle className="mx-auto mb-3" />
            <p>Начните обсуждение</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * One comment: who wrote it, when, how many people liked it, and the three things anyone can
 * do with it — like it, answer it, or (if it is theirs) rewrite or remove it.
 */
function CommentRow({
  comment,
  postId,
  compact = false,
  onReply,
  onEdit,
  onChanged
}: {
  comment: Comment;
  postId: string;
  compact?: boolean;
  onReply: () => void;
  onEdit: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { notify } = useToast();
  const like = useMutation({
    mutationFn: () => api.likeComment(postId, comment.id),
    onSuccess: () => onChanged(),
    onError: (error: Error) =>
      notify("Не удалось оценить", { variant: "error", detail: error.message })
  });
  const remove = useMutation({
    mutationFn: () => api.deleteComment(postId, comment.id),
    onSuccess: async () => {
      await onChanged();
      notify("Комментарий удалён", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось удалить", { variant: "error", detail: error.message })
  });
  const liked = Boolean(comment.liked_by_me ?? comment.is_liked);
  const likes = comment.likes_count ?? 0;
  const item =
    "flex min-h-10 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-sm outline-none focus:bg-[#27272a]";

  return (
    <article className="group relative flex gap-3">
      <Link href={`/u/${comment.author.username}`} className="shrink-0">
        <UserAvatar
          src={comment.author.avatar_url}
          name={comment.author.display_name}
          online={comment.author.is_online}
          size={compact ? 34 : 40}
          ringColor="var(--surface)"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1 leading-5">
          <Link
            href={`/u/${comment.author.username}`}
            className="inline-flex min-w-0 items-center text-sm font-bold hover:underline"
            style={{ color: nameColor(comment.author.profile_color) }}
          >
            <span className="truncate">{comment.author.display_name}</span>
          </Link>
          {comment.author.verified ? <VerifiedMark size={13} /> : null}
          {comment.author.is_premium ? (
            <PremiumMark size={12} profileColor={comment.author.profile_color} />
          ) : null}
          {comment.author.name_gift ? (
            <GiftDetailTrigger
              gift={comment.author.name_gift as RichGift}
              className="inline-grid size-[18px] shrink-0 place-items-center border-0 bg-transparent p-0 transition-transform duration-150 hover:scale-[1.12] active:scale-95"
            >
              <GiftImage {...giftArtProps(comment.author.name_gift)} size={18} bare />
            </GiftDetailTrigger>
          ) : null}
        </div>
        <RichText
          text={comment.content}
          className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-6"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-none text-[var(--dim)]">
          <time>{relativeTime(comment.created_at)}</time>
          {comment.edited_at ? <span>ред.</span> : null}
          {likes ? (
            <span>
              {likes} {plural(likes, "отметка", "отметки", "отметок")} «Нравится»
            </span>
          ) : null}
          <button
            type="button"
            onClick={onReply}
            className="font-semibold transition hover:text-[var(--ink)] active:scale-95"
          >
            Ответить
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="Действия"
                className="inline-flex items-center justify-center rounded-full text-[var(--dim)] transition hover:text-[var(--ink)] focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
              >
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-[110] min-w-44 rounded-[16px] bg-[#17171d] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,.55)]"
              >
                {comment.can_edit ? (
                  <DropdownMenu.Item onSelect={onEdit} className={item}>
                    <Pencil size={16} />
                    Изменить
                  </DropdownMenu.Item>
                ) : null}
                <DropdownMenu.Item
                  className={item}
                  onSelect={() =>
                    navigator.clipboard
                      .writeText(comment.content)
                      .then(() => notify("Текст скопирован", { variant: "success" }))
                  }
                >
                  <Copy size={16} />
                  Скопировать текст
                </DropdownMenu.Item>
                {comment.can_delete ? (
                  <DropdownMenu.Item
                    onSelect={() => remove.mutate()}
                    className={`${item} text-[var(--danger)]`}
                  >
                    <Trash2 size={16} />
                    Удалить
                  </DropdownMenu.Item>
                ) : null}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
      <button
        type="button"
        onClick={() => like.mutate()}
        disabled={like.isPending}
        aria-pressed={liked}
        aria-label={liked ? "Убрать отметку" : "Нравится"}
        className="mt-0.5 shrink-0 self-start text-[var(--dim)] transition hover:text-[#f9a8d4] active:scale-90"
        style={liked ? { color: "#f472b6" } : undefined}
      >
        <Heart size={16} fill={liked ? "currentColor" : "none"} />
      </button>
    </article>
  );
}
