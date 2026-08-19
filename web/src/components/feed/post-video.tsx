"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useReducedMotion } from "framer-motion";

/**
 * Our own player for a post's clip.
 *
 * The browser's default controls are a different product on every platform, and on iOS they
 * take the video fullscreen the moment it plays. This is one bar everywhere: play, a scrubber
 * that reports where it is, the elapsed and total time, mute, and fullscreen.
 *
 * A clip never plays by itself. Autoplay of anything with sound is the reference's own rule and
 * a reader's too, and `prefers-reduced-motion` is the same answer with a stronger reason.
 */
function clock(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function PostVideo({ src, poster }: { src: string; poster?: string | null }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  // A clip that scrolls away stops. Leaving it playing under the fold is what makes a feed
  // sound like a slot machine.
  useEffect(() => {
    const node = shell.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (!entry.isIntersecting) video.current?.pause();
      },
      { threshold: 0.35 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function toggle() {
    const node = video.current;
    if (!node) return;
    if (node.paused) void node.play();
    else node.pause();
  }

  if (failed)
    return (
      <p className="mt-2 rounded-[16px] bg-[var(--surface-raised)] p-3 text-[13px] text-[var(--muted)]">
        Видео не загрузилось. Возможно, автор его удалил.
      </p>
    );

  return (
    <div
      ref={shell}
      data-keep-click
      className="relative mt-2 overflow-hidden rounded-[16px] bg-black"
    >
      <video
        ref={video}
        src={src}
        poster={poster ?? undefined}
        playsInline
        muted={muted}
        preload="metadata"
        className="block max-h-[70vh] w-full bg-black object-contain"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(true)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
      />

      {/* The big affordance, while nothing is playing: a bar alone reads as a decoration. */}
      {!playing ? (
        <button
          type="button"
          onClick={toggle}
          aria-label="Воспроизвести видео"
          className="absolute inset-0 grid place-items-center bg-black/25 transition hover:bg-black/35"
        >
          <span className="grid size-14 place-items-center rounded-full bg-black/60 text-white backdrop-blur">
            <Play size={26} fill="currentColor" />
          </span>
        </button>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-6">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Пауза" : "Воспроизвести"}
          className="grid size-8 flex-none place-items-center rounded-full text-white transition hover:bg-white/15 active:scale-95"
        >
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <input
          type="range"
          min={0}
          max={Number.isFinite(duration) && duration > 0 ? duration : Math.max(progress, 0.1)}
          step={0.1}
          value={progress}
          aria-label="Позиция видео"
          onChange={(event) => {
            const node = video.current;
            if (!node) return;
            node.currentTime = Number(event.target.value);
            setProgress(node.currentTime);
          }}
          className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/25 accent-white [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          style={
            reduceMotion
              ? undefined
              : {
                  background: `linear-gradient(to right, #fff ${
                    duration ? (progress / duration) * 100 : 0
                  }%, rgba(255,255,255,.25) 0%)`
                }
          }
        />
        <span className="flex-none text-[12px] font-medium tabular-nums text-white/85">
          {/*
            A clip recorded in the browser often arrives without a duration, and "0:00 / 0:00"
            under a playing video is a lie. Where the total is unknown, the elapsed time is the
            whole truth available.
          */}
          {Number.isFinite(duration) && duration > 0
            ? `${clock(progress)} / ${clock(duration)}`
            : clock(progress)}
        </span>
        <button
          type="button"
          onClick={() => {
            const node = video.current;
            if (!node) return;
            node.muted = !node.muted;
            setMuted(node.muted);
          }}
          aria-label={muted ? "Включить звук" : "Выключить звук"}
          className="grid size-8 flex-none place-items-center rounded-full text-white transition hover:bg-white/15 active:scale-95"
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <button
          type="button"
          onClick={() => void video.current?.requestFullscreen?.()}
          aria-label="На весь экран"
          className="grid size-8 flex-none place-items-center rounded-full text-white transition hover:bg-white/15 active:scale-95"
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
}
