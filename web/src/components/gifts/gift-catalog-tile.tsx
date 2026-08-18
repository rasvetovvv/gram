"use client";

import { motion } from "framer-motion";
import { Star } from "lucide-react";
import type { GiftModel } from "@/lib/types";
import { GiftImage, giftArtProps } from "./gift-image";

/**
 * One catalogue design as a tile. Shared by the profile purchase sheet and by gifting inside
 * a chat so both grids stay the same object, not two drifting copies.
 *
 * A tile shows what is scarce about the design — limited badge, copies left, a resale floor —
 * because that is what a buyer decides on, and it is the tile that has to carry it.
 */
export function CatalogTile({
  model,
  index,
  balance,
  pending,
  reduceMotion,
  onBuy
}: {
  model: GiftModel;
  index: number;
  balance: number;
  pending: boolean;
  reduceMotion: boolean;
  onBuy: () => void;
}) {
  const affordable = balance >= model.price_stars;
  const remaining = model.remaining ?? 0;
  const scarce = model.limited && remaining > 0 && remaining <= model.edition_size * 0.35;
  return (
    <motion.button
      type="button"
      onClick={onBuy}
      disabled={pending}
      aria-label={`${model.name}, ${model.price_stars} звёзд${model.sold_out ? ", распродан" : ""}`}
      initial={reduceMotion ? undefined : { opacity: 0, y: 10 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.15), duration: 0.24 }}
      className="relative flex flex-col overflow-hidden rounded-[20px] border-0 bg-[var(--surface)] p-1.5 text-center shadow-[inset_0_0_0_1px_var(--line)] transition-transform active:scale-[0.97] disabled:opacity-55"
    >
      {model.on_market ? (
        <span className="absolute -right-8 top-3 w-24 rotate-45 bg-[#1f7a4d] py-1 text-center text-[0.56rem] font-extrabold uppercase tracking-wide text-white">
          маркет
        </span>
      ) : null}
      {model.limited ? (
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-1.5 py-0.5 text-[0.52rem] font-extrabold uppercase tracking-wide text-[var(--stars)]">
          лимит
        </span>
      ) : null}
      {/*
        The square is the gift's own backdrop, at whatever size the column happens to be. A
        fixed pixel size plus a `sm:` class override fought each other and left the artwork
        off-centre in the tile; letting the box own the size fixes it at every breakpoint.
      */}
      <span className="block aspect-square w-full overflow-hidden rounded-[15px]">
        <GiftImage {...giftArtProps(model)} size={160} rounded="rounded-[15px]" fill />
      </span>
      <strong className="mt-1.5 block w-full truncate px-1 text-[0.72rem] leading-4 sm:text-[0.82rem]">
        {model.name}
      </strong>
      {model.sold_out ? (
        <span className="mt-1 block text-[0.56rem] font-bold uppercase tracking-wide text-[var(--danger)]">
          распродан
        </span>
      ) : scarce ? (
        <span className="mt-1 block text-[0.56rem] font-bold uppercase tracking-wide text-[var(--stars)]">
          осталось {remaining.toLocaleString("ru-RU")}
        </span>
      ) : model.resale_count ? (
        <span className="mt-1 block truncate text-[0.56rem] font-bold uppercase tracking-wide text-[var(--online)]">
          с рук от {model.resale_floor_stars} ★
        </span>
      ) : (
        <span className="mt-1 block text-[0.56rem] text-transparent">·</span>
      )}
      <span
        className="mx-auto mt-1 flex min-h-7 items-center gap-1 rounded-full px-2.5 text-[0.72rem] font-extrabold"
        style={{
          background: "rgba(0,0,0,.45)",
          color: model.sold_out || affordable ? "var(--stars)" : "var(--dim)"
        }}
      >
        {pending ? (
          "…"
        ) : (
          <>
            <Star size={12} fill="currentColor" />
            {model.price_stars}
          </>
        )}
      </span>
    </motion.button>
  );
}
