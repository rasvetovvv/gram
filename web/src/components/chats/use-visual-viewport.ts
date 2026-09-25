"use client";

import { useEffect, useRef } from "react";

/**
 * Pin a pane to the *visual* viewport, so a phone keyboard cannot break the conversation layout.
 *
 * Two separate iOS Safari behaviours have to be handled, and covering only the first is what left
 * the composer stranded at the top of a black screen:
 *
 * 1. **The keyboard does not shrink the viewport.** It overlays it. `100dvh` therefore stays at the
 *    full screen height, and the thread plus the composer are laid out partly underneath the
 *    keyboard. `visualViewport.height` is the space actually left over, published here as
 *    `--chat-vh`.
 *
 * 2. **Safari scrolls the layout viewport to reveal the focused field.** Even with `html` and `body`
 *    pinned and `overflow: hidden`, focusing an input near the bottom shifts the layout viewport up
 *    by as much as the keyboard is tall. A pane anchored at document top then sits mostly above the
 *    visible region: its bottom edge — the composer — lands at the top of the screen, and the void
 *    below it is the page background. `visualViewport.offsetTop` is that shift, published as
 *    `--chat-offset`, and the pane translates by it to stay in the visible window.
 *
 * Both are written together in one frame: `resize` and `scroll` fire continuously while the keyboard
 * animates, and updating height without offset (or the other way round) is a visible jump.
 *
 * Chrome on Android needs neither — `interactiveWidget: "resizes-content"` in `app/layout.tsx`
 * already resizes the content — and the values it reports there are simply height and zero.
 */
export function useVisualViewportHeight(onResize?: () => void) {
  /* Kept in a ref, written in an effect rather than during render, so a caller may pass an inline
     closure without re-subscribing the listener on every render. */
  const handler = useRef(onResize);
  useEffect(() => {
    handler.current = onResize;
  }, [onResize]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    if (!viewport) {
      // No API to measure: `100dvh` and a zero offset are the honest fallback.
      root.style.setProperty("--chat-offset", "0px");
      return () => root.style.removeProperty("--chat-offset");
    }

    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty("--chat-vh", `${Math.round(viewport.height)}px`);
        root.style.setProperty("--chat-offset", `${Math.round(viewport.offsetTop)}px`);
        /* And ask the document back to the top. The pane is already translated to cover the visible
           region, so this is belt and braces — but a layout viewport left scrolled is what makes the
           *next* focus land in the wrong place, and the call is free when there is nothing to
           scroll. */
        if (window.scrollY !== 0) window.scrollTo(0, 0);
        handler.current?.();
      });
    };

    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      // Leaving stale pixels behind would pin the next screen to the keyboard's size.
      root.style.removeProperty("--chat-vh");
      root.style.removeProperty("--chat-offset");
    };
  }, []);
}
