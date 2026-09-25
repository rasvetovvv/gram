"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Bell,
  Gavel,
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
import { PostFileCard } from "./post-file-card";
import { PostGallery } from "./post-gallery";
import { PostLinkCard } from "./post-link-card";
import { PostMusicCard, useRecordView } from "./post-music";
import { PostPoll } from "./post-poll";
import { PostReportSheet } from "./post-report-sheet";
import { PostVideo } from "./post-video";
import { PostStarsSheet } from "./post-stars-sheet";
import { PostText } from "./post-text";

/** A music link that became a card is dropped from the text, the way the reference drops it. */
const MUSIC_LINK = /https?:\/\/(?:www\.|on\.|m\.)?soundcloud\.com\/\S+/gi;

/**
 * One post, laid out the way the reference lays it out: the avatar is a column of its own, and
 * everything else — name, text, attachments, actions — is indented beside it.
 *
 * `showPinned` is off by default: a pin is an author's arrangement of their own page, so saying
 * "Pinned" in a mixed feed would describe a place the reader is not looking at.
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
  // Which staff decision is waiting for its reason. Both need one, and a moderator typing it into
  // a dialog is what keeps the audit log readable afterwards.
  const [staffAction, setStaffAction] = useState<"hide" | "delete" | null>(null);
  const [staffReason, setStaffReason] = useState("");
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

  /**
   * Write one post's new state straight into every cache holding it.
   *
   * The feed, a profile's tab, a hashtag page and the post's own permalink all cache the same
   * card under different keys. Invalidating them means a network round trip before the heart
   * fills, which is the lag that made people tap twice. This patches them in place instead, and
   * the invalidation that follows only confirms what is already on screen.
   */
  const writeEverywhere = (patch: Partial<Post>) => {
    queryClient.setQueriesData<Post[]>({ queryKey: ["feed"] }, (current) =>
      Array.isArray(current)
        ? current.map((item) => (item.id === post.id ? { ...item, ...patch } : item))
        : current
    );
    queryClient.setQueryData<Post>(["post", post.id], (current) =>
      current ? { ...current, ...patch } : current
    );
  };

  const like = useMutation({
    mutationFn: () => api.likePost(post.id),
    // The heart fills on the tap, not on the response.
    onMutate: () => {
      const liked = Boolean(post.is_liked);
      writeEverywhere({
        is_liked: !liked,
        likes_count: Math.max(0, (post.likes_count ?? 0) + (liked ? -1 : 1))
      });
      return { liked, count: post.likes_count };
    },
    onError: (_error, _vars, context) => {
      if (context) writeEverywhere({ is_liked: context.liked, likes_count: context.count });
    },
    onSuccess: (updated) => {
      // The server is the authority on the count; adopt its row before any refetch.
      if (updated) writeEverywhere(updated);
    },
    onSettled: refresh
  });
  const repost = useMutation({
    mutationFn: () => api.repost(post.id),
    onMutate: () => {
      const reposted = Boolean(post.is_reposted);
      writeEverywhere({
        is_reposted: !reposted,
        reposts_count: Math.max(0, (post.reposts_count ?? 0) + (reposted ? -1 : 1))
      });
      return { reposted, count: post.reposts_count };
    },
    onError: (_error, _vars, context) => {
      if (context)
        writeEverywhere({ is_reposted: context.reposted, reposts_count: context.count });
    },
    onSettled: refresh
  });
  const bookmark = useMutation({
    mutationFn: () => api.bookmarkPost(post.id),
    onMutate: () => {
      const saved = Boolean(post.is_bookmarked);
      writeEverywhere({ is_bookmarked: !saved });
      return { saved };
    },
    onError: (error: Error, _vars, context) => {
      if (context) writeEverywhere({ is_bookmarked: context.saved });
      notify("Something went wrong", { variant: "error", detail: error.message });
    },
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["bookmarks"] })]);
      notify(post.is_bookmarked ? "Removed from saved" : "Saved", { variant: "success" });
    }
  });
  const mute = useMutation({
    mutationFn: () => api.mutePost(post.id, !post.is_muted),
    onSuccess: async () => {
      await refresh();
      notify(post.is_muted ? "Notifications on" : "Notifications off", {
        variant: "success"
      });
    },
    onError: (error: Error) => notify("Something went wrong", { variant: "error", detail: error.message })
  });
  /** Staff decisions on this card. The author is notified by the server, with the reason. */
  const staffHide = useMutation({
    mutationFn: () => api.adminHidePost(post.id, staffReason.trim()),
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["admin-actions"] })]);
      setStaffAction(null);
      setStaffReason("");
      notify("Post hidden", { variant: "success", detail: "The author was notified" });
    },
    onError: (error: Error) => notify("Something went wrong", { variant: "error", detail: error.message })
  });
  const staffRestore = useMutation({
    mutationFn: () => api.adminRestorePost(post.id),
    onSuccess: async () => {
      await refresh();
      notify("Post restored", { variant: "success" });
    },
    onError: (error: Error) => notify("Something went wrong", { variant: "error", detail: error.message })
  });
  const staffDelete = useMutation({
    mutationFn: () => api.adminDeletePost(post.id, staffReason.trim()),
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["admin-actions"] })]);
      setStaffAction(null);
      setStaffReason("");
      notify("Post deleted", { variant: "success", detail: "The author was notified" });
    },
    onError: (error: Error) => notify("Something went wrong", { variant: "error", detail: error.message })
  });
  const pin = useMutation({
    mutationFn: () => api.pinPost(post.id, !post.is_pinned),
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["profile"] })]);
      notify(post.is_pinned ? "Post unpinned" : "Post pinned", {
        variant: "success"
      });
    },
    onError: (error: Error) =>
      notify("Couldn't pin", { variant: "error", detail: error.message })
  });
  const remove = useMutation({
    mutationFn: () => api.deletePost(post.id),
    onSuccess: async () => {
      setConfirmDelete(false);
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["me"] })]);
      notify("Post deleted", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't delete", { variant: "error", detail: error.message })
  });

  const permalink =
    typeof window === "undefined"
      ? `/post/${post.id}`
      : `${window.location.origin}/post/${post.id}`;
  async function sharePost() {
    if (navigator.share)
      await navigator.share({
        title: `${post.author.display_name} on GRAM`,
        text: post.content,
        url: permalink
      });
    else {
      await navigator.clipboard.writeText(permalink);
      notify("Link copied", { variant: "success" });
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
        {/*
          Who put this in front of the reader, when it was not the author. It goes above the
          name, the way the reference does it, so the card still reads as the author's words.
        */}
        {post.reposted_by ? (
          <Link
            href={`/u/${post.reposted_by.username}`}
            className="mb-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--dim)] hover:underline"
          >
            <Repeat2 size={13} />
            {/* `is_me` is a profile's field, not a compact user's, so the comparison is here. */}
            {me && me.id === post.reposted_by.id
              ? "You reposted"
              : `${post.reposted_by.display_name} reposted`}
          </Link>
        ) : null}
        {showPinned && post.is_pinned ? (
          <span className="mb-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--dim)]">
            <Pin size={12} />
            Pinned
          </span>
        ) : null}
        {/* Only its author and staff ever receive a hidden post, so this notice explains why
            they can still see something nobody else can. */}
        {post.hidden_at ? (
          <span className="mb-2 flex items-start gap-2 rounded-[14px] bg-[rgba(229,57,53,.12)] px-3 py-2 text-[13px] leading-5 text-[var(--muted)] shadow-[inset_0_0_0_1px_rgba(229,57,53,.24)]">
            <EyeOff size={15} className="mt-0.5 shrink-0 text-[var(--danger)]" />
            <span>
              <strong className="font-bold text-[var(--danger)]">
                Post hidden by administration
              </strong>
              {post.hidden_reason ? ` · ${post.hidden_reason}` : null}
              <span className="mt-0.5 block text-[12px] text-[var(--dim)]">
                Only you and administrators can see it.
              </span>
            </span>
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
                  {post.edited_at ? " · edited" : ""}
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
            {/* A banned author keeps their posts, and the posts say so. Removing the trail is
                what makes moderation unaccountable; marking it is what makes it readable. */}
            {!channel && post.author.is_banned ? (
              <span
                title="Account blocked by administration"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[rgba(229,57,53,.16)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--danger)]"
              >
                <Ban size={10} />
                ban
              </span>
            ) : null}
            {!channel && post.author.is_premium ? (
              <Link
                href="/premium"
                aria-label="Open GRAM Premium"
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
                {post.edited_at ? " · edited" : ""}
              </span>
            )}
          </div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="-mr-1 -mt-1 inline-flex items-center justify-center rounded-full p-1 text-[var(--dim)] transition hover:bg-[var(--surface-raised)] hover:text-[var(--ink)]"
                aria-label="Post actions"
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
                  Share…
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={item}
                  onSelect={() =>
                    navigator.clipboard
                      .writeText(permalink)
                      .then(() => notify("Link copied", { variant: "success" }))
                  }
                >
                  <Copy size={17} />
                  Copy link
                </DropdownMenu.Item>
                <DropdownMenu.Item className={item} onSelect={() => bookmark.mutate()}>
                  <Bookmark size={17} fill={post.is_bookmarked ? "currentColor" : "none"} />
                  {post.is_bookmarked ? "Remove from saved" : "Save"}
                </DropdownMenu.Item>
                <DropdownMenu.Item className={item} onSelect={() => mute.mutate()}>
                  {post.is_muted ? <Bell size={17} /> : <BellOff size={17} />}
                  {post.is_muted ? "Turn on notifications" : "Turn off notifications"}
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="mx-2 my-1.5 h-px bg-[var(--line)]" />
                {isMine ? (
                  <>
                    <DropdownMenu.Item className={item} onSelect={() => pin.mutate()}>
                      {post.is_pinned ? <PinOff size={17} /> : <Pin size={17} />}
                      {post.is_pinned ? "Unpin" : "Pin"}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={item}
                      onSelect={() => setEdit((current) => ({ open: true, seq: current.seq + 1 }))}
                    >
                      <Pencil size={17} />
                      Edit
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={cn(item, "text-[var(--danger)]")}
                      // The menu closes first and the dialog opens after: holding the menu open
                      // with preventDefault leaves its focus trap over the page once the dialog
                      // is dismissed, and nothing on the card answers the mouse again.
                      onSelect={() => setConfirmDelete(true)}
                    >
                      <Trash2 size={17} />
                      Delete
                    </DropdownMenu.Item>
                  </>
                ) : (
                  <DropdownMenu.Item
                    className={cn(item, "text-[var(--danger)]")}
                    onSelect={() => setReport((current) => ({ open: true, seq: current.seq + 1 }))}
                  >
                    <Flag size={17} />
                    Report
                  </DropdownMenu.Item>
                )}
                {/* Staff decisions on the card itself: a moderator reading the feed should not
                    have to find the same post again in the panel. */}
                {me?.is_admin ? (
                  <>
                    <DropdownMenu.Separator className="mx-2 my-1.5 h-px bg-[var(--line)]" />
                    {post.hidden_at ? (
                      <DropdownMenu.Item
                        className={item}
                        onSelect={() => staffRestore.mutate()}
                      >
                        <Eye size={17} />
                        Restore (admin)
                      </DropdownMenu.Item>
                    ) : (
                      <DropdownMenu.Item
                        className={item}
                        onSelect={() => setStaffAction("hide")}
                      >
                        <EyeOff size={17} />
                        Hide (admin)
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Item
                      className={cn(item, "text-[var(--danger)]")}
                      onSelect={() => setStaffAction("delete")}
                    >
                      <Gavel size={17} />
                      Delete (admin)
                    </DropdownMenu.Item>
                  </>
                ) : null}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        {text ? (
          <PostText
            text={text}
            full={!openOnClick}
            className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-6 text-[#ededf1]"
          />
        ) : null}

        {post.poll ? <PostPoll post={post} poll={post.poll} /> : null}
        {post.file_url ? (
          <PostFileCard
            url={post.file_url}
            name={post.file_name ?? "File"}
            size={post.file_size}
          />
        ) : null}
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
              <span className="text-[15px] font-bold">18+ content</span>
              <span className="text-[13px] text-[var(--muted)]">
                The author marked the attachments as sensitive. Tap to view.
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
              label={post.is_liked ? "Remove like" : "Like"}
              icon={<Heart size={19} fill={post.is_liked ? "currentColor" : "none"} />}
              count={post.likes_count}
              tone="like"
              active={post.is_liked}
              /* Not disabled while in flight: the state is already optimistic, and a dead
                 button right after a tap is what made a like feel like it had not registered. */
              onClick={() => like.mutate()}
            />
            <PostAction
              label="Comments"
              icon={<MessageCircle size={19} />}
              count={post.comments_count}
              tone="comment"
              href={`/post/${post.id}`}
            />
            <PostAction
              label="Repost"
              icon={<Repeat2 size={19} />}
              count={post.reposts_count}
              tone="repost"
              active={post.is_reposted}
              onClick={() => repost.mutate()}
            />
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1">
            {isMine ? (
              // Nobody supports their own post, so this is a tally, not a control.
              <span
                className="inline-flex items-center text-[var(--stars)]"
                title="Stars for this post"
                aria-label={`Stars for this post: ${post.stars_count ?? 0}`}
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
                aria-label={`Support with stars${post.stars_count ? `, ${post.stars_count}` : ""}`}
                title="Support with stars"
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
              title="Views"
              aria-label={`Views: ${post.views_count ?? 0}`}
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
        title="Delete this post?"
        description="The post will disappear from the feed and profile. This action can't be undone."
        confirmLabel={remove.isPending ? "Deleting…" : "Delete"}
        error={remove.error?.message}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
      {/* Staff decisions need a reason, so they get their own dialog rather than a bare confirm:
          the text lands in the audit log and in the author's notification. */}
      <Dialog.Root
        open={staffAction !== null}
        onOpenChange={(next) => {
          if (!next) {
            setStaffAction(null);
            setStaffReason("");
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[96] w-[min(26rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[24px] bg-[var(--surface)] p-5 shadow-[0_24px_70px_rgba(0,0,0,.66),inset_0_0_0_1px_var(--line)] outline-none">
            <Dialog.Title className="m-0 text-lg font-extrabold leading-tight">
              {staffAction === "delete" ? "Delete this post?" : "Hide this post?"}
            </Dialog.Title>
            <Dialog.Description className="mb-0 mt-1.5 text-[14px] leading-5 text-[var(--muted)]">
              {staffAction === "delete"
                ? "The post will disappear entirely. The author will be notified with the reason."
                : "The post stays visible to the author and administrators. The author will be notified with the reason."}
            </Dialog.Description>
            <input
              value={staffReason}
              onChange={(event) => setStaffReason(event.target.value)}
              placeholder="Reason — required"
              className="mt-3 min-h-11 w-full rounded-[12px] border-0 bg-[var(--surface-raised)] px-3 text-[14px] outline-none placeholder:text-[var(--dim)]"
            />
            <div className="mt-4 flex gap-2">
              <Dialog.Close className="quiet-button flex-1">Cancel</Dialog.Close>
              <button
                type="button"
                disabled={
                  staffReason.trim().length < 3 || staffHide.isPending || staffDelete.isPending
                }
                onClick={() => (staffAction === "delete" ? staffDelete.mutate() : staffHide.mutate())}
                className="flex min-h-[46px] flex-1 items-center justify-center rounded-full border-0 px-4 font-bold text-white transition disabled:opacity-60"
                style={{ background: staffAction === "delete" ? "var(--danger)" : "var(--primary)" }}
              >
                {staffAction === "delete" ? "Delete" : "Hide"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
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
