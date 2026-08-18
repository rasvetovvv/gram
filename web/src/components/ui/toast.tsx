"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Bell, Check, Gift, Heart, Info, MessageCircle, Phone, Sparkles, Star, UserPlus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Dynamic-Island style notice: one card at the top edge that carries confirmations, errors
 * and freshly arrived notifications. Actions need visible feedback, not only a
 * screen-reader announcement, and an error the user cannot see is an error they repeat.
 *
 * It is a card rather than a pill because a notice about a person has to say who, what, and
 * a snippet of the thing itself — a single line of text could not.
 */
export type ToastVariant = "success" | "error" | "info" | "event";

/** The kinds that get their own badge on the avatar, matching the notifications page. */
export type ToastKind = "message" | "follow" | "like" | "gift" | "stars" | "premium" | "call" | "system";

export type ToastOptions = {
  variant?: ToastVariant;
  /** Avatar for notice items about a person, the way the reference shows the actor. */
  avatarUrl?: string | null;
  /** Shown in place of a missing avatar, so person notices never fall back to an icon. */
  fallbackInitial?: string;
  /** Draws the small kind badge over the avatar's corner. */
  kind?: ToastKind;
  detail?: string;
  /** A quote of the thing itself — a message, a comment — shown under the detail. */
  quote?: string;
  /** Makes the card tappable — a notice about someone should lead to them. */
  href?: string;
  durationMs?: number;
};

type Toast = ToastOptions & { id: number; message: string };

type ToastContextValue = { notify: (message: string, options?: ToastOptions) => void };

const ToastContext = createContext<ToastContextValue>({ notify: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const TONE: Record<ToastVariant, { color: string; icon: React.ComponentType<{ size?: number }> }> = {
  success: { color: "var(--online)", icon: Check },
  error: { color: "var(--danger)", icon: AlertTriangle },
  info: { color: "var(--link)", icon: Info },
  event: { color: "var(--primary-strong)", icon: Bell }
};

const KIND: Record<ToastKind, { icon: React.ComponentType<{ size?: number }>; background: string }> = {
  message: { icon: MessageCircle, background: "var(--primary)" },
  follow: { icon: UserPlus, background: "var(--link)" },
  like: { icon: Heart, background: "#ec4899" },
  gift: { icon: Gift, background: "#f59e0b" },
  stars: { icon: Star, background: "var(--stars)" },
  premium: { icon: Sparkles, background: "var(--premium)" },
  call: { icon: Phone, background: "var(--online)" },
  system: { icon: Bell, background: "var(--primary)" }
};

/** A runaway string must not be able to stretch the card, so it is cut before layout sees it. */
function clamp(value: string | undefined, limit: number) {
  if (!value) return value;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const reduceMotion = useReducedMotion();
  const nextId = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const notify = useCallback((message: string, options: ToastOptions = {}) => {
    const id = (nextId.current += 1);
    const entry: Toast = {
      ...options,
      id,
      message: clamp(message, 64) ?? message,
      detail: clamp(options.detail, 120),
      quote: clamp(options.quote, 160)
    };
    // Two at a time keeps a burst readable; older notices drop off rather than stack up.
    setItems((current) => [...current.slice(-1), entry]);
    const timer = setTimeout(
      () => setItems((current) => current.filter((item) => item.id !== id)),
      options.durationMs ?? (options.variant === "error" ? 4600 : 3200)
    );
    timers.current.push(timer);
  }, []);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="sr-only" role="status" aria-live="polite">
        {items
          .map((item) =>
            [item.message, item.detail, item.quote].filter(Boolean).join(". ")
          )
          .join(". ")}
      </div>
      <div className="app-toast-stack">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const tone = TONE[item.variant ?? "success"];
            const Icon = tone.icon;
            const badge = item.kind ? KIND[item.kind] : null;
            const BadgeIcon = badge?.icon;
            const Card = (
              <motion.div
                key={item.id}
                layout
                className="app-toast"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.94 }}
                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.96 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="relative flex-none">
                  {item.avatarUrl ? (
                    <Image
                      src={item.avatarUrl}
                      alt=""
                      width={38}
                      height={38}
                      className="size-[38px] rounded-full object-cover"
                    />
                  ) : item.fallbackInitial ? (
                    <span className="grid size-[38px] place-items-center rounded-full bg-[var(--surface-2)] text-[15px] font-bold text-[var(--muted)]">
                      {item.fallbackInitial.toUpperCase()}
                    </span>
                  ) : (
                    <span
                      className="grid size-[38px] place-items-center rounded-full bg-[var(--surface-2)]"
                      style={{ color: tone.color }}
                    >
                      <Icon size={19} />
                    </span>
                  )}
                  {/* The badge names the event, so the card reads at a glance without the text. */}
                  {badge && BadgeIcon ? (
                    <span
                      aria-hidden
                      className="absolute -bottom-0.5 -right-1 grid size-[19px] place-items-center rounded-full border-2 border-[var(--sheet)] text-white"
                      style={{ background: badge.background }}
                    >
                      <BadgeIcon size={10} />
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold leading-5">
                    {item.message}
                  </span>
                  {item.detail ? (
                    <span className="mt-0.5 line-clamp-2 text-[13px] font-normal leading-[17px] text-[var(--muted)] [overflow-wrap:anywhere]">
                      {item.detail}
                    </span>
                  ) : null}
                  {item.quote ? (
                    <span className="mt-1 line-clamp-2 border-l-2 border-white/25 pl-2 text-[13px] font-normal leading-[17px] text-[var(--dim)] [overflow-wrap:anywhere]">
                      {item.quote}
                    </span>
                  ) : null}
                </span>
              </motion.div>
            );
            return item.href ? (
              <Link key={item.id} href={item.href} className="pointer-events-auto w-full max-w-full">
                {Card}
              </Link>
            ) : (
              Card
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
