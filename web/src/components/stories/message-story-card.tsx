"use client";

import { useQuery } from "@tanstack/react-query";
import { Clock, Sparkles } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { MessageStory, StoryFeedEntry } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { UserAvatar } from "../user-avatar";
import { StoryMedia } from "./story-media";
import { StoryViewer } from "./story-viewer";

/**
 * A story somebody shared into a chat.
 *
 * The card points at the story rather than copying it, so it tells the truth after the window
 * closes: an expired reel says so instead of playing media that is no longer anyone's story.
 */
export function MessageStoryCard({ story, mine }: { story: MessageStory; mine: boolean }) {
  const [open, setOpen] = useState(false);
  // Cached from the app shell; it only costs a read, and it decides whether the reel offers
  // the author's own controls.
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });

  const entries: StoryFeedEntry[] = [
    {
      author: story.author,
      stories: [
        {
          id: story.id,
          author: story.author,
          title: story.title,
          media_url: story.media_url,
          created_at: story.created_at,
          expires_at: story.expires_at,
          highlight: false,
          // Already open in front of the reader, so there is nothing to mark or count here.
          seen: true,
          is_mine: Boolean(me && me.id === story.author.id)
        }
      ],
      has_unseen: false,
      is_me: Boolean(me && me.id === story.author.id)
    }
  ];

  const frame = (
    <span
      className="block overflow-hidden rounded-[14px]"
      style={{
        background: mine ? "rgba(0,0,0,.22)" : "rgba(255,255,255,.05)",
        boxShadow: `inset 0 0 0 1px ${mine ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.08)"}`
      }}
    >
      <span className="relative block aspect-[4/5] w-full">
        {story.active ? (
          <StoryMedia url={story.media_url} alt={story.title || "Story"} thumbnail />
        ) : (
          <span className="grid h-full w-full place-items-center bg-black/35 text-center">
            <span className="px-4">
              <Clock size={22} className="mx-auto text-white/70" />
              <span className="mt-1.5 block text-[13px] font-semibold text-white/85">
                Story unavailable
              </span>
              <span className="mt-0.5 block text-[11px] text-white/55">
                Its 24 hours are up
              </span>
            </span>
          </span>
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 block bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.85))] px-2.5 pb-2 pt-8">
          <span className="flex items-center gap-1.5">
            <UserAvatar
              src={story.author.avatar_url}
              name={story.author.display_name}
              size={20}
              ringColor="rgba(255,255,255,.35)"
            />
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-white">
              {story.author.display_name}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-white/70">
            <Sparkles size={10} />
            Story · {relativeTime(story.created_at)}
          </span>
        </span>
      </span>
    </span>
  );

  if (!story.active) return <span className="block w-[200px] max-w-full">{frame}</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-[200px] max-w-full border-0 bg-transparent p-0 text-left transition active:scale-[0.98]"
        aria-label={`View ${story.author.display_name}'s story`}
      >
        {frame}
      </button>
      {open ? (
        <StoryViewer entries={entries} authorIndex={0} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}