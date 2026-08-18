"use client";

import Link from "next/link";

/**
 * Message text with inline formatting.
 *
 * The composer wraps a selection in markers, so the bubble has to read them back: `**bold**`,
 * `*italic*`, `__underline__`, `~~strike~~`, `` `code` `` and `[label](url)`. Links, hashtags
 * and mentions inside the remaining plain runs stay tappable.
 *
 * Each paired marker is tempered — `(?:(?!\*\*).)+` rather than `[^*]+` — so a nested format
 * survives instead of breaking the outer one: `**a *b* c**` stays bold with italics inside.
 */
const FORMAT =
  /\*\*((?:(?!\*\*)[\s\S])+)\*\*|__((?:(?!__)[\s\S])+)__|~~((?:(?!~~)[\s\S])+)~~|`([^`]+)`|\*([^*\n]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const TOKEN = /(https?:\/\/[^\s<]+)|(^|\s)#([\p{L}\p{N}_]{2,50})|(^|\s)@([a-z][a-z0-9_]{2,31})/giu;

export function MessageText({ text, mine }: { text: string; mine: boolean }) {
  return (
    <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{format(text, mine)}</p>
  );
}

function format(text: string, mine: boolean, depth = 0): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  // Formats stack, so a marker's contents are parsed again. Each pass works on a strictly
  // shorter string, and the depth cap is a belt on top of that.
  const inner = (content: string) =>
    depth < 4 ? format(content, mine, depth + 1) : [content];

  for (const match of text.matchAll(FORMAT)) {
    const index = match.index ?? 0;
    const [full, bold, underline, strike, code, italic, label, href] = match;
    if (index > cursor) nodes.push(...linkify(text.slice(cursor, index), mine, `p${depth}-${key}`));

    if (bold)
      nodes.push(
        <strong key={`b${key}`} className="font-semibold">
          {inner(bold)}
        </strong>
      );
    else if (underline) nodes.push(<u key={`u${key}`}>{inner(underline)}</u>);
    else if (strike) nodes.push(<s key={`s${key}`}>{inner(strike)}</s>);
    else if (code)
      nodes.push(
        <code key={`c${key}`} className="rounded bg-black/25 px-1 py-0.5 font-mono text-[.92em]">
          {code}
        </code>
      );
    else if (italic) nodes.push(<em key={`i${key}`}>{inner(italic)}</em>);
    else if (label && href)
      nodes.push(
        <a
          key={`l${key}`}
          href={href}
          target="_blank"
          rel="noreferrer nofollow"
          className={`underline ${mine ? "text-white" : "text-[var(--link)]"}`}
        >
          {label}
        </a>
      );

    cursor = index + full.length;
    key += 1;
  }

  if (cursor < text.length) nodes.push(...linkify(text.slice(cursor), mine, `t${depth}-${key}`));
  return nodes;
}

function linkify(text: string, mine: boolean, prefix: string) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  // An outgoing bubble is already accent-filled, so its links take white with an underline
  // rather than the link colour, which would disappear into the fill.
  const linkClass = `hover:underline ${mine ? "text-white underline" : "text-[var(--link)]"}`;

  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    const [full, url, hashLead, tag, atLead, handle] = match;
    if (index > cursor) nodes.push(text.slice(cursor, index));

    if (url) {
      nodes.push(
        <a
          key={`${prefix}u${key}`}
          href={url}
          target="_blank"
          rel="noreferrer nofollow"
          className={`[overflow-wrap:anywhere] ${linkClass}`}
        >
          {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>
      );
    } else if (tag) {
      if (hashLead) nodes.push(hashLead);
      nodes.push(
        <Link
          key={`${prefix}h${key}`}
          href={`/tags/${encodeURIComponent(tag.toLowerCase())}`}
          className={linkClass}
        >
          #{tag}
        </Link>
      );
    } else if (handle) {
      if (atLead) nodes.push(atLead);
      nodes.push(
        <Link key={`${prefix}m${key}`} href={`/u/${handle.toLowerCase()}`} className={linkClass}>
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
