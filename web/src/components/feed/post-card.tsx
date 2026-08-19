"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  EyeOff,
  BellOff,
  Bookmark,
  Copy,
  Eye,
  Flag,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Repeat2,
  Send,
  Star,
  Trash2
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Post } from "@/lib/types";
import { nameColor } from "@/lib/profile-color";
import { cn, relativeTime } from "@/lib/utils";
import { GiftDetailTrigger, type RichGift } from "../gifts/gift-gallery";
import { GiftImage, giftArtProps } from "../gifts/gift-image";
import { AdminMark } from "../admin-mark";
import { PremiumMark } from "../premium-mark";
import { AnimatedCounter } from "../ui/animated-counter";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";
import { VerifiedMark } from "../verified-mark";
import { PostEditSheet } from "./post-edit-sheet";
import { PostGallery } from "./post-gallery";
import { PostLinkCard } from "./post-link-card";
import { PostMusicCard, useRecordView } from "./post-music";
import { PostPoll } from "./post-poll";
import { PostReportSheet } from "./post-report-sheet";
import { PostVideo } from "./post-video";
import { PostStarsSheet } from "./post-stars-sheet";
import { RichText } from "./rich-text";

/** A music link that became a card is dropped from the text, the way the reference drops it. */
const MUSIC_LINK = /https?:\/\/(?:www\.|on\.|m\.)?soundcloud\.com\/\S+/gi;

/**
 * One post, laid out the way the reference lays it out: the avatar is a column of its own, and
 * everything else — name, text, attachments, actions — is indented beside it.
 *
 * `showPinned` is off by default: a pin is an author's arrangement of their own page, so saying
 * «Закреплено» in a mixed feed would describe a place the reader is not looking at.
 */
