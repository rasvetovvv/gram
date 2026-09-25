"use client";

import { useState } from "react";
import { MediaViewer, type ViewerItem } from "../ui/media-viewer";

/**
 * A post's pictures: one fills the width, two split it, three put the first one tall beside a
 * stack, four make a square. Tapping any of them opens the shared viewer.
 *
 * The grid is deliberately fixed rather than masonry: a feed that reflows as images decode is
 * the thing that makes a timeline feel unstable.
 *
 * The viewer itself used to live here and could only show pictures, so a chat bubble had nothing
 * to reuse. It is `components/ui/media-viewer` now, shared with the chat and the "Media" shelf.
 */
export function PostGallery({ urls, alt = "" }: { urls: string[]; alt?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const pictures = urls.slice(0, 4);
  if (!pictures.length) return null;

  const shape =
    pictures.length === 1
      ? "grid-cols-1"
      : pictures.length === 2
        ? "grid-cols-2"
        : "grid-cols-2 grid-rows-2";

  const items: ViewerItem[] = pictures.map((url) => ({ url, kind: "image", caption: alt || null }));

  return (
    <>
      <div className={`mt-3 grid gap-1 overflow-hidden rounded-[18px] ${shape}`}>
        {pictures.map((url, index) => (
          <button
            key={url}
            type="button"
            onClick={() => setOpen(index)}
            aria-label={`Open image ${index + 1} of ${pictures.length}`}
            className={`relative block overflow-hidden bg-[#111116] transition active:opacity-90 ${
              pictures.length === 3 && index === 0 ? "row-span-2" : ""
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served from the API's own /media */}
            <img
              src={url}
              alt={alt}
              loading="lazy"
              className={`block w-full object-cover ${
                pictures.length === 1 ? "max-h-[520px]" : "h-full min-h-[130px]"
              }`}
            />
          </button>
        ))}
      </div>
      <MediaViewer
        items={items}
        index={open}
        onClose={() => setOpen(null)}
        onIndex={(next) => setOpen(next)}
      />
    </>
  );
}

export { MediaViewer };
