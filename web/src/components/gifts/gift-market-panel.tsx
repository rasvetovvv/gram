"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingBag, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, type GiftMarketSort } from "@/lib/api";
import type { GiftMarketItem } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { useToast } from "../ui/toast";
import { GiftImage, giftArtProps } from "./gift-image";

const SORTS: { value: GiftMarketSort; label: string }[] = [
  { value: "recent", label: "Newest lots" },
  { value: "price-asc", label: "Cheapest" },
  { value: "price-desc", label: "Priciest" }
];

/**
 * The resale shelf: minted copies their owners priced for immediate sale.
 *
 * Offers and listings answer different questions. An offer asks an owner to consider a number
 * and may sit unanswered; a listing is a price already agreed to, so buying is one action. Both
 * exist here, and this panel is the half that settles instantly.
 */
export function GiftMarketPanel({ balance }: { balance: number }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [sort, setSort] = useState<GiftMarketSort>("recent");
  const market = useQuery({
    queryKey: ["gift-market", sort],
    queryFn: () => api.giftMarket({ sort })
  });

  const buy = useMutation({
    mutationFn: (item: GiftMarketItem) => api.buyGift(item.gift_id),
    onSuccess: async (gift) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gift-market"] }),
        queryClient.invalidateQueries({ queryKey: ["gift-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["gift-design"] }),
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["stars-wallet"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] })
      ]);
      notify(`"${gift.name}" #${gift.serial_number} is yours`, {
        variant: "success",
        detail: "Bought on the market"
      });
    },
    onError: (error: Error) =>
      notify("Purchase failed", { variant: "error", detail: error.message })
  });

  const items = market.data ?? [];
  if (market.isLoading) {
    return (
      <section className="mx-3 mb-4 sm:mx-5">
        <div className="skeleton h-28 rounded-[20px]" />
      </section>
    );
  }
  if (!items.length) return null;

  return (
    <section className="mx-3 mb-4 sm:mx-5">
      <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
        <h2 className="m-0 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.04em] text-[var(--faint)]">
          <ShoppingBag size={14} />
          Market · {items.length}
        </h2>
        <div className="flex gap-1.5">
          {SORTS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setSort(item.value)}
              aria-pressed={sort === item.value}
              className="min-h-7 rounded-full border-0 px-2.5 text-[11px] font-bold transition-colors"
              style={
                sort === item.value
                  ? { background: "#ffffff", color: "#000000" }
                  : { background: "#141419", color: "var(--dim)" }
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="m-0 grid list-none gap-2 p-0">
        {items.map((item) => (
          <li
            key={item.gift_id}
            className="flex items-center gap-2.5 rounded-[20px] bg-[var(--surface)] p-2 shadow-[inset_0_0_0_1px_var(--line)] sm:gap-3 sm:p-2.5"
          >
            <GiftImage
              {...giftArtProps(item)}
              size={48}
              rounded="rounded-[15px]"
              className="flex-none"
            />
            <span className="min-w-0 flex-1 overflow-hidden">
              <strong className="block truncate text-sm">
                {item.name} #{item.serial_number.toLocaleString("en-US")}
              </strong>
              <span className="block truncate text-xs text-[var(--muted)]">
                {item.model ?? "—"} · {item.backdrop ?? "—"} ·{" "}
                <Link href={`/u/${item.owner.username}`} className="text-[var(--link)]">
                  @{item.owner.username}
                </Link>
              </span>
              {item.listed_at ? (
                <span className="block text-[11px] text-[var(--faint)]">
                  listed {relativeTime(item.listed_at)}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => buy.mutate(item)}
              disabled={
                item.is_mine || balance < item.price_stars || (buy.isPending && buy.variables?.gift_id === item.gift_id)
              }
              aria-label={`Buy ${item.name} for ${item.price_stars} stars`}
              className="flex min-h-10 flex-none items-center gap-1.5 rounded-full border-0 bg-[var(--stars)] px-3.5 text-[13px] font-extrabold text-black disabled:opacity-45"
            >
              {buy.isPending && buy.variables?.gift_id === item.gift_id ? (
                "…"
              ) : item.is_mine ? (
                "your lot"
              ) : (
                <>
                  <Star size={14} fill="currentColor" />
                  {item.price_stars}
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
      {buy.error ? (
        <p className="mb-0 mt-2 px-1 text-xs text-[var(--danger)]" aria-live="polite">
          {buy.error.message}
        </p>
      ) : null}
    </section>
  );
}
