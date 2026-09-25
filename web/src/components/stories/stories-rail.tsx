"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { StoryFeedEntry } from "@/lib/types";
import { UserAvatar } from "../user-avatar";
import { StoryComposer } from "./story-composer";
import { StoryViewer } from "./story-viewer";

/** An unwatched reel is the one thing in the rail worth colour. */
const UNSEEN_RING = "linear-gradient(145deg,#9e8cff,#52d4ff,#25db7c)";
const SEEN_RING = "#35353d";
const QUIET_RING = "rgba(255,255,255,.10)";
/**
 * How many followed people with nothing live the rail will draw.
 *
 * Every tile is an avatar request that Radix starts immediately, so a reader following four
 * hundred people would otherwise pay for four hundred of them to reach a shortcut. Whoever
 * *is* showing something is never cut; the tail is, and the last tile leads to the full list.
 */
const QUIET_LIMIT = 24;

/**
 * The rail above the feed: the people this reader follows, and what they are showing now.
 *
 * Deliberately *not* the authors of the posts below it. A feed is full of strangers arriving
 * through reposts and recommendations, and a row of faces that changes with the algorithm is
 * not a way back to anybody. Subscriptions are.
 */
export function StoriesRail() {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const { data: entries = [] } = useQuery({
    queryKey: ["stories-feed"],
    queryFn: api.storiesFeed,
    // Somebody's day-long story appearing within a minute is close enough to live.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  });
  const { data: following = [] } = useQuery({
    queryKey: ["following", me?.username],
    queryFn: () => api.following(me!.username),
    enabled: Boolean(me?.username)
  });
  const [composing, setComposing] = useState(false);
  const [reelAt, setReelAt] = useState<number | null>(null);

  const mineIndex = entries.findIndex((entry) => entry.is_me);
  const quietTotal = following.filter(
    (person) => person.id !== me?.id && !entries.some((entry) => entry.author.id === person.id)
  ).length;
  const tiles = useMemo(() => {
    const withStories = new Map<string, number>();
    entries.forEach((entry, index) => withStories.set(entry.author.id, index));
    // Whoever has something live comes first, in the order the server already ranked them;
    // the rest of the subscriptions follow, so the rail is still a way to reach them.
    const storied = entries
      .filter((entry) => !entry.is_me)
      .map((entry) => ({
        person: entry.author,
        index: withStories.get(entry.author.id) ?? null,
        entry
      }));
    const quiet = following
      .filter((person) => !withStories.has(person.id) && person.id !== me?.id)
      .slice(0, QUIET_LIMIT)
      .map((person) => ({ person, index: null, entry: null as StoryFeedEntry | null }));
    return [...storied, ...quiet];
  }, [entries, following, me?.id]);

  if (!me) return null;

  return (
    <section className="border-y border-[var(--line)] py-3.5" aria-label="Stories from people you follow">
      <div className="flex gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-6">
        {/* Mine first: the rail is also where a story is published from. */}
        <div className="flex w-[66px] flex-none flex-col items-center gap-2">
          <span className="relative">
            <button
              type="button"
              onClick={() => (mineIndex >= 0 ? setReelAt(mineIndex) : setComposing(true))}
              className="block rounded-full border-0 bg-transparent p-0"
              aria-label={mineIndex >= 0 ? "Open my story" : "Add a story"}
            >
              <Ring active={mineIndex >= 0} seen>
                <UserAvatar
                  src={me.avatar_url}
                  name={me.display_name}
                  size={50}
                  ringColor="var(--canvas)"
                />
              </Ring>
            </button>
            <button
              type="button"
              onClick={() => setComposing(true)}
              aria-label="Add a story"
              className="absolute -bottom-0.5 -right-0.5 grid size-[22px] place-items-center rounded-full border-[2.5px] border-[var(--canvas)] bg-[var(--primary)] text-white transition active:scale-90"
            >
              <Plus size={13} strokeWidth={3} />
            </button>
          </span>
          <span className="w-full truncate text-center text-[0.7rem] text-[var(--muted)]">
            My story
          </span>
        </div>

        {tiles.map(({ person, index, entry }) =>
          index === null || !entry ? (            // Somebody I follow with nothing live: the tile still leads to them.
            <Link
              key={person.id}
              href={`/u/${person.username}`}
              className="flex w-[66px] flex-none flex-col items-center gap-2"
            >
              <Ring active={false} seen={false}>
                <UserAvatar
                  src={person.avatar_url}
                  name={person.display_name}
                  size={50}
                  ringColor="var(--canvas)"
                />
              </Ring>
              <span className="w-full truncate text-center text-[0.7rem] text-[var(--muted)]">
                {person.display_name.split(" ")[0]}
              </span>
            </Link>
          ) : (
            <button
              key={person.id}
              type="button"
              onClick={() => setReelAt(index)}
              className="flex w-[66px] flex-none flex-col items-center gap-2 border-0 bg-transparent p-0"
              aria-label={`Watch ${person.display_name}'s story`}
            >
              <Ring active seen={!entry.has_unseen}>
                <UserAvatar
                  src={person.avatar_url}
                  name={person.display_name}
                  size={50}
                  ringColor="var(--canvas)"
                />
              </Ring>
              <span
                className={`w-full truncate text-center text-[0.7rem] ${
                  entry.has_unseen ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]"
                }`}
              >
                {person.display_name.split(" ")[0]}
              </span>
            </button>
          )
        )}
        {quietTotal > QUIET_LIMIT ? (
          // The tail is cut, so the rail says where the whole list is instead of ending flat.
          <Link
            href={`/u/${me.username}`}
            className="flex w-[66px] flex-none flex-col items-center gap-2"
            aria-label="All the people I follow"
          >
            <span className="grid size-[56px] place-items-center rounded-full bg-[var(--surface-raised)] text-[13px] font-bold text-[var(--muted)]">
              +{quietTotal - QUIET_LIMIT}
            </span>
            <span className="w-full truncate text-center text-[0.7rem] text-[var(--muted)]">
              All
            </span>
          </Link>
        ) : null}
        {tiles.length ? null : (
          // Following nobody is a real state, and a lone tile explains nothing on its own.
          <Link
            href="/discover"
            className="flex flex-none items-center px-1 text-[12px] leading-4 text-[var(--dim)] transition hover:text-[var(--ink)]"
          >
            Follow some people —
            <br />
            their stories will show up here
          </Link>
        )}
      </div>

      <StoryComposer open={composing} onOpenChange={setComposing} />
      {reelAt !== null && entries[reelAt] ? (
        <StoryViewer entries={entries} authorIndex={reelAt} onClose={() => setReelAt(null)} />
      ) : null}
    </section>
  );
}

/** The ring says three things at a glance: live and unwatched, live and watched, or nothing. */
function Ring({
  active,
  seen,
  children
}: {
  active: boolean;
  seen: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className="block rounded-full p-[2px]"
      style={{ background: active ? (seen ? SEEN_RING : UNSEEN_RING) : QUIET_RING }}
    >
      <span className="block rounded-full border-[3px] border-[var(--canvas)]">{children}</span>
    </span>
  );
}
