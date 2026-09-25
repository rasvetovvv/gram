"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useState } from "react";
import { RichText } from "./rich-text";

/**
 * A post body that folds itself when it is long.
 *
 * A wall of text pushes everything after it off the screen, so a feed of them reads as one
 * post at a time. The fold is a `max-height` rather than `line-clamp` on purpose: a body may
 * contain a fenced code block, and `-webkit-line-clamp` needs `display:-webkit-box`, which
 * takes such a block out of normal flow.
 *
 * Nothing is folded that would not actually be cut: the height is measured, and the control
 * appears only when there is something below the edge.
 */

/** Ten lines of the card's own 24px leading — about where the reference folds a post. */
const FOLDED_MAX_HEIGHT = 240;
/** Blank lines the author typed count too: twelve short ones overflow while the text stays small. */
const FOLDABLE_LINES = 10;
/** No shorter body fills ten lines at any width the card is given, so it is never measured. */
const SHORTEST_FOLDABLE = 420;
/** A few pixels of overflow are a rounding artefact, not a hidden paragraph. */
const OVERFLOW_SLACK = 8;

function lineCount(text: string) {
  let lines = 1;
  for (const character of text) if (character === "\n") lines += 1;
  return lines;
}

export function PostText({
  text,
  className = "",
  full = false
}: {
  text: string;
  className?: string;
  /** Set on the post's own page: the reader opened it to read all of it. */
  full?: boolean;
}) {
  // The reader's own choice about this card. Deliberately not remembered anywhere: a post
  // they opened yesterday is not one they asked to keep open.
  const [folded, setFolded] = useState(true);
  const [cut, setCut] = useState(false);
  const foldable =
    !full && (text.length >= SHORTEST_FOLDABLE || lineCount(text) > FOLDABLE_LINES);

  /**
   * A ref callback rather than an effect: React attaches it when the folded body mounts and
   * runs the returned cleanup when it unmounts, so the observer's life matches the element's.
   */
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return undefined;
    const check = () => setCut(node.scrollHeight - node.clientHeight > OVERFLOW_SLACK);
    check();
    // Whether ten lines are enough depends on the width: a rotated phone changes the answer.
    const observer = new ResizeObserver(check);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className="relative">
        <div
          // Measured only while folded. An open body reports that it fits, which would take
          // its own “Collapse” away.
          ref={foldable && folded ? measure : null}
          style={foldable && folded ? { maxHeight: FOLDED_MAX_HEIGHT, overflow: "hidden" } : undefined}
        >
          <RichText text={text} className={className} />
        </div>
        {/* The last line fades into the card instead of stopping mid-letter. */}
        {foldable && folded && cut ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 block h-16 bg-[linear-gradient(180deg,transparent,var(--surface))]"
          />
        ) : null}
      </div>
      {foldable && cut ? (
        <button
          type="button"
          // The card itself opens the post on click; unfolding is not that.
          data-keep-click
          aria-expanded={!folded}
          onClick={() => setFolded((current) => !current)}
          className="mt-1 inline-flex min-h-9 items-center gap-1 rounded-full border-0 bg-transparent px-0 text-[14px] font-bold text-[var(--link)] transition hover:underline active:scale-[0.98]"
        >
          {folded ? "Read more" : "Collapse"}
          <ChevronDown
            size={15}
            className={`transition-transform duration-200 ${folded ? "" : "rotate-180"}`}
          />
        </button>
      ) : null}
    </>
  );
}
