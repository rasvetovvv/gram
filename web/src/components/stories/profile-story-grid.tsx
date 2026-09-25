"use client";

import { Clock, Eye, Pin } from "lucide-react";
import { useState } from "react";
import type { ProfileStory, StoryFeedEntry } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { StoryMedia } from "./story-media";
import { StoryViewer } from "./story-viewer";

/**
 * A profile's own stories as a grid, opening into the same reel the feed rail opens.
 *
 * One viewer for both places on purpose: sending a story to a chat, seeing who watched it and
 * taking it down are things an author wants wherever they are looking at it.
 */
export function ProfileStoryGrid({
  stories,
  className = ""
}: {
  stories: ProfileStory[];
  className?: string;
}) {
  const [at, setAt] = useState<number | null>(null);
  if (!stories.length) return null;

  // One author, since a profile's stories are all theirs; the reel needs the same shape the
  // rail gives it.
  const entries: StoryFeedEntry[] = [
    {
      author: stories[0].author,
      stories,
      has_unseen: stories.some((story) => !story.seen),
      is_me: Boolean(stories[0].is_mine)
    }
  ];

  return (
    <section className={className} aria-label="Profile stories">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stories.map((story, index) => (
          <button
            key={story.id}
            type="button"
            onClick={() => setAt(index)}
            className="group relative aspect-[3/4] overflow-hidden rounded-[18px] border-0 bg-[#121216] p-0 text-left shadow-[inset_0_0_0_1px_var(--line)]"
            aria-label={`Open story${story.title ? ` "${story.title}"` : ""}`}
          >
            <StoryMedia url={story.media_url} alt={story.title || "Story"} thumbnail />
            <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_38%,rgba(0,0,0,.88))]" />
            {/* A highlight stays after its day; that is the difference worth marking. */}
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-[3px] text-[10px] font-bold text-white/85">
              {story.highlight ? <Pin size={10} /> : <Clock size={10} />}
              {story.highlight ? "in profile" : "24 hours"}
            </span>
            {story.is_mine ? (
              <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-[3px] text-[10px] font-bold text-white/85">
                <Eye size={10} />
                {story.views_count ?? 0}
              </span>
            ) : null}
            <span className="absolute inset-x-0 bottom-0 block p-3">
              {story.title ? (
                <strong className="line-clamp-2 block text-sm leading-[1.25] text-white">
                  {story.title}
                </strong>
              ) : null}
              <span className="mt-1 block truncate text-[0.68rem] font-semibold text-white/70">
                {relativeTime(story.created_at)}
              </span>
            </span>
          </button>
        ))}
      </div>
      {at !== null ? (
        <StoryViewer
          entries={entries}
          authorIndex={0}
          storyIndex={at}
          onClose={() => setAt(null)}
        />
      ) : null}
    </section>
  );
}
