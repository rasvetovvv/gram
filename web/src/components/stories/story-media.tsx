"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";

/** A clip is told from its container, the same way the profile's own story sheet tells it. */
export function isVideoStory(url: string) {
  const clean = url.split(/[?#]/, 1)[0]?.toLocaleLowerCase("en-US") ?? "";
  return /\.(mp4|m4v|mov|webm|ogv)$/.test(clean);
}

/**
 * One story's picture or clip, with the same fallback everywhere it appears: a story whose
 * media has gone says so rather than leaving a black rectangle.
 *
 * `onEnded` is what advances the reel for a clip — a video's own length is the only honest
 * duration for it, and a timer would cut it off or leave it hanging.
 */
export function StoryMedia({
  url,
  alt,
  thumbnail = false,
  muted = true,
  onEnded,
  onDuration
}: {
  url: string;
  alt: string;
  thumbnail?: boolean;
  muted?: boolean;
  onEnded?: () => void;
  /** A clip's own length, once the browser knows it: the reel's bar runs for exactly that. */
  onDuration?: (seconds: number) => void;
}) {
  const [failed, setFailed] = useState(false);

  if (failed || !url) {
    return (
      <span className="grid h-full w-full place-items-center bg-[#121216] text-center text-[var(--muted)]">
        <span>
          <ImageOff className="mx-auto" size={thumbnail ? 20 : 32} />
          {thumbnail ? null : <span className="mt-2 block text-sm">Media unavailable</span>}
        </span>
      </span>
    );
  }

  if (isVideoStory(url)) {
    return (
      <video
        src={url}
        autoPlay={!thumbnail}
        muted={muted || thumbnail}
        playsInline
        preload={thumbnail ? "metadata" : "auto"}
        onEnded={onEnded}
        onLoadedMetadata={(event) => {
          const { duration } = event.currentTarget;
          if (onDuration && Number.isFinite(duration) && duration > 0) onDuration(duration);
        }}
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
        aria-label={alt}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- served from the API's own /media, not the Next image pipeline
    <img
      src={url}
      alt={alt}
      loading={thumbnail ? "lazy" : "eager"}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}
