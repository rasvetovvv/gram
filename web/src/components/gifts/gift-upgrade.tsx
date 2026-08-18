"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Sparkles, Star } from "lucide-react";
import { GiftImage } from "./gift-image";

/**
 * The upgrade ceremony.
 *
 * A gift is bought plain — the design's own artwork, nothing rolled. Paying the upgrade fee
 * rolls a model, a backdrop and a symbol, and *that* is the moment worth animating: the plain
 * sticker charges up, the backdrop blooms, and the collectible crossfades in over it.
 *
 * There is no wrapped box and no unwrap: opening a parcel was a state nobody paid for and it
 * told you nothing about the item. The roll is the event, so the roll is what plays.
 */
export type UpgradePhase = "idle" | "rolling" | "revealed";

type Upgradable = {
  id: string;
  slug: string;
  name: string;
  serial_number: number;
  rarity: "rare" | "epic" | "legendary" | "mythic";
  accent?: string;
  backdrop_edge?: string;
  pattern_color?: string;
  model?: string;
  model_name?: string;
  symbol?: string;
  pattern?: string;
  design_slug?: string | null;
  upgraded?: boolean;
  upgrade_price_stars?: number;
};

const ROLL_MS = 1150;

const BURST = [
  [50, 6],
  [86, 26],
  [92, 66],
  [50, 92],
  [10, 68],
  [8, 24]
] as const;

/** Rays thrown outwards at the moment the roll lands. */
function Burst({ size, active }: { size: number; active: boolean }) {
  return (
    <AnimatePresence>
      {active
        ? BURST.map(([x, y], index) => (
            <motion.span
              key={`${x}-${y}`}
              aria-hidden
              className="pointer-events-none absolute rounded-full bg-white"
              style={{ left: `${x}%`, top: `${y}%`, width: size * 0.045, height: size * 0.045 }}
              initial={{ opacity: 0, scale: 0.2 }}
              animate={{ opacity: [0, 1, 0], scale: [0.2, 1.6, 0.4] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7, delay: index * 0.05, ease: "easeOut" }}
            />
          ))
        : null}
    </AnimatePresence>
  );
}

/**
 * Gift artwork with the upgrade ceremony layered over it.
 *
 * `phase` is derived from the mutation by the caller, so this component holds no request state
 * and cannot disagree with the record: `rolling` while the server rolls, `revealed` once the
 * upgraded gift has arrived in the cache.
 */
export function GiftUpgradeStage({
  gift,
  size,
  phase,
  celebrate = false
}: {
  gift: Upgradable;
  size: number;
  phase: UpgradePhase;
  /**
   * Play the reveal once. Driven by the caller's mutation rather than by local state: an
   * effect that set its own flag re-fired on every re-render of the sheet, and flashing the
   * card again each time somebody scrolled the provenance list is not a celebration.
   */
  celebrate?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const rolling = phase === "rolling";
  const flash = celebrate && !reduceMotion;

  return (
    <span
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
    >
      <motion.span
        className="grid place-items-center"
        animate={
          reduceMotion
            ? undefined
            : rolling
              ? { scale: [1, 1.06, 0.97, 1.04], rotate: [0, -3, 3, 0] }
              : { scale: 1, rotate: 0 }
        }
        transition={
          rolling
            ? { duration: ROLL_MS / 1000, repeat: Infinity, ease: "easeInOut" }
            : { type: "spring", stiffness: 260, damping: 18 }
        }
      >
        <GiftImage
          {...{
            design: gift.design_slug ?? gift.slug.replace(/-\d+$/, ""),
            name: gift.name,
            model: gift.model ?? gift.model_name ?? null,
            pattern: gift.symbol ?? gift.pattern ?? null,
            accent: gift.accent,
            backdropEdge: gift.backdrop_edge,
            patternColor: gift.pattern_color,
            rarity: gift.rarity,
            upgraded: gift.upgraded !== false
          }}
          size={size}
          rounded="rounded-[26px]"
          animate="always"
        />
      </motion.span>
      {/* A ring that tightens while the server rolls, so the wait reads as a roll, not a hang. */}
      <AnimatePresence>
        {rolling && !reduceMotion ? (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[26px]"
            style={{ boxShadow: "inset 0 0 0 2px rgba(255,255,255,.55)" }}
            initial={{ opacity: 0, scale: 1.15 }}
            animate={{ opacity: [0.2, 0.85, 0.2], scale: [1.12, 0.98, 1.12] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {flash ? (
          <motion.span
            key="flash"
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[26px] bg-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.72, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        ) : null}
      </AnimatePresence>
      <Burst size={size} active={flash} />
    </span>
  );
}

/**
 * The whole upgrade block for the detail sheet: the stage, what was rolled, and the action.
 *
 * The button is the owner's only, and only while the gift is plain — an upgraded gift cannot be
 * rolled again, or the rarest model would just be a question of paying until it turned up.
 */
export function GiftUpgrade({
  gift,
  size,
  canUpgrade,
  pending,
  justUpgraded = false,
  onUpgrade
}: {
  gift: Upgradable;
  size: number;
  canUpgrade: boolean;
  pending: boolean;
  /** True once this session's upgrade succeeded, which is what plays the reveal. */
  justUpgraded?: boolean;
  onUpgrade: () => void;
}) {
  const upgraded = gift.upgraded !== false;
  const phase: UpgradePhase = pending ? "rolling" : upgraded ? "revealed" : "idle";
  const price = gift.upgrade_price_stars ?? 25;
  return (
    <div className="relative flex flex-col items-center">
      <GiftUpgradeStage gift={gift} size={size} phase={phase} celebrate={justUpgraded} />
      {canUpgrade && !upgraded ? (
        <button
          type="button"
          onClick={onUpgrade}
          disabled={pending}
          className="relative mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border-0 px-5 text-[15px] font-bold text-white transition active:scale-95 disabled:opacity-60"
          style={{ background: "var(--primary)" }}
        >
          <Sparkles size={16} />
          {pending ? "Улучшаем…" : "Улучшить"}
          <span className="inline-flex items-center gap-0.5 rounded-full bg-black/25 px-2 py-0.5 text-[13px]">
            {price}
            <Star size={11} fill="currentColor" />
          </span>
        </button>
      ) : null}
      {!upgraded && !canUpgrade ? (
        <p className="relative mb-0 mt-3 text-[13px] text-white/70">Обычный подарок — без модели</p>
      ) : null}
    </div>
  );
}

/** A short flourish on a freshly bought gift, used by the purchase receipt. */
export function GiftCelebration({ gift, size }: { gift: Upgradable; size: number }) {
  return <GiftUpgradeStage gift={gift} size={size} phase="revealed" celebrate />;
}
