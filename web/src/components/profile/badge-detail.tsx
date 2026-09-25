"use client";

import * as Popover from "@radix-ui/react-popover";
import { motion, useReducedMotion } from "framer-motion";
import { Award, Calendar, ShieldCheck, Sparkles, Star, Trophy } from "lucide-react";
import Image from "next/image";
import type { ProfileBadge } from "@/lib/types";
import { Seal, SealText, sealTone, type SealTone } from "./seal";

const RARITY = {
  common: { label: "Common", ring: "#27272a", from: "#8b8f98", to: "#3f3f46", text: "#c8c9d4" },
  rare: { label: "Rare", ring: "#2f6c93", from: "#818cf8", to: "#3730a3", text: "#b0c2ff" },
  epic: { label: "Epic", ring: "#4a4bb0", from: "#60a5fa", to: "#1d4ed8", text: "#9fc6ff" },
  legendary: { label: "Legendary", ring: "#9a7420", from: "#fb7185", to: "#e11d48", text: "#ffb3c0" }
} as const;

/** A few badges keep a bespoke rim, the way the reference gilds its OG seal. */
const RIM_OVERRIDES: Record<string, Partial<SealTone>> = {
  official: { rimFrom: "#8fd0ff", rimTo: "#2f6ce0" },
  og: { rimFrom: "#f3c64b", rimTo: "#a855f7" },
  founder: { rimFrom: "#f7d774", rimTo: "#c2882b" },
  early: { rimFrom: "#f3c64b", rimTo: "#a855f7" }
};

/** Short text glyphs read better than an icon on these seals, as in the reference. */
const GLYPHS: Record<string, string> = {
  official: "G",
  og: "OG",
  founder: "1",
  legend: "L",
  early: "E"
};

const EMBLEMS = [Trophy, Award, Sparkles, Star, ShieldCheck] as const;

export function rarityLabel(rarity: ProfileBadge["rarity"]) {
  return (RARITY[rarity] ?? RARITY.common).label;
}

/** Emblem strip in the profile identity block. Each badge opens its own compact popover. */
export function BadgeStrip({ badges, className = "" }: { badges: ProfileBadge[]; className?: string }) {
  const visible = badges.filter((badge) => badge.visible_in_profile !== false);
  if (!visible.length) return null;
  return (
    <ul className={`m-0 flex list-none flex-wrap items-center gap-1.5 p-0 ${className}`} aria-label="Profile badges">
      {visible.map((badge, index) => (
        <li key={badge.id} className="flex">
          <BadgeDetailPopover badge={badge} index={index} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Anchored popover next to the emblem — deliberately not a full-screen sheet, so the
 * profile stays visible while a badge is inspected. Radix keeps focus, escape and
 * outside-click behaviour, plus collision flipping on narrow screens.
 */
export function BadgeDetailPopover({ badge, index = 0 }: { badge: ProfileBadge; index?: number }) {
  const reduceMotion = useReducedMotion();
  const tone = RARITY[badge.rarity] ?? RARITY.common;
  const Emblem = EMBLEMS[index % EMBLEMS.length];
  const seal = sealTone(tone.from, tone.to, RIM_OVERRIDES[badge.slug]);
  const glyph = GLYPHS[badge.slug];
  const emblem = (size: number) => (
    <Seal id={`${badge.slug}-${size}`} tone={seal} size={size} label={badge.title}>
      {badge.image_url ? (
        <Image
          src={badge.image_url}
          alt=""
          width={Math.round(size * 0.6)}
          height={Math.round(size * 0.6)}
          className="rounded-full object-cover"
          style={{ width: size * 0.6, height: size * 0.6 }}
        />
      ) : glyph ? (
        <SealText text={glyph} size={size} />
      ) : (
        <Emblem size={Math.round(size * 0.46)} color="#ffffff" />
      )}
    </Seal>
  );

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={badge.title}
          aria-label={badge.title}
          className="border-0 bg-transparent p-0 transition-transform duration-150 hover:scale-105 active:scale-90"
        >
          {emblem(26)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          className="z-[90] w-[min(20rem,calc(100vw-24px))] rounded-[20px] bg-[#121216] p-4 outline-none"
          style={{ boxShadow: `0 20px 54px rgba(0,0,0,.62), inset 0 0 0 1px ${tone.ring}` }}
        >
          <motion.div
            initial={reduceMotion ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <div className="flex items-start gap-2.5">
              <span className="flex-none">{emblem(36)}</span>
              <div className="min-w-0 flex-1">
                <strong className="block text-xl font-extrabold leading-tight">{badge.title}</strong>
                <span className="mt-1 block text-[13px] font-bold" style={{ color: tone.text }}>
                  {tone.label} · {badge.points} pts
                </span>
              </div>
            </div>
            <p className="mb-0 mt-3 text-[15px] leading-6 text-[var(--muted)]">{badge.description}</p>
            <p className="mb-0 mt-2 text-[13px] leading-5 text-[var(--dim)]">
              <span className="font-bold text-[var(--muted)]">Earned for: </span>
              {badge.qualification}
            </p>
            {badge.issuer || badge.issued_at ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] text-[var(--faint)]">
                {badge.issuer ? (
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck size={13} className="text-[var(--link)]" />
                    {badge.issuer}
                  </span>
                ) : null}
                {badge.issued_at ? (
                  <span className="flex items-center gap-1.5">
                    <Calendar size={13} />
                    {new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(badge.issued_at))}
                  </span>
                ) : null}
              </div>
            ) : null}
          </motion.div>
          <Popover.Arrow width={14} height={7} style={{ fill: "#16161b" }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
