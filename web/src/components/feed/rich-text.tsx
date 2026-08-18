"use client";

import Link from "next/link";

/**
 * Post bodies carry hashtags, mentions and links. The reference makes all three tappable,
 * so the text is tokenised once and rendered as links rather than being escaped into a
 * flat paragraph.
 */
const TOKEN = /(https?:\/\/[^\s<]+)|(^|\s)#([\p{L}\p{N}_]{2,50})|(^|\s)@([a-z][a-z0-9_]{2,31})/giu;

export function RichText({ text, className = "" }: { text: string; className?: string }) {
  return <p className={`mb-0 whitespace-pre-wrap ${className}`}>{tokenise(text)}</p>;
}

function tokenise(text: string) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    const [full, url, hashLead, tag, atLead, handle] = match;
    if (index > cursor) nodes.push(text.slice(cursor, index));

    if (url) {
      nodes.push(
        <a
          key={`u${key}`}
          href={url}
          target="_blank"
          rel="noreferrer nofollow"
          className="break-all text-[var(--link)] hover:underline"
        >
          {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>
      );
    } else if (tag) {
      if (hashLead) nodes.push(hashLead);
      nodes.push(
        <Link key={`h${key}`} href={`/tags/${encodeURIComponent(tag.toLowerCase())}`} className="text-[var(--link)] hover:underline">
          #{tag}
        </Link>
      );
    } else if (handle) {
      if (atLead) nodes.push(atLead);
      nodes.push(
        <Link key={`m${key}`} href={`/u/${handle.toLowerCase()}`} className="text-[var(--link)] hover:underline">
          @{handle}
        </Link>
      );
    }

    cursor = index + full.length;
    key += 1;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
