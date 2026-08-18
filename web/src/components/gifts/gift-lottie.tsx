"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Plays one Telegram gift sticker.
 *
 * A `.tgs` is a restricted Lottie — shape layers only, no expressions and no bundled images —
 * so the `lottie_light` build is enough and saves ~135 KB over the full player. It is imported
 * lazily on first use, because most screens show still artwork and never need it at all.
 *
 * Two guards keep a wall of gifts affordable: nothing animates until it is on screen, and
 * `prefers-reduced-motion` stops at the first frame instead of looping.
 */
type LottiePlayer = {
  loadAnimation: (options: Record<string, unknown>) => LottieAnimation;
};
type LottieAnimation = {
  destroy: () => void;
  goToAndStop: (value: number, isFrame?: boolean) => void;
  addEventListener: (event: string, handler: () => void) => void;
};

let playerPromise: Promise<LottiePlayer> | null = null;

function loadPlayer() {
  playerPromise ??= import("lottie-web/build/player/lottie_light").then(
    (module) => (module.default ?? module) as unknown as LottiePlayer
  );
  return playerPromise;
}

export function GiftLottie({
  src,
  size,
  className = "",
  loop = true,
  fill = false,
  onReady
}: {
  src: string;
  size: number;
  className?: string;
  loop?: boolean;
  /** Take the parent's box instead of a fixed square, so breakpoints can resize the art. */
  fill?: boolean;
  onReady?: () => void;
}) {
  const host = useRef<HTMLSpanElement | null>(null);
  const reduceMotion = useReducedMotion();
  // Starts visible, then the observer only takes motion *away* when the element scrolls out.
  // Gating the first load on the observer meant a player mounted inside a sheet that animates
  // in could be reported offscreen once and never asked again, leaving an empty box.
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const node = host.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => setVisible(entry.isIntersecting)),
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    const node = host.current;
    if (!node) return undefined;
    let animation: LottieAnimation | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(src, { credentials: "omit" });
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        const player = await loadPlayer();
        if (cancelled || !host.current) return;
        animation = player.loadAnimation({
          container: host.current,
          renderer: "svg",
          loop: loop && !reduceMotion,
          autoplay: !reduceMotion,
          animationData: data,
          rendererSettings: { progressiveLoad: true, preserveAspectRatio: "xMidYMid meet" }
        });
        if (reduceMotion) animation.goToAndStop(0, true);
        onReady?.();
      } catch {
        // A sticker that will not load leaves the coloured backdrop behind it visible, which
        // is a better failure than an empty box or a thrown render.
      }
    })();

    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, [src, visible, loop, reduceMotion, onReady]);

  return (
    <span
      ref={host}
      aria-hidden
      className={className}
      style={fill ? { width: "100%", height: "100%", display: "block" } : { width: size, height: size, display: "block" }}
    />
  );
}