export function PostCard({
  post,
  showPinned = false,
  openOnClick = true
}: {
  post: Post;
  priority?: boolean;
  showPinned?: boolean;
  /** Off on the post's own page, where there is nowhere further to open. */
  openOnClick?: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const viewRef = useRecordView(post.id);
  const { notify } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // `seq` remounts the sheet on every open so it starts from what the post says now, while the
  // sheet itself stays mounted through its own close — unmounting an open Radix dialog leaves
  // the page underneath unclickable.
  // Uncovering 18+ media is this reader's decision about this card, and it is not remembered.
  const [revealed, setRevealed] = useState(false);
  const [edit, setEdit] = useState({ open: false, seq: 0 });
  const [report, setReport] = useState({ open: false, seq: 0 });
  const [stars, setStars] = useState({ open: false, seq: 0 });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const isMine = post.can_edit ?? Boolean(me && me.id === post.author.id);
  const pictures = post.image_urls?.length
    ? post.image_urls
    : post.media_url
      ? [post.media_url]
      : [];
  // Where this post was published, when it was not a profile.
  const channel = post.community_slug
    ? {
        slug: post.community_slug,
        title: post.community_title ?? post.community_slug,
        avatar_url: post.community_avatar_url ?? null,
        verified: Boolean(post.community_verified)
      }
    : null;
  // The card already names the track and links to it, so the raw url would only repeat itself.
  const text = post.music ? post.content.replace(MUSIC_LINK, "").replace(/[ \t]{2,}/g, " ").trim() : post.content;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["feed"] }),
      queryClient.invalidateQueries({ queryKey: ["post", post.id] })
    ]);

  const like = useMutation({ mutationFn: () => api.likePost(post.id), onSuccess: refresh });
  const repost = useMutation({ mutationFn: () => api.repost(post.id), onSuccess: refresh });
  const bookmark = useMutation({
    mutationFn: () => api.bookmarkPost(post.id),
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["bookmarks"] })]);
      notify(post.is_bookmarked ? "Убрано из сохранённых" : "Сохранено", { variant: "success" });
    }
  });
  const mute = useMutation({
    mutationFn: () => api.mutePost(post.id, !post.is_muted),
    onSuccess: async () => {
      await refresh();
      notify(post.is_muted ? "Уведомления включены" : "Уведомления отключены", {
        variant: "success"
      });
    },
    onError: (error: Error) => notify("Не получилось", { variant: "error", detail: error.message })
  });
  const pin = useMutation({
    mutationFn: () => api.pinPost(post.id, !post.is_pinned),
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["profile"] })]);
      notify(post.is_pinned ? "Публикация откреплена" : "Публикация закреплена", {
        variant: "success"
      });
    },
    onError: (error: Error) =>
      notify("Не удалось закрепить", { variant: "error", detail: error.message })
  });
  const remove = useMutation({
    mutationFn: () => api.deletePost(post.id),
    onSuccess: async () => {
      setConfirmDelete(false);
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["me"] })]);
      notify("Запись удалена", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось удалить", { variant: "error", detail: error.message })
  });

  const permalink =
    typeof window === "undefined"
      ? `/post/${post.id}`
      : `${window.location.origin}/post/${post.id}`;
  async function sharePost() {
    if (navigator.share)
      await navigator.share({
        title: `${post.author.display_name} в GRAM`,
        text: post.content,
        url: permalink
      });
    else {
      await navigator.clipboard.writeText(permalink);
      notify("Ссылка скопирована", { variant: "success" });
    }
  }

  const item = "flex min-h-10 cursor-pointer items-center gap-3 rounded-[13px] px-3 text-sm outline-none focus:bg-[#27272a]";

  /**
   * The whole card opens the post, the way the reference's does — except where the reader is
   * already doing something with it: a link, a control, a menu, or a text selection they are
   * about to copy.
   */
  function openPost(event: React.MouseEvent<HTMLElement>) {
    if (!openOnClick) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        "a,button,[role='button'],[role='menu'],[role='dialog'],input,textarea,video,[data-keep-click]"
      )
    )
      return;
    if (window.getSelection()?.toString()) return;
    router.push(`/post/${post.id}`);
  }

  return (
    <article
      ref={viewRef}
      onClick={openPost}
      className={cn(
        "surface flex gap-3 px-4 py-4 md:gap-3.5 md:px-5 md:py-5",
        openOnClick && "cursor-pointer"
      )}
    >
      {/*
        A channel publishes as itself. The person who pressed the button is its owner, not an
        author anyone reads: the card carries the channel's picture, name and address, and
        leads to the channel.
      */}
      <Link href={channel ? `/c/${channel.slug}` : `/u/${post.author.username}`} className="shrink-0">
        <UserAvatar
          src={channel ? channel.avatar_url : post.author.avatar_url}
          name={channel ? channel.title : post.author.display_name}
          online={channel ? false : post.author.is_online}
          size={40}
          ringColor="var(--surface)"
        />
      </Link>
      <div className="min-w-0 flex-1">
        {showPinned && post.is_pinned ? (
          <span className="mb-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--dim)]">
            <Pin size={12} />
            Закреплено
          </span>
        ) : null}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 leading-tight">
            {channel ? (
              <>
                <Link
                  className="inline-flex min-w-0 items-center text-[15px] font-semibold hover:underline"
                  href={`/c/${channel.slug}`}
                >
                  <span className="truncate">{channel.title}</span>
                </Link>
                {channel.verified ? <VerifiedMark /> : null}
                <span className="shrink-0 whitespace-nowrap text-[13px] text-[var(--dim)]">
                  @{channel.slug} · {relativeTime(post.created_at)}
                  {post.edited_at ? " · ред." : ""}
                </span>
              </>
            ) : null}
            {channel ? null : post.author.is_admin ? <AdminMark size={15} /> : null}
            {channel ? null : (
              <Link
                className="inline-flex min-w-0 items-center text-[15px] font-semibold hover:underline"
                href={`/u/${post.author.username}`}
              >
                <span className="truncate" style={{ color: nameColor(post.author.profile_color) }}>
                  {post.author.display_name}
                </span>
              </Link>
            )}
            {channel ? null : post.author.verified ? <VerifiedMark /> : null}
            {!channel && post.author.is_premium ? (
              <Link
                href="/premium"
                aria-label="Открыть GRAM Premium"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full transition hover:bg-[var(--surface-raised)] active:scale-95"
              >
                <PremiumMark size={15} profileColor={post.author.profile_color} />
              </Link>
            ) : null}
            {!channel && post.author.name_gift ? (
              <GiftDetailTrigger
                gift={post.author.name_gift as RichGift}
                me={me?.username}
                className="inline-grid size-5 shrink-0 place-items-center border-0 bg-transparent p-0 transition-transform duration-150 hover:scale-[1.12] active:scale-95"
              >
                <GiftImage {...giftArtProps(post.author.name_gift)} size={20} bare />
              </GiftDetailTrigger>
            ) : null}
            {channel ? null : (
              <span className="shrink-0 whitespace-nowrap text-[13px] text-[var(--dim)]">
                @{post.author.username} · {relativeTime(post.created_at)}
                {post.edited_at ? " · ред." : ""}
              </span>
            )}
          </div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="-mr-1 -mt-1 inline-flex items-center justify-center rounded-full p-1 text-[var(--dim)] transition hover:bg-[var(--surface-raised)] hover:text-[var(--ink)]"
                aria-label="Действия с записью"
              >
                <MoreHorizontal size={20} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-[90] min-w-56 rounded-[18px] bg-[#17171d] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,.5)]"
              >
                <DropdownMenu.Item className={item} onSelect={sharePost}>
                  <Send size={17} />
                  Поделиться…
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={item}
                  onSelect={() =>
                    navigator.clipboard
                      .writeText(permalink)
                      .then(() => notify("Ссылка скопирована", { variant: "success" }))
                  }
                >
                  <Copy size={17} />
                  Скопировать ссылку
                </DropdownMenu.Item>
                <DropdownMenu.Item className={item} onSelect={() => bookmark.mutate()}>
                  <Bookmark size={17} fill={post.is_bookmarked ? "currentColor" : "none"} />
                  {post.is_bookmarked ? "Убрать из сохранённых" : "Сохранить"}
                </DropdownMenu.Item>
                <DropdownMenu.Item className={item} onSelect={() => mute.mutate()}>
                  {post.is_muted ? <Bell size={17} /> : <BellOff size={17} />}
                  {post.is_muted ? "Включить уведомления" : "Отключить уведомления"}
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="mx-2 my-1.5 h-px bg-[var(--line)]" />
                {isMine ? (
                  <>
                    <DropdownMenu.Item className={item} onSelect={() => pin.mutate()}>
                      {post.is_pinned ? <PinOff size={17} /> : <Pin size={17} />}
                      {post.is_pinned ? "Открепить" : "Закрепить"}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={item}
                      onSelect={() => setEdit((current) => ({ open: true, seq: current.seq + 1 }))}
                    >
                      <Pencil size={17} />
                      Редактировать
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={cn(item, "text-[var(--danger)]")}
                      // The menu closes first and the dialog opens after: holding the menu open
                      // with preventDefault leaves its focus trap over the page once the dialog
                      // is dismissed, and nothing on the card answers the mouse again.
                      onSelect={() => setConfirmDelete(true)}
                    >
                      <Trash2 size={17} />
                      Удалить
                    </DropdownMenu.Item>
                  </>
                ) : (
                  <DropdownMenu.Item
                    className={cn(item, "text-[var(--danger)]")}
                    onSelect={() => setReport((current) => ({ open: true, seq: current.seq + 1 }))}
                  >
                    <Flag size={17} />
                    Пожаловаться
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        {text ? (
          <RichText
            text={text}
            className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-6 text-[#ededf1]"
          />
        ) : null}

        {post.poll ? <PostPoll post={post} poll={post.poll} /> : null}
        {post.music ? <PostMusicCard music={post.music} /> : null}
        {post.link_url ? <PostLinkCard url={post.link_url} title={post.link_title} /> : null}

        {/*
          One clip, in our own player; or one to four pictures, each opening the viewer. A post
          its author marked 18+ arrives covered: the reader asks to see it, and the choice is
          theirs alone — nothing here is remembered anywhere.
        */}
        {post.video_url || pictures.length ? (
          post.sensitive && !revealed ? (
            <button
              type="button"
              data-keep-click
              onClick={() => setRevealed(true)}
              className="mt-2 grid min-h-40 w-full place-items-center gap-1.5 rounded-[16px] bg-[var(--surface-raised)] px-4 py-8 text-center transition hover:brightness-110"
            >
              <EyeOff size={22} className="text-[var(--muted)]" />
              <span className="text-[15px] font-bold">Материалы 18+</span>
              <span className="text-[13px] text-[var(--muted)]">
                Автор отметил вложения как чувствительные. Нажмите, чтобы посмотреть.
              </span>
            </button>
          ) : post.video_url ? (
            <PostVideo src={post.video_url} poster={pictures[0]} />
          ) : (
            <PostGallery urls={pictures} alt={post.content.slice(0, 80)} />
          )
        ) : null}

        <footer className="mt-2 flex items-center justify-between text-[var(--dim)]">
          <div className="-ml-1.5 flex items-center gap-0.5 sm:gap-1.5">
            <PostAction
              label={post.is_liked ? "Убрать отметку нравится" : "Нравится"}
              icon={<Heart size={19} fill={post.is_liked ? "currentColor" : "none"} />}
              count={post.likes_count}
              tone="like"
              active={post.is_liked}
              onClick={() => like.mutate()}
              disabled={like.isPending}
            />
            <PostAction
              label="Комментарии"
              icon={<MessageCircle size={19} />}
              count={post.comments_count}
              tone="comment"
              href={`/post/${post.id}`}
            />
            <PostAction
              label="Репост"
              icon={<Repeat2 size={19} />}
              count={post.reposts_count}
              tone="repost"
              active={post.is_reposted}
              onClick={() => repost.mutate()}
              disabled={repost.isPending}
            />
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1">
            {isMine ? (
              // Nobody supports their own post, so this is a tally, not a control.
              <span
                className="inline-flex items-center text-[var(--stars)]"
                title="Звёзды за публикацию"
                aria-label={`Звёзды за публикацию: ${post.stars_count ?? 0}`}
              >
                <span className="grid size-9 place-items-center">
                  <Star size={18} fill={post.stars_count ? "currentColor" : "none"} />
                </span>
                {post.stars_count ? (
                  <span className="-ml-0.5 min-w-[14px] text-[13px] font-medium tabular-nums">
                    {post.stars_count}
                  </span>
                ) : null}
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Поддержать звёздами${post.stars_count ? `, ${post.stars_count}` : ""}`}
                title="Поддержать звёздами"
                onClick={() => setStars((current) => ({ open: true, seq: current.seq + 1 }))}
                className="group inline-flex items-center text-[var(--stars)]"
              >
                <span className="grid size-9 place-items-center rounded-full transition-all duration-200 group-hover:bg-[#ff9f1c1a] group-active:scale-90">
                  <Star
                    size={18}
                    fill={post.starred_by_me ? "currentColor" : "none"}
                    className="transition-transform duration-200 group-hover:scale-110"
                  />
                </span>
                {post.stars_count ? (
                  <span className="-ml-0.5 min-w-[14px] text-[13px] font-medium tabular-nums">
                    <AnimatedCounter value={post.stars_count} />
                  </span>
                ) : null}
              </button>
            )}
            <span
              className="ml-0.5 inline-flex items-center gap-1 pr-0.5"
              title="Просмотры"
              aria-label={`Просмотры: ${post.views_count ?? 0}`}
            >
              <Eye size={18} />
              <span className="text-[13px] font-medium tabular-nums">{post.views_count ?? 0}</span>
            </span>
          </div>
        </footer>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить запись?"
        description="Запись исчезнет из ленты и профиля. Отменить это действие нельзя."
        confirmLabel={remove.isPending ? "Удаляем…" : "Удалить"}
        error={remove.error?.message}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
      {/* Keyed so each visit starts from what the post says now. */}
      <PostEditSheet
        key={`edit-${edit.seq}`}
        post={post}
        open={edit.open}
        onOpenChange={(open) => setEdit((current) => ({ ...current, open }))}
      />
      <PostReportSheet
        key={`report-${report.seq}`}
        post={post}
        open={report.open}
        onOpenChange={(open) => setReport((current) => ({ ...current, open }))}
      />
      <PostStarsSheet
        key={`stars-${stars.seq}`}
        post={post}
        open={stars.open}
        onOpenChange={(open) => setStars((current) => ({ ...current, open }))}
      />
    </article>
  );
}

/**
 * One post action, following the reference: the icon lives in its own 36px circle that
 * tints on hover in the action's own colour, and the count sits outside the circle and
 * rolls when it changes.
 */
const ACTION_TONES = {
  like: { hover: "group-hover:bg-[#ec489910] group-hover:text-[#f472b6]", active: "text-[#ec4899]" },
  comment: {
    hover: "group-hover:bg-[#2f80ed1a] group-hover:text-[var(--primary-strong)]",
    active: "text-[var(--primary-strong)]"
  },
  repost: { hover: "group-hover:bg-[#10b98110] group-hover:text-[#34d399]", active: "text-[#10b981]" }
} as const;

export function PostAction({
  label,
  icon,
  count,
  tone,
  active,
  onClick,
  disabled,
  href
}: {
  label: string;
  icon: React.ReactNode;
  count?: number;
  tone: keyof typeof ACTION_TONES;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
}) {
  const palette = ACTION_TONES[tone];
  // The count lives in its own span, so it is folded into the accessible name — an
  // aria-label on the control would otherwise hide it from assistive technology.
  const accessibleName = typeof count === "number" ? `${label}, ${count}` : label;
  const body = (
    <>
      <span
        className={cn(
          "grid size-9 place-items-center rounded-full transition-all duration-200 group-active:scale-90 [&>svg]:transition-transform [&>svg]:duration-200 group-hover:[&>svg]:scale-110",
          palette.hover,
          active && palette.active
        )}
      >
        {icon}
      </span>
      {typeof count === "number" ? (
        <span
          className={cn(
            "-ml-0.5 min-w-[14px] text-[13px] font-medium tabular-nums transition-colors",
            palette.hover,
            active && palette.active
          )}
        >
          <AnimatedCounter value={count} />
        </span>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} aria-label={accessibleName} className="group inline-flex items-center">
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label={accessibleName}
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex items-center"
    >
      {body}
    </button>
  );
}
