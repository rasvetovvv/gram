"use client";

import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { profileTheme } from "@/lib/profile-color";

/**
 * Premium mark: the reference's own star-with-swoosh glyph. Its fill follows the profile's
 * colour scheme, so a themed account carries one accent across name, badge and rings; an
 * unthemed account keeps the platform's premium violet.
 */
const STAR =
  "m11.466 17.753-4.5 2.758a.994.994 0 0 1-1.483-1.093l.697-2.742a3.448 3.448 0 0 1 1.85-2.26l4.91-2.357a.46.46 0 0 0-.278-.867l-5.465.946a3.831 3.831 0 0 1-3.115-.839L2.355 9.852A.994.994 0 0 1 2.916 8.1l5.276-.413a.994.994 0 0 0 .84-.61l2.035-4.913a.994.994 0 0 1 1.837 0l2.035 4.912a.994.994 0 0 0 .84.61l5.305.416a.994.994 0 0 1 .567 1.747l-4.046 3.449a.994.994 0 0 0-.321.989l1.244 5.166a.994.994 0 0 1-1.486 1.08l-4.537-2.78a.994.994 0 0 0-1.039 0Z";

export function PremiumMark({
  size = 16,
  profileColor,
  label = "GRAM Premium",
  className = ""
}: {
  size?: number;
  profileColor?: string | null;
  label?: string;
  className?: string;
}) {
  const theme = profileTheme(profileColor);
  const fill = theme.slug === "default" ? "var(--premium)" : theme.accent;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={`inline-block shrink-0 align-middle ${className}`}
    >
      <title>{label}</title>
      <path d={STAR} fill={fill} fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}

/**
 * Tappable variant, the counterpart of `VerifiedMarkExplained`: it says what the star means
 * instead of leaving the visitor to guess, and leads to the offer for anyone who wants it.
 *
 * Only for places where the mark is not already inside a link or a button — nesting one
 * button in another is invalid markup and the outer control eats the tap.
 */
export function PremiumMarkExplained({
  name,
  size = 16,
  profileColor,
  label = "GRAM Premium"
}: {
  name: string;
  size?: number;
  profileColor?: string | null;
  label?: string;
}) {
  const theme = profileTheme(profileColor);
  const fill = theme.slug === "default" ? "var(--premium)" : theme.accent;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 border-0 bg-transparent p-0 align-middle transition-transform duration-150 hover:scale-110 active:scale-95"
          aria-label={`${label} — подробнее`}
        >
          <PremiumMark size={size} profileColor={profileColor} label={label} />
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
            <span
              className="grid size-9 flex-none place-items-center rounded-full"
              style={{ background: "rgba(160,110,255,.16)", color: fill }}
            >
              <PremiumMark size={18} profileColor={profileColor} label="" />
            </span>
            <div className="min-w-0">
              <strong className="block text-[15px] font-bold leading-tight">{label}</strong>
              <p className="mb-0 mt-1.5 text-[13px] leading-5 text-[var(--muted)]">
                У {name} активна подписка GRAM Premium.
              </p>
              <Link
                href="/premium"
                className="mt-2 inline-block text-[13px] font-semibold text-[var(--link)]"
              >
                Что это даёт
              </Link>
            </div>
          </div>
          <Popover.Arrow width={14} height={7} style={{ fill: "#121216" }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
