"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Eye, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { nameColor } from "@/lib/profile-color";
import type { StoryFeedEntry } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";
import { VerifiedMark } from "../verified-mark";
import { isVideoStory, StoryMedia } from "./story-media";
import { StoryShareSheet } from "./story-share-sheet";

/** How long a picture holds the screen before the reel moves on, as the reference does it. */
const PICTURE_SECONDS = 5;

/** Where a reader entering somebody's reel should land: the first thing they have not seen. */
function firstUnseen(entry: StoryFeedEntry | undefined) {
  if (!entry) return 0;
  const index = entry.stories.findIndex((story) => !story.seen);
  return index < 0 ? 0 : index;
}

/**
 * The reel: one author's stories, then the next author's, in the order the rail is read.
 *
 * Mounted only while open, so the cursor starts from wherever the reader tapped without an
 * effect syncing props into state.
 */
export function StoryViewer({
  entries,
  authorIndex,
  storyIndex,
  onClose
}: {
  entries: StoryFeedEntry[];
  authorIndex: number;
  /** Set when the reader tapped one particular story, as a profile's grid lets them. */
  storyIndex?: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const reduceMotion = useReducedMotion();
  const [cursor, setCursor] = useState({
    author: authorIndex,
    story: storyIndex ?? firstUnseen(entries[authorIndex])
  });
  const [sharing, setSharing] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [clipSeconds, setClipSeconds] = useState<number | null>(null);

  const entry = entries[cursor.author];
  const story = entry?.stories[cursor.story];
  // A sheet over the reel is the reader doing something else; the reel waits for them.
  const paused = sharing || showViewers;

  const close = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["stories-feed"] });
    onClose();
  }, [onClose, queryClient]);

  const step = useCallback(
    (delta: 1 | -1) => {
      setClipSeconds(null);
      const stories = entries[cursor.author]?.stories ?? [];
      const nextStory = cursor.story + delta;
      if (nextStory >= 0 && nextStory < stories.length) {
        setCursor({ author: cursor.author, story: nextStory });
        return;
      }
      const nextAuthor = cursor.author + delta;
      const target = entries[nextAuthor];
      // Past the last author in either direction there is nothing left to watch.
      if (!target) {
        close();
        return;
      }
      setCursor({
        author: nextAuthor,
        story: delta === 1 ? 0 : Math.max(target.stories.length - 1, 0)
      });
    },
    [close, cursor.author, cursor.story, entries]
  );

  const markSeen = useMutation({ mutationFn: (id: string) => api.markStorySeen(id) }).mutate;
  const storyId = story?.id;
  const isMine = Boolean(story?.is_mine);
  useEffect(() => {
    // Watching one's own story is not an audience of one.
    if (!storyId || isMine) return;
    markSeen(storyId);
  }, [isMine, markSeen, storyId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, step]);

  const seconds = story && isVideoStory(story.media_url) ? clipSeconds : PICTURE_SECONDS;
  useEffect(() => {
    // A clip advances when it ends, so only a timed picture needs the timer.
    if (paused || !storyId || seconds === null) return;
    const timer = setTimeout(() => step(1), seconds * 1000);
    return () => clearTimeout(timer);
  }, [paused, seconds, step, storyId]);

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProfileStory(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["stories-feed"] });
      notify("Story deleted", { variant: "success" });
      close();
    },
    onError: (error: Error) =>
      notify("Couldn't delete the story", { variant: "error", detail: error.message })
  });

  if (!entry || !story) return null;
  const author = entry.author;

  return (
    <Dialog.Root open onOpenChange={(next) => (next ? undefined : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/95" />
        <Dialog.Content
          className="fixed inset-0 z-[121] flex flex-col outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">
            {story.title || `${author.display_name}'s story`}
          </Dialog.Title>

          {/* One bar per story of this author; the running one fills over its own length. */}
          <div className="absolute inset-x-3 top-[max(.6rem,env(safe-area-inset-top))] z-30 flex gap-1">
            {entry.stories.map((item, index) => (
              <span
                key={item.id}
                className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/25"
              >
                {index < cursor.story ? <span className="block h-full w-full bg-white" /> : null}
                {index === cursor.story ? (
                  // A paused reel, a clip of unknown length or a reader who asked for less
                  // motion gets a still bar instead of a lying one.
                  reduceMotion || seconds === null || paused ? (
                    <span className="block h-full w-1/2 bg-white" />
                  ) : (
                    <motion.span
                      key={item.id}
                      className="block h-full bg-white"
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: seconds, ease: "linear" }}
                    />
                  )
                ) : null}
              </span>
            ))}
          </div>

          <header className="relative z-30 flex flex-none items-center gap-2.5 px-3 pb-2 pt-[max(1.5rem,env(safe-area-inset-top))]">
            <Link href={`/u/${author.username}`} onClick={close} className="flex min-w-0 flex-1 items-center gap-2.5">
              <UserAvatar
                src={author.avatar_url}
                name={author.display_name}
                size={36}
                ringColor="rgba(255,255,255,.25)"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1">
                  <span
                    className="truncate text-[15px] font-bold text-white"
                    style={{ color: nameColor(author.profile_color) }}
                  >
                    {author.display_name}
                  </span>
                  {author.verified ? <VerifiedMark size={14} /> : null}
                </span>
                <span className="block truncate text-[12px] text-white/65">
                  {relativeTime(story.created_at)}
                </span>
              </span>
            </Link>
            <Dialog.Close
              className="inline-flex size-10 flex-none items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label="Close story"
            >
              <X size={21} />
            </Dialog.Close>
          </header>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-3 sm:px-16">
            <motion.div
              key={story.id}
              initial={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
              animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="relative h-full max-h-[calc(100dvh-11rem)] w-full max-w-[460px] overflow-hidden rounded-[20px] bg-[#0c0c10] shadow-[0_28px_80px_rgba(0,0,0,.62)]"
            >
              <StoryMedia
                url={story.media_url}
                alt={story.title || `${author.display_name}'s story`}
                onEnded={() => step(1)}
                onDuration={setClipSeconds}
              />
              {/* Tap zones, the way a phone expects: back on the left, forward on the right. */}
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous story"
                className="absolute inset-y-0 left-0 w-1/3 cursor-default border-0 bg-transparent"
              />
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next story"
                className="absolute inset-y-0 right-0 w-2/3 cursor-default border-0 bg-transparent"
              />
              {story.title ? (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 block bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.82))] px-4 pb-4 pt-10 text-[15px] leading-5 text-white">
                  {story.title}
                </span>
              ) : null}
            </motion.div>

            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Back"
              className="absolute left-2 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/75 sm:inline-flex"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next"
              className="absolute right-2 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/75 sm:inline-flex"
            >
              <ChevronRight size={24} />
            </button>
          </div>

          <footer className="relative z-30 flex flex-none items-center justify-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {story.is_mine ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowViewers(true)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-[15px] font-semibold text-white transition hover:bg-white/20"
                >
                  <Eye size={18} />
                  {story.views_count ?? 0}
                </button>
                <button
                  type="button"
                  onClick={() => setSharing(true)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-[15px] font-semibold text-white transition hover:bg-white/20"
                >
                  <Send size={18} />
                  Send
                </button>
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(story.id)}
                  aria-label="Delete story"
                  className="inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-[var(--danger)] transition hover:bg-white/20 disabled:opacity-60"
                >
                  <Trash2 size={18} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSharing(true)}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/12 px-5 text-[15px] font-semibold text-white transition hover:bg-white/20"
              >
                <Send size={18} />
                Send to a chat
              </button>
            )}
          </footer>

          {showViewers ? (
            <StoryViewers storyId={story.id} onClose={() => setShowViewers(false)} />
          ) : null}

          {/* Inside the dialog on purpose: Radix traps focus in its content, and a picker
              rendered outside it would open with its own field unreachable. */}
          <StoryShareSheet
            open={sharing}
            onClose={() => setSharing(false)}
            storyId={story.id}
            storyTitle={story.title}
            authorName={author.display_name}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Who watched: the author's own list, over the reel. */
