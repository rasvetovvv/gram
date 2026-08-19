"use client";

import Link from "next/link";

/**
 * Post bodies carry hashtags, mentions, links and code. The reference makes the first three
 * tappable and sets the fourth in monospace, so the text is tokenised once and rendered as
 * elements rather than being escaped into a flat paragraph.
 *
 * Fenced blocks are split off first, because a URL or a `#tag` inside one is part of the code
 * and turning it into a link would change what the author wrote. Inline spans stay inside their
 * sentence — a `<p>` of their own would break the line around them.
 */
const TOKEN =
  /(`[^`\n]+`)|(https?:\/\/[^\s<]+)|(^|\s)#([\p{L}\p{N}_]{2,50})|(^|\s)@([a-z][a-z0-9_]{2,31})/giu;
const FENCE = /```([\s\S]*?)```/g;

export function RichText({ text, className = "" }: { text: string; className?: string }) {
  const blocks = splitFences(text);
  // Without a fenced block, the body stays one paragraph, exactly as it was.
  if (blocks.length === 1 && blocks[0].kind === "text")
    return <p className={`mb-0 whitespace-pre-wrap ${className}`}>{tokenise(text)}</p>;
  return (
    <div className={`grid gap-2 ${className}`}>
      {blocks.map((block, index) =>
        block.kind === "code" ? (
          <pre
            key={index}
            className="m-0 overflow-x-auto rounded-[12px] bg-black/45 p-3 font-mono text-[13px] leading-5 text-[#e6e6ec]"
          >
            <code>{block.value.replace(/^\n+|\n+$/g, "")}</code>
          </pre>
        ) : block.value.trim() ? (
          <p key={index} className="mb-0 whitespace-pre-wrap">
            {tokenise(block.value.replace(/^\n+|\n+$/g, ""))}
          </p>
        ) : null
      )}
    </div>
  );
}

type Block = { kind: "text" | "code"; value: string };

function splitFences(text: string): Block[] {
  const blocks: Block[] = [];
  let cursor = 0;
  for (const match of text.matchAll(FENCE)) {
    const index = match.index ?? 0;
    if (index > cursor) blocks.push({ kind: "text", value: text.slice(cursor, index) });
    blocks.push({ kind: "code", value: match[1] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) blocks.push({ kind: "text", value: text.slice(cursor) });
  return blocks.length ? blocks : [{ kind: "text", value: text }];
}

function tokenise(text: string) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    const [full, code, url, hashLead, tag, atLead, handle] = match;
    if (index > cursor) nodes.push(text.slice(cursor, index));

    if (code) {
      nodes.push(
        <code
          key={`c${key}`}
          className="rounded-[6px] bg-black/40 px-1.5 py-0.5 font-mono text-[0.92em]"
        >
          {code.slice(1, -1)}
        </code>
      );
    } else if (url) {
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
