"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * One full-screen viewer for every picture and clip in the product.
 *
 * There used to be two half-answers: a post's gallery had a viewer that could not show video and
 * could not zoom, and a chat bubble had no viewer at all — a picture opened as a raw file in a new
 * tab, which on a phone means leaving the app to look at what somebody just sent you. This is the
 * single component both now use.
 *
 * What it does that the old one did not:
 *  - plays video in place, full-screen, with the browser's own transport;
 *  - zooms: pinch, wheel, double-tap, and explicit buttons for a mouse;
 *  - pans a zoomed picture by dragging, and swipes between items when it is not zoomed;
 *  - downloads the original, which is what the "open in a new tab" gesture was really used for.
 */

export type ViewerItem = {
  url: string;
  kind?: "image" | "video";
  /** Shown under the counter: a caption, a file name, or who sent it. */
  caption?: string | null;
};

const MAX_SCALE = 4;
const MIN_SCALE = 1;

/** Distance between two touches, for pinch. */
function spread(touches: React.TouchList) {
  const [a, b] = [touches[0], touches[1]];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function MediaViewer({
  items,
  index,
  onClose,
  onIndex
}: {
  items: ViewerItem[];
  /** `null` closes the viewer; a number opens it on that item. */
  index: number | null;
  onClose: () => void;
  onIndex: (next: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const open = index !== null && items.length > 0;
  const current = index !== null ? items[index] : undefined;
  const isVideo = current?.kind === "video";

  /**
   * Zoom and pan of the picture on screen.
   *
   * The item it belongs to is carried inside the state, so moving to the next picture derives the
   * zoom back to 1 rather than needing an effect to reset it — the same trick the chat screen uses
   * for its per-conversation state. `smooth` is state too: reading a ref during render to decide
   * whether to animate is exactly the stale-value trap React warns about.
   */
  const [zoomState, setZoomState] = useState({
    forIndex: index,
    scale: 1,
    x: 0,
    y: 0,
    smooth: true
  });
  const zoom =
    zoomState.forIndex === index ? zoomState : { scale: 1, x: 0, y: 0, smooth: true };
  const setZoom = useCallback(
    (
      next:
        | { scale: number; x: number; y: number; smooth?: boolean }
        | ((current: { scale: number; x: number; y: number }) => {
            scale: number;
            x: number;
            y: number;
            smooth?: boolean;
          })
    ) => {
      setZoomState((current) => {
        const base =
          current.forIndex === index ? current : { scale: 1, x: 0, y: 0, smooth: true };
        const value = typeof next === "function" ? next(base) : next;
        return { forIndex: index, smooth: value.smooth ?? true, ...value };
      });
    },
    [index]
  );

  const gesture = useRef<{
    mode: "none" | "pan" | "pinch" | "swipe";
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    startSpread: number;
    startScale: number;
  }>({ mode: "none", startX: 0, startY: 0, originX: 0, originY: 0, startSpread: 0, startScale: 1 });
  const lastTap = useRef(0);

  const step = useCallback(
    (delta: number) => {
      if (index === null || items.length < 2) return;
      onIndex((index + delta + items.length) % items.length);
    },
    [index, items.length, onIndex]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "+" || event.key === "=") {
        setZoom((z) => ({ ...z, scale: Math.min(MAX_SCALE, z.scale + 0.5) }));
      }
      if (event.key === "-") {
        setZoom((z) => {
          const scale = Math.max(MIN_SCALE, z.scale - 0.5);
          return scale === 1 ? { scale, x: 0, y: 0 } : { ...z, scale };
        });
      }
    };
    window.addEventListener("keydown", onKey);
    // A viewer that lets the page scroll behind it feels broken on touch.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose, step, setZoom]);

  /** Wheel and trackpad pinch both arrive here; a plain wheel zooms too, as in every viewer. */
  const onWheel = (event: React.WheelEvent) => {
    if (isVideo) return;
    event.preventDefault();
    setZoom((z) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, z.scale - event.deltaY / 500));
      return scale === 1 ? { scale, x: 0, y: 0 } : { ...z, scale };
    });
  };

  const onTouchStart = (event: React.TouchEvent) => {
    if (isVideo) return;
    if (event.touches.length === 2) {
      gesture.current = {
        mode: "pinch",
        startX: 0,
        startY: 0,
        originX: zoom.x,
        originY: zoom.y,
        startSpread: spread(event.touches),
        startScale: zoom.scale
      };
      return;
    }
    const touch = event.touches[0];
    gesture.current = {
      // Zoomed in, a drag pans; at rest it swipes to the next picture.
      mode: zoom.scale > 1 ? "pan" : "swipe",
      startX: touch.clientX,
      startY: touch.clientY,
      originX: zoom.x,
      originY: zoom.y,
      startSpread: 0,
      startScale: zoom.scale
    };
  };

  const onTouchMove = (event: React.TouchEvent) => {
    if (isVideo) return;
    const state = gesture.current;
    if (state.mode === "pinch" && event.touches.length === 2) {
      const ratio = spread(event.touches) / (state.startSpread || 1);
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.startScale * ratio));
      // `smooth: false` while a finger is down: a transition on every move event lags the touch.
      setZoom((z) =>
        scale === 1 ? { scale, x: 0, y: 0, smooth: false } : { ...z, scale, smooth: false }
      );
      return;
    }
    if (state.mode === "pan" && event.touches.length === 1) {
      const touch = event.touches[0];
      setZoom((z) => ({
        ...z,
        x: state.originX + (touch.clientX - state.startX),
        y: state.originY + (touch.clientY - state.startY),
        smooth: false
      }));
    }
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    if (isVideo) return;
    const state = gesture.current;
    gesture.current = { ...state, mode: "none" };
    if (state.mode !== "swipe") return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    // A decisive horizontal flick moves along; a downward one closes, as on a phone gallery.
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      step(dx < 0 ? 1 : -1);
      return;
    }
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) onClose();
  };

  /** Double-tap (and double-click) toggles between fit and 2×, the universal gesture. */
  const onDoubleActivate = () => {
    if (isVideo) return;
    setZoom((z) => (z.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2, x: 0, y: 0 }));
  };

  const onTouchTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) onDoubleActivate();
    lastTap.current = now;
  };

  /**
   * Rendered into `document.body`, not where it is written.
   *
   * A `position: fixed` element is positioned against the nearest *transformed* ancestor, not the
   * viewport — and every bubble is a `motion.div` with a transform on it. Left in place, the viewer
   * was laid out inside a bubble inside the conversation's `overflow-hidden` column, so its top bar
   * was clipped away entirely: the reported "the top menu isn't visible". A portal has no such ancestor.
   *
   * The `document` check is for the server render, where there is no body to portal into. It cannot
   * cause a hydration mismatch: a closed viewer draws nothing on either side.
   */
  const overlay = (
    <AnimatePresence>
      {open && current ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={isVideo ? "Video viewer" : "Image viewer"}
          initial={reduceMotion ? undefined : { opacity: 0 }}
          animate={reduceMotion ? undefined : { opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="media-viewer"
          onClick={onClose}
        >
          <div
            className="flex flex-none items-center gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] text-white"
            onClick={(event) => event.stopPropagation()}
          >
            {items.length > 1 ? (
              <span className="rounded-full bg-white/10 px-3 py-1 text-[13px] font-semibold tabular-nums">
                {(index ?? 0) + 1} / {items.length}
              </span>
            ) : null}
            {current.caption ? (
              <span className="min-w-0 flex-1 truncate text-[13px] text-white/75">
                {current.caption}
              </span>
            ) : (
              <span className="flex-1" />
            )}
            {/* Zoom buttons exist for a mouse, where there is no pinch to make. */}
            {!isVideo ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setZoom((z) => {
                      const scale = Math.max(MIN_SCALE, z.scale - 0.5);
                      return scale === 1 ? { scale, x: 0, y: 0 } : { ...z, scale };
                    })
                  }
                  disabled={zoom.scale <= MIN_SCALE}
                  aria-label="Zoom out"
                  className="media-viewer-action hidden disabled:opacity-40 sm:grid"
                >
                  <ZoomOut size={18} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setZoom((z) => ({ ...z, scale: Math.min(MAX_SCALE, z.scale + 0.5) }))
                  }
                  disabled={zoom.scale >= MAX_SCALE}
                  aria-label="Zoom in"
                  className="media-viewer-action hidden disabled:opacity-40 sm:grid"
                >
                  <ZoomIn size={18} />
                </button>
              </>
            ) : null}
            <a
              href={current.url}
              download
              aria-label="Download"
              className="media-viewer-action"
              onClick={(event) => event.stopPropagation()}
            >
              <Download size={18} />
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close viewer"
              className="media-viewer-action"
            >
              <X size={20} />
            </button>
          </div>

          <div
            className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden p-1 sm:p-2"
            onClick={(event) => event.stopPropagation()}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={(event) => {
              onTouchEnd(event);
              onTouchTap();
            }}
          >
            {items.length > 1 ? (
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous"
                className="media-viewer-arrow left-2 hidden sm:grid"
              >
                <ChevronLeft size={22} />
              </button>
            ) : null}

            {isVideo ? (
              /* The browser's own controls: a re-implemented transport is the part that always
                 goes wrong, and full-screen, AirPlay and captions come free with the native one.
                 A user's upload carries no caption track, so none is declared. */
              <video
                key={current.url}
                src={current.url}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element -- served from the API's own /media */
              <img
                src={current.url}
                alt={current.caption ?? ""}
                draggable={false}
                onDoubleClick={onDoubleActivate}
                className="max-h-full max-w-full select-none object-contain"
                style={{
                  transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`,
                  transition: zoom.smooth ? "transform .18s var(--ease-out)" : "none",
                  cursor: zoom.scale > 1 ? "grab" : "zoom-in"
                }}
              />
            )}

            {items.length > 1 ? (
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next"
                className="media-viewer-arrow right-2 hidden sm:grid"
              >
                <ChevronRight size={22} />
              </button>
            ) : null}
          </div>

          {items.length > 1 ? (
            <div
              className="flex flex-none justify-center gap-1.5 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2"
              onClick={(event) => event.stopPropagation()}
            >
              {items.map((item, dot) => (
                <button
                  key={`${item.url}-${dot}`}
                  type="button"
                  onClick={() => onIndex(dot)}
                  aria-label={`Item ${dot + 1}`}
                  aria-current={dot === index}
                  /* 24px of touch target around a 8px dot: the old 8px button was unhittable. */
                  className="grid size-6 place-items-center"
                >
                  <span
                    className="size-2 rounded-full transition"
                    style={{ background: dot === index ? "#ffffff" : "rgba(255,255,255,.35)" }}
                  />
                </button>
              ))}
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
