"use client";

import * as Popover from "@radix-ui/react-popover";
import { Wrench } from "lucide-react";

/**
 * The staff mark: a scalloped badge like the verification one, in the platform's violet and
 * carrying a V instead of a tick.
 *
 * It is granted, never claimed — nothing in the product can raise the flag behind it — so the
 * popover says who wears it rather than inviting anyone to want one.
 */
const SCALLOP =
  "M12.3 2.9c.1.1.2.1.3.2.7.6 1.3 1.1 2 1.7.3.2.6.4.9.4.9.1 1.7.2 2.6.2.5 0 .6.1.7.7.1.9.1 1.8.2 2.6 0 .4.2.7.4 1 .6.7 1.1 1.3 1.7 2 .3.4.3.5 0 .8-.5.6-1.1 1.3-1.6 1.9-.3.3-.5.7-.5 1.2-.1.8-.2 1.7-.2 2.5 0 .4-.2.5-.6.6-.8 0-1.6.1-2.5.2-.5 0-1 .2-1.4.5-.6.5-1.3 1.1-1.9 1.6-.3.3-.5.3-.8 0-.7-.6-1.4-1.2-2-1.8-.3-.2-.6-.4-.9-.4-.9-.1-1.8-.2-2.7-.2-.4 0-.5-.2-.6-.5 0-.9-.1-1.7-.2-2.6 0-.4-.2-.8-.4-1.1-.6-.6-1.1-1.3-1.6-2-.4-.4-.3-.5 0-1 .6-.6 1.1-1.3 1.7-1.9.3-.3.4-.6.4-1 0-.8.1-1.6.2-2.5 0-.5.1-.6.6-.6.9-.1 1.7-.1 2.6-.2.4 0 .7-.2 1-.4.7-.6 1.4-1.2 2.1-1.7.1-.2.3-.3.5-.2z";

function Mark({ label, size }: { label: string; size: number }) {
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
      <path d={SCALLOP} fill="var(--admin-mark, #8b5cf6)" />
      {/* The letter itself, drawn rather than set in type so it scales with the badge. */}
      <path d="M8.4 8.6h1.9l2 5.3 2-5.3h1.9l-3 7.4h-1.7z" fill="#ffffff" />
    </svg>
  );
}

export function AdminMark({ size = 16 }: { size?: number }) {
  return <Mark label="GRAM Administrator" size={size} />;
}

/** Where the mark is not already inside a link, it explains itself on tap. */
export function AdminMarkExplained({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 border-0 bg-transparent p-0 align-middle transition-transform duration-150 hover:scale-110 active:scale-95"
          aria-label="GRAM Administrator — details"
        >
          <Mark label="GRAM Administrator" size={size} />
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
            <span className="grid size-9 flex-none place-items-center rounded-full bg-[rgba(139,92,246,.16)] text-[var(--admin-mark,#8b5cf6)]">
              <Wrench size={17} />
            </span>
            <div className="min-w-0">
              <strong className="block text-[15px] font-bold leading-tight">
                GRAM Administrator
              </strong>
              <p className="mb-0 mt-1.5 text-[13px] leading-5 text-[var(--muted)]">
                {name} is a member of the platform&apos;s staff. This badge can&apos;t be bought or requested:
                only GRAM grants it.
              </p>
            </div>
          </div>
          <Popover.Arrow width={14} height={7} style={{ fill: "#121216" }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
