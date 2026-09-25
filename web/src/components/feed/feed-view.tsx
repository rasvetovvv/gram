"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Bell, Star } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Post, User } from "@/lib/types";
import { compactNumber, plural } from "@/lib/utils";
import { useUiStore } from "@/store/ui";
import { StoriesRail } from "../stories/stories-rail";
import { useSocialEvents, type SocialEvent } from "../use-social-socket";
import { FeedMenu } from "./feed-menu";
import { PostCard } from "./post-card";
import { PostComposer } from "./post-composer";
import { SuggestedPeople } from "./suggested-people";

type FeedMode = "for-you" | "following" | "topics";
type FollowableUser = User & { is_following?: boolean };

/** Above this the reader is at the top of the feed and new posts may simply appear. */
const TOP_THRESHOLD = 220;

function atTop() {
  return typeof window === "undefined" || window.scrollY < TOP_THRESHOLD;
}

export function FeedView() {
  const openComposer = useUiStore((state) => state.openComposer);
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [mode, setMode] = useState<FeedMode>("for-you");
  const { data: posts = [], isLoading, error, refetch } = useQuery({
    queryKey: ["feed"],
    queryFn: () => api.feed(),
    // The socket carries new posts; the poll is only the net under a dropped connection.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });

  const visiblePosts = useMemo(() => {
    if (mode === "following") return posts.filter((post) => (post.author as FollowableUser).is_following);
    if (mode === "topics") return posts.filter((post) => /(^|\s)[#@][\p{L}\d_]+/u.test(post.content));
    return posts;
  }, [mode, posts]);

  /**
   * When this screen opened, so a post can be told from a post that arrived since.
   *
   * Only the latter animates in: sliding the whole first page would mean the feed moving on
   * every mount, which is exactly what makes a page feel like it reloaded.
   */
  const [openedAt] = useState(() => Date.now());

  /**
   * The list as the reader currently sees it, held still on purpose.
   *
   * Swapping posts in under somebody who is three screens down moves the words under their eyes.
   * When a post arrives while they are reading, the *membership and order* they already have is
   * frozen here and the new ones are announced by a pill instead. `null` means "show the live
   * response", which is the normal state at the top of the feed.
   */
  const [held, setHeld] = useState<Post[] | null>(null);

  /**
   * Held is about position, not about content.
   *
   * Freezing whole objects would also freeze every like count and edit on the cards already on
   * screen — stale numbers are their own reason to reload. So the held list keeps its order and
   * membership while each card adopts the newest version of itself, and a post deleted meanwhile
   * drops out rather than lingering.
   */
  const list = useMemo(() => {
    if (!held) return visiblePosts;
    const live = new Map(visiblePosts.map((post) => [post.id, post]));
    return held.map((post) => live.get(post.id)).filter((post): post is Post => Boolean(post));
  }, [held, visiblePosts]);

  const waiting = useMemo(() => {
    if (!held) return 0;
    const known = new Set(held.map((post) => post.id));
    return visiblePosts.filter((post) => !known.has(post.id)).length;
  }, [held, visiblePosts]);

  const release = useCallback(() => setHeld(null), []);

  const showFresh = useCallback(() => {
    setHeld(null);
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }, [reduceMotion]);

  /**
   * A post, comment or like anywhere in GRAM reaches this screen over the shared socket.
   *
   * The frame itself is not the post — it only says something changed — so the feed refetches.
   * Whether that refetch is allowed to move the page is decided here, before it happens: my own
   * publication follows me, a stranger's waits behind the pill unless I am already at the top.
   */
  const myId = me?.id;
  const onSocial = useCallback(
    (event: SocialEvent) => {
      if (
        event.type !== "post_created" &&
        event.type !== "post_updated" &&
        event.type !== "post_deleted" &&
        event.type !== "post_reacted" &&
        event.type !== "comment_created" &&
        event.type !== "comment_deleted"
      ) {
        return;
      }
      const mine = Boolean(myId && event.actor_id === myId);
      // My own publication follows me: whatever was being held back comes along with it.
      if (event.type === "post_created" && mine) {
        setHeld(null);
      } else if (event.type === "post_created" && !atTop()) {
        // Only a genuinely new post can shift the page; an edit or a like changes a card in place.
        setHeld((current) => current ?? visiblePosts);
      }
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
    [myId, queryClient, visiblePosts]
  );
  useSocialEvents(onSocial);

  /** Reaching the top on one's own is the same intent as pressing the pill. */
  useEffect(() => {
    if (!held) return;
    const onScroll = () => {
      if (atTop()) release();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [held, release]);

  return (
    <>
      <div className="mobile-topbar">
        <span className="wordmark">GRAM</span>
        <span className="flex items-center gap-1">
          {/* The reference keeps the star balance beside the wordmark on phones. */}
          <Link
            href="/stars"
            className="flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-extrabold text-[var(--stars)]"
            aria-label={`Stars: ${me?.stars_balance ?? 0}`}
          >
            <Star size={16} fill="currentColor" />
            {compactNumber(me?.stars_balance ?? 0)}
          </Link>
          <Link href="/notifications" className="icon-button" aria-label="Notifications"><Bell size={21} /></Link>
        </span>
      </div>

      <header className="channel-header">
        <div>
          <h1 className="channel-title">Feed</h1>
          <p className="channel-subtitle">People, communities and topics close to you</p>
        </div>
        <span className="flex items-center gap-1">
          {/* The reference keeps the star balance in the feed's own header on wide screens too. */}
          <Link
            href="/stars"
            className="hidden min-h-9 items-center gap-1.5 rounded-full bg-[var(--surface-raised)] px-3 text-sm font-extrabold text-[var(--stars)] transition hover:brightness-110 lg:flex"
            aria-label={`Stars: ${me?.stars_balance ?? 0}`}
          >
            <Star size={15} fill="currentColor" />
            {compactNumber(me?.stars_balance ?? 0)}
          </Link>
          <FeedMenu />
        </span>
      </header>

      <div className="px-3 pb-3 sm:px-5">
        <div className="segmented-control" role="tablist" aria-label="Feed mode">
          {[
            { value: "for-you" as const, label: "For you" },
            { value: "following" as const, label: "Following" },
            { value: "topics" as const, label: "Tags" }
          ].map((item) => (
            <button
              key={item.value}
              role="tab"
              aria-selected={mode === item.value}
              data-active={mode === item.value}
              onClick={() => {
                // Switching the section is the reader's own move: nothing is held back from it.
                setMode(item.value);
                setHeld(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Subscriptions, not the authors of the posts below: a rail that changes with the
          algorithm is not a way back to anybody. */}
      <StoriesRail />

      <section className="border-b border-[var(--line)] px-3 py-3 sm:px-5" aria-label="New post">
        <PostComposer avatarUrl={me?.avatar_url} displayName={me?.display_name} />
      </section>

      {/* Held-back posts announce themselves instead of shifting the page. */}
      <AnimatePresence>
        {waiting ? (
          <motion.div
            className="feed-fresh-anchor"
            initial={reduceMotion ? undefined : { opacity: 0, y: -10, scale: 0.94 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <button type="button" className="feed-fresh-pill" onClick={showFresh}>
              <ArrowUp size={15} />
              {waiting} {plural(waiting, "new post", "new posts", "new posts")}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {isLoading ? (
        <div className="space-y-3 px-3 sm:px-5">
          {[0, 1, 2].map((item) => <div key={item} className="surface p-5"><div className="skeleton h-5 w-44 rounded-md" /><div className="skeleton mt-5 h-20 rounded-[16px]" /></div>)}
        </div>
      ) : error ? (
        <div className="empty-state">
          <p className="font-semibold text-white">Couldn&apos;t load the feed</p>
          <p className="text-sm">Check your connection and try again.</p>
          <button className="quiet-button mt-3" onClick={() => refetch()}>Retry</button>
        </div>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <p className="font-semibold text-white">{mode === "following" ? "It's quiet in your following" : "No matching posts"}</p>
          <p className="text-sm">{mode === "following" ? "Find interesting authors and follow them." : "Switch the section or create your first post."}</p>
          <Link className="signal-button mt-3" href={mode === "following" ? "/discover" : "#"} onClick={mode === "following" ? undefined : openComposer}>{mode === "following" ? "Find people" : "Create post"}</Link>
        </div>
      ) : (
        /* Keyed by the section, so switching "For you" ⇄ "Following" replaces the list with a short
           fade instead of swapping one wall of text for another under a still header. */
        <div key={mode} className="panel-enter space-y-3 px-3 pb-6 sm:px-5">
          {/* `popLayout` so a deleted post's neighbours glide up instead of snapping. */}
          <AnimatePresence initial={false} mode="popLayout">
            {list.map((post: Post, index) => {
              /* Written after this screen opened, so it is news to this reader and slides in.
                 Everything that was already here is drawn where it is, without motion. */
              const arrived = new Date(post.created_at).getTime() > openedAt;
              return (
                <motion.div
                  key={post.id}
                  layout={reduceMotion ? false : "position"}
                  initial={reduceMotion || !arrived ? false : { opacity: 0, y: -14, scale: 0.985 }}
                  animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, scale: 0.97, transition: { duration: 0.16 } }}
                  transition={{
                    duration: 0.34,
                    ease: [0.22, 1, 0.36, 1],
                    layout: { duration: 0.34, ease: [0.22, 1, 0.36, 1] }
                  }}
                >
                  <PostCard post={post} priority={index === 0} />
                  {/* The reference breaks its feed after the third post with a people rail. */}
                  {index === 2 ? <SuggestedPeople /> : null}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}
