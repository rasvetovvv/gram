"use client";

import { Download, FileArchive, FileCode2, FileText, Play } from "lucide-react";
import { memo, useState } from "react";
import { API_URL } from "@/lib/api";
import { MediaViewer } from "../ui/media-viewer";

/**
 * What a bubble draws when the message carries something other than words.
 *
 * Kept out of `message-bubble.tsx` and memoised: a thread of a hundred rows re-mounts these on
 * every list change, and a `<video>` element in particular is expensive to build.
 */

const ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  zip: FileArchive,
  json: FileCode2,
  csv: FileCode2,
  md: FileText,
  txt: FileText,
  log: FileText
};

/** Sizes are read by people, so 12.4 MB beats 13002342 B. */
function readableSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Uploads come back root-relative, and outside the app's own origin need the API's. */
function absolute(url: string) {
  return url.startsWith("http") ? url : `${API_URL}${url}`;
}

/**
 * A picture or a clip, bleeding to the bubble's edges.
 *
 * The negative margins cancel the bubble's own padding without changing its width, so the
 * caption underneath keeps it. Both open the shared full-screen viewer — a picture used to open
 * its raw file in a new tab, which on a phone means leaving the app to look at what somebody just
 * sent you, and a clip could only be watched at 260px inside the bubble.
 */
function MessageMediaFrame({
  url,
  kind,
  caption
}: {
  url: string;
  kind: "image" | "video";
  caption: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const source = absolute(url);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(0)}
        aria-label={kind === "video" ? "Watch video" : "Open image"}
        /* Wider on a phone than the old fixed 260px — a picture in a bubble that is 86% of a
           360px screen has room for it — and unchanged on a desktop, where the column is fixed.
           The negative margins cancel the bubble's padding, hence the +1rem. */
        className="relative -mx-2 -mt-1 mb-1 block w-[calc(66vw+1rem)] max-w-[calc(100%+1rem)] overflow-hidden rounded-[13px] bg-black/40 transition active:opacity-[0.92] sm:w-[calc(260px+1rem)]"
      >
        {kind === "video" ? (
          <>
            {/* A poster frame rather than a live `<video>` per bubble: a thread with a dozen clips
                was building a dozen media elements, which is what made scrolling stutter. The
                real player lives in the viewer. `#t=0.1` makes iOS render a frame at all, and a
                user's upload carries no caption track. */}
            <video
              src={`${source}#t=0.1`}
              preload="metadata"
              muted
              playsInline
              tabIndex={-1}
              className="pointer-events-none block max-h-[300px] w-full object-cover sm:max-h-[340px]"
            />
            <span
              aria-hidden
              className="absolute inset-0 grid place-items-center bg-black/25 text-white"
            >
              <span className="grid size-12 place-items-center rounded-full bg-black/55 backdrop-blur-sm">
                <Play size={20} className="translate-x-px" fill="currentColor" />
              </span>
            </span>
          </>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- served from the API's own /media */
          <img
            src={source}
            alt={caption || "Image"}
            loading="lazy"
            className="block max-h-[300px] w-full object-cover sm:max-h-[340px]"
          />
        )}
      </button>
      <MediaViewer
        items={[{ url: source, kind, caption: caption || null }]}
        index={open}
        onClose={() => setOpen(null)}
        onIndex={() => undefined}
      />
    </>
  );
}

export const MessageMedia = memo(MessageMediaFrame);

/**
 * The document a message carries.
 *
 * Name and size are shown before anything is fetched, because deciding whether to pull down
 * 12 MB is the reader's call. The link always downloads: the server refuses to serve these
 * inline, and a browser that decided for itself would turn an upload into a page on our origin.
 */
function MessageFileRow({
  url,
  name,
  size,
  mine
}: {
  url: string;
  name: string;
  size?: number | null;
  mine: boolean;
}) {
  const extension = (name.split(".").pop() ?? "").toLowerCase();
  const Icon = ICONS[extension] ?? FileText;
  return (
    <a
      href={absolute(url)}
      download={name}
      className={`-mx-1 mb-1 flex w-[236px] max-w-full items-center gap-2.5 rounded-[13px] p-1.5 pr-2.5 transition ${
        mine ? "bg-black/20 hover:bg-black/30" : "bg-white/[0.06] hover:bg-white/[0.1]"
      }`}
    >
      <span
        className={`grid size-11 flex-none place-items-center rounded-[12px] ${
          mine ? "bg-white/15 text-white" : "bg-black/25 text-[var(--primary-strong)]"
        }`}
      >
        <Icon size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold leading-5">{name}</span>
        <span
          className={`block text-[12px] uppercase tracking-wide ${
            mine ? "text-white/65" : "text-[var(--dim)]"
          }`}
        >
          {extension || "file"}
          {typeof size === "number" ? ` · ${readableSize(size)}` : ""}
        </span>
      </span>
      <span
        aria-hidden
        className={`grid size-8 flex-none place-items-center rounded-full ${
          mine ? "bg-white/20 text-white" : "bg-white/10 text-[var(--ink)]"
        }`}
      >
        <Download size={15} />
      </span>
    </a>
  );
}

export const MessageFile = memo(MessageFileRow);

/** The play badge the panel's «Media» grid puts over a clip's thumbnail. */
export function VideoBadge() {
  return (
    <span
      aria-hidden
      className="absolute inset-0 grid place-items-center bg-black/25 text-white"
    >
      <span className="grid size-7 place-items-center rounded-full bg-black/55">
        <Play size={13} className="translate-x-px" />
      </span>
    </span>
  );
}

export { readableSize };
