"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import type { PostMusic } from "@/lib/types";

/**
 * The music card, copied from the reference's own attachment row: 48px artwork, the track over
 * the uploader, the provider in small caps, and one round action that leaves for the source.
 *
 * No embedded player: SoundCloud's iframe brings its own dark chrome and third-party cookies,
 * and the reference does not use it either.
 */
export function PostMusicCard({ music }: { music: PostMusic }) {
  return (
    /* 12px, not `rounded-2xl`: the reference's own scale computes to 12px here, and ours
       would round the same class to 16px. */
    <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-white/[0.07] bg-white/[0.04] p-2 pr-3">
      <span className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-white/[0.06]">
        {music.cover_url ? (
          /* eslint-disable-next-line @next/next/no-img-element -- remote artwork on a CDN we do not proxy */
          <img src={music.cover_url} alt="" loading="lazy" className="size-full object-cover" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-[var(--ink)]">
          {music.title}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {music.artist ? (
            <span className="min-w-0 truncate text-[13px] text-[var(--muted)]">{music.artist}</span>
          ) : null}
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--dim)]">
            SoundCloud
          </span>
        </span>
      </span>
      <a
        href={music.external_url}
        target="_blank"
        rel="noreferrer noopener"
        aria-label="Open in SoundCloud"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-[var(--ink)] transition hover:bg-white/15 active:scale-95"
      >
        <ExternalLink className="size-4" />
      </a>
    </div>
  );
}

/**
 * Reports one read of a post, once it has actually been on screen.
 *
 * Half the card visible for a moment is what the reference counts too — the old formula
 * (`240 + likes*19 + …`) claimed hundreds of views for posts nobody had opened.
 *
 * The guard is module-level rather than per-component: the same post can mount twice in one
 * session — a remount in development, the feed and a permalink, a card inside a dialog — and
 * none of those is a second read.
 */
const reported = new Set<string>();

export function useRecordView(postId: string, enabled = true) {
  const queryClient = useQueryClient();
  const node = useRef<HTMLElement | null>(null);
  const record = useMutation({
    mutationFn: () => api.recordPostView(postId),
    onSuccess: (receipt) => {
      // Only a first read moves the number of readers, so only then is the list stale.
      if (receipt.recorded) queryClient.invalidateQueries({ queryKey: ["feed"] });
    }
  });

  useEffect(() => {
    if (!enabled || reported.has(postId)) return;
    const element = node.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || reported.has(postId)) continue;
          reported.add(postId);
          record.mutate();
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(element);
    return () => observer.disconnect();
    // `record` is a stable mutation object from the hook; re-subscribing on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, enabled]);

  return node;
}
