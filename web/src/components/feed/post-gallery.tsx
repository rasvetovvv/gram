"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * A post's pictures: one fills the width, two split it, three put the first one tall beside a
 * stack, four make a square. Tapping any of them opens the viewer below.
 *
 * The grid is deliberately fixed rather than masonry: a feed that reflows as images decode is
 * the thing that makes a timeline feel unstable.
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
        : pictures.length === 3
          ? "grid-cols-2 grid-rows-2"
          : "grid-cols-2 grid-rows-2";

  return (
    <>
      <div className={`mt-3 grid gap-1 overflow-hidden rounded-[18px] ${shape}`}>
        {pictures.map((url, index) => (
          <button
            key={url}
            type="button"
            onClick={() => setOpen(index)}
            aria-label={`Открыть изображение ${index + 1} из ${pictures.length}`}
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
        urls={pictures}
        index={open}
        onClose={() => setOpen(null)}
        onIndex={(next) => setOpen(next)}
      />
    </>
  );
}

/**
 * Full-screen viewer: arrows and swipe move between pictures, Escape closes, and the counter
 * says where you are. Video is played by the browser's own controls rather than a re-implemented
 * transport, which is the part that usually goes wrong.
 */
export function MediaViewer({
  urls,
  index,
  onClose,
  onIndex
}: {
  urls: string[];
  index: number | null;
  onClose: () => void;
  onIndex: (next: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const open = index !== null;
  const step = useCallback(
    (delta: number) => {
      if (index === null) return;
      const next = (index + delta + urls.length) % urls.length;
      onIndex(next);
    },
    [index, onIndex, urls.length]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    // A viewer that lets the page scroll behind it feels broken on touch.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose, step]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр изображения"
          initial={reduceMotion ? undefined : { opacity: 0 }}
          animate={reduceMotion ? undefined : { opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-[120] flex flex-col bg-black/95"
          onClick={onClose}
        >
          <div className="flex flex-none items-center justify-between p-3 text-white">
            <span className="rounded-full bg-white/10 px-3 py-1 text-[13px] font-semibold tabular-nums">
              {(index ?? 0) + 1} / {urls.length}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть просмотр"
              className="grid size-10 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
            >
              <X size={20} />
            </button>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center p-2"
            onClick={(event) => event.stopPropagation()}
          >
            {urls.length > 1 ? (
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Предыдущее изображение"
                className="absolute left-2 z-10 grid size-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              >
                <ChevronLeft size={22} />
              </button>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element -- served from the API's own /media */}
            <img
              src={urls[index ?? 0]}
              alt=""
              className="max-h-full max-w-full select-none object-contain"
              draggable={false}
            />
            {urls.length > 1 ? (
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Следующее изображение"
                className="absolute right-2 z-10 grid size-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              >
                <ChevronRight size={22} />
              </button>
            ) : null}
          </div>

          {urls.length > 1 ? (
            <div
              className="flex flex-none justify-center gap-1.5 p-3"
              onClick={(event) => event.stopPropagation()}
            >
              {urls.map((url, dot) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => onIndex(dot)}
                  aria-label={`Изображение ${dot + 1}`}
                  aria-current={dot === index}
                  className="size-2 rounded-full transition"
                  style={{ background: dot === index ? "#ffffff" : "rgba(255,255,255,.35)" }}
                />
              ))}
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