function StoryViewers({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["story-viewers", storyId],
    queryFn: () => api.storyViewers(storyId)
  });

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="absolute inset-x-0 bottom-0 z-40 max-h-[60%] overflow-y-auto rounded-t-[22px] bg-[var(--sheet)] pb-[env(safe-area-inset-bottom)]"
    >
      <div className="sticky top-0 flex items-center justify-between bg-[var(--sheet)] px-4 py-3">
        <h3 className="m-0 text-[16px] font-bold">
          Views
          <span className="ml-2 text-[13px] font-medium text-[var(--muted)]">{data.length}</span>
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close viewers"
          className="inline-flex size-9 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
        >
          <X size={18} />
        </button>
      </div>
      {isLoading ? (
        <p className="m-0 px-4 pb-4 text-[13px] text-[var(--muted)]">Counting…</p>
      ) : data.length ? (
        data.map((viewer) => (
          <Link
            key={viewer.user.id}
            href={`/u/${viewer.user.username}`}
            className="flex items-center gap-3 px-4 py-2 transition hover:bg-white/[0.05]"
          >
            <UserAvatar src={viewer.user.avatar_url} name={viewer.user.display_name} size={40} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <span className="truncate text-[15px] font-semibold">
                  {viewer.user.display_name}
                </span>
                {viewer.user.verified ? <VerifiedMark size={13} /> : null}
              </span>
              <span className="block truncate text-[13px] text-[var(--muted)]">
                @{viewer.user.username}
              </span>
            </span>
            <span className="flex-none text-[12px] text-[var(--dim)]">
              {relativeTime(viewer.at)}
            </span>
          </Link>
        ))
      ) : (
        <p className="m-0 px-4 pb-4 text-[13px] text-[var(--muted)]">
          No one has opened this story yet.
        </p>
      )}
    </motion.div>
  );
}
