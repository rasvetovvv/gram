"use client";

import * as Popover from "@radix-ui/react-popover";
import { ShieldCheck } from "lucide-react";

/**
 * The reference draws its verification mark as a scalloped Telegram-style badge rather
 * than a circle with a tick, and keeps it Telegram-blue independent of the brand hue.
 * Both paths are the reference's own geometry.
 */
const SCALLOP =
  "M12.3 2.9c.1.1.2.1.3.2.7.6 1.3 1.1 2 1.7.3.2.6.4.9.4.9.1 1.7.2 2.6.2.5 0 .6.1.7.7.1.9.1 1.8.2 2.6 0 .4.2.7.4 1 .6.7 1.1 1.3 1.7 2 .3.4.3.5 0 .8-.5.6-1.1 1.3-1.6 1.9-.3.3-.5.7-.5 1.2-.1.8-.2 1.7-.2 2.5 0 .4-.2.5-.6.6-.8 0-1.6.1-2.5.2-.5 0-1 .2-1.4.5-.6.5-1.3 1.1-1.9 1.6-.3.3-.5.3-.8 0-.7-.6-1.4-1.2-2-1.8-.3-.2-.6-.4-.9-.4-.9-.1-1.8-.2-2.7-.2-.4 0-.5-.2-.6-.5 0-.9-.1-1.7-.2-2.6 0-.4-.2-.8-.4-1.1-.6-.6-1.1-1.3-1.6-2-.4-.4-.3-.5 0-1 .6-.6 1.1-1.3 1.7-1.9.3-.3.4-.6.4-1 0-.8.1-1.6.2-2.5 0-.5.1-.6.6-.6.9-.1 1.7-.1 2.6-.2.4 0 .7-.2 1-.4.7-.6 1.4-1.2 2.1-1.7.1-.2.3-.3.5-.2z";
const CHECK =
  "M16.4 10.1l-.2.2-5.4 5.4c-.1.1-.2.2-.4 0l-2.6-2.6c-.2-.2-.1-.3 0-.4.2-.2.5-.6.7-.6.3 0 .5.4.7.6l1.1 1.1c.2.2.3.2.5 0l4.3-4.3c.2-.2.4-.3.6 0 .1.2.3.3.4.5.2 0 .3.1.3.1z";

function Mark({ label, size, fill }: { label: string; size: number; fill: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className="inline-block shrink-0 align-middle"
    >
      <title>{label}</title>
      <path d={SCALLOP} fill={fill} />
      <path d={CHECK} fill="#ffffff" />
    </svg>
  );
}

export function VerifiedMark({
  label = "Подтверждённый профиль",
  size = 18,
  fill = "var(--verified)"
}: {
  label?: string;
  size?: number;
  fill?: string;
}) {
  return <Mark label={label} size={size} fill={fill} />;
}

/**
 * Tappable variant used where the mark is not already inside a link or button: it explains
 * what the tick means instead of leaving the visitor to guess.
 */
export function VerifiedMarkExplained({
  name,
  label = "Подтверждённый профиль",
  size = 18,
  fill = "var(--verified)"
}: {
  name: string;
  label?: string;
  size?: number;
  fill?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 border-0 bg-transparent p-0 align-middle transition-transform duration-150 hover:scale-110 active:scale-95"
          aria-label={`${label} — подробнее`}
        >
          <Mark label={label} size={size} fill={fill} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[95] w-[min(19rem,calc(100vw-24px))] rounded-[18px] bg-[#121216] p-3.5 outline-none shadow-[0_20px_54px_rgba(0,0,0,.62),inset_0_0_0_1px_var(--line-structural)]"
        >
          <div className="flex items-start gap-2.5">
            <span className="grid size-9 flex-none place-items-center rounded-full bg-[rgba(51,144,236,.14)] text-[var(--verified)]">
              <ShieldCheck size={18} />
            </span>
            <div className="min-w-0">
              <strong className="block text-[15px] font-bold leading-tight">{label}</strong>
              <p className="mb-0 mt-1.5 text-[13px] leading-5 text-[var(--muted)]">
                Представители GRAM подтвердили, что {name} — официальный аккаунт.
              </p>
            </div>
          </div>
          <Popover.Arrow width={14} height={7} style={{ fill: "#121216" }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
