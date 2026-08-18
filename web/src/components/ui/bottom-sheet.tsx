"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useReducedMotion } from "framer-motion";
import { useCallback, useRef, useState } from "react";

/**
 * Bottom sheet matching the reference's own modal: a 70% black overlay, a panel pinned to
 * the bottom edge with a 24px top radius, and a drag handle that follows the pointer and
 * dismisses past a threshold. On wide screens the panel centres and caps at 42rem while
 * staying bottom-anchored, exactly as the reference does.
 */
const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 0.6;

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  headerRight,
  children,
  footer,
  className = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Controls pinned to the drag-handle row, the way the reference stacks its sheet chrome. */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startY: number; startedAt: number } | null>(null);

  const close = useCallback(() => {
    drag.current = null;
    setOffset(0);
    setDragging(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const endDrag = useCallback(
    (clientY: number) => {
      const current = drag.current;
      drag.current = null;
      setDragging(false);
      if (!current) return;
      const distance = clientY - current.startY;
      const elapsed = Math.max(1, performance.now() - current.startedAt);
      if (distance > CLOSE_DISTANCE || distance / elapsed > CLOSE_VELOCITY)
        close();
      else setOffset(0);
    },
    [close],
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/70 data-[state=open]:animate-[sheetFade_.22s_ease-out]" />
        <Dialog.Content
          className={`fixed inset-x-0 bottom-0 z-[91] flex max-h-[90dvh] flex-col overflow-hidden rounded-t-3xl border border-[var(--sheet-line)] bg-[var(--sheet)] text-[var(--ink)] shadow-2xl outline-none data-[state=open]:animate-[sheetUp_.28s_var(--ease-out)] sm:mx-auto sm:max-w-2xl ${className}`}
          style={{
            transform: offset ? `translateY(${offset}px)` : undefined,
            transition:
              dragging || reduceMotion
                ? "none"
                : "transform var(--dur-base) var(--ease-out)",
          }}
        >
          <div className={`relative flex-none ${headerRight ? "min-h-11" : ""}`}>
            <button
              type="button"
              aria-label="Потяните, чтобы закрыть"
              /*
               * A pointer affordance only: keeping it out of the tab order stops Radix
               * autofocusing it, which painted a full-width focus ring across the sheet.
               * Keyboard users close with Escape or the sheet's own close control.
               */
              tabIndex={-1}
              className="flex w-full cursor-grab touch-none justify-center border-0 bg-transparent pb-2 pt-2 outline-none active:cursor-grabbing"
              onClick={close}
              onPointerDown={(event) => {
                drag.current = {
                  startY: event.clientY,
                  startedAt: performance.now(),
                };
                setDragging(true);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!drag.current) return;
                setOffset(Math.max(0, event.clientY - drag.current.startY));
              }}
              onPointerUp={(event) => endDrag(event.clientY)}
              onPointerCancel={(event) => endDrag(event.clientY)}
            >
              <span
                aria-hidden
                className="h-1.5 w-12 rounded-full bg-[#3f3f46]"
              />
            </button>
            {headerRight ? (
              <div className="absolute right-3 top-1.5 flex items-center gap-2">
                {headerRight}
              </div>
            ) : null}
          </div>
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="sr-only">
              {description}
            </Dialog.Description>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
          {footer ? (
            <div className="flex-none border-t border-[var(--sheet-line)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
