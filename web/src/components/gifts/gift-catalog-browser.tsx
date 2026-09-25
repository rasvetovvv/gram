"use client";

import { useQuery } from "@tanstack/react-query";
import { useReducedMotion } from "framer-motion";
import { Gift as GiftIcon, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { api, type GiftCatalogScope, type GiftCatalogSort } from "@/lib/api";
import type { GiftModel } from "@/lib/types";
import { GiftArtCredit } from "./gift-art-credit";
import { CatalogTile } from "./gift-catalog-tile";

const SCOPES: { value: GiftCatalogScope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "market", label: "On the market" },
  { value: "limited", label: "Limited" },
  { value: "resale", label: "Available secondhand" },
  { value: "available", label: "In stock" }
];

const SORTS: { value: GiftCatalogSort; label: string }[] = [
  { value: "position", label: "Featured" },
  { value: "price-asc", label: "Cheapest" },
  { value: "price-desc", label: "Priciest" },
  { value: "rarity", label: "By rarity" },
  { value: "supply", label: "Low supply" }
];

/**
 * The storefront: scope chips, category shelves, search, sort, and the grid.
 *
 * Filtering is a server query rather than a client filter, because the catalogue is the source
 * of scarcity — how many are left and what a design resells for cannot be derived on the client
 * without shipping every listing to it.
 */
export function GiftCatalogBrowser({
  balance,
  pendingSlug,
  onPick
}: {
  balance: number;
  pendingSlug?: string | null;
  onPick: (model: GiftModel) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [scope, setScope] = useState<GiftCatalogScope>("all");
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<GiftCatalogSort>("position");
  const [sortOpen, setSortOpen] = useState(false);

  const categories = useQuery({ queryKey: ["gift-categories"], queryFn: api.giftCategories });
  const catalog = useQuery({
    queryKey: ["gift-catalog", scope, category, query, sort],
    queryFn: () => api.giftCatalog({ scope, category: category ?? undefined, q: query, sort })
  });
  const models = catalog.data ?? [];

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        {SCOPES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setScope(item.value)}
            aria-pressed={scope === item.value}
            className="min-h-9 rounded-full border-0 px-3.5 text-[13px] font-bold transition-colors"
            style={
              scope === item.value
                ? { background: "#ffffff", color: "#000000" }
                : { background: "#1a1a1f", color: "var(--muted)" }
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {categories.data?.length ? (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setCategory(null)}
            aria-pressed={category === null}
            className="min-h-8 flex-none rounded-full border-0 px-3 text-[12px] font-bold transition-colors"
            style={
              category === null
                ? { background: "rgba(143,125,255,.22)", color: "var(--identity)" }
                : { background: "#141419", color: "var(--dim)" }
            }
          >
            All categories
          </button>
          {categories.data.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setCategory(category === item.key ? null : item.key)}
              aria-pressed={category === item.key}
              className="min-h-8 flex-none rounded-full border-0 px-3 text-[12px] font-bold transition-colors"
              style={
                category === item.key
                  ? { background: "rgba(143,125,255,.22)", color: "var(--identity)" }
                  : { background: "#141419", color: "var(--dim)" }
              }
            >
              {item.label} · {item.count}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-2">
        <label className="flex min-h-10 flex-1 items-center gap-2 rounded-full bg-[#141419] px-3">
          <Search size={16} className="flex-none text-[var(--dim)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a gift"
            aria-label="Search the catalog"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--dim)]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="grid size-6 flex-none place-items-center rounded-full border-0 bg-[#22222a] text-[var(--muted)]"
            >
              <X size={13} />
            </button>
          ) : null}
        </label>
        <button
          type="button"
          onClick={() => setSortOpen((open) => !open)}
          aria-expanded={sortOpen}
          aria-label="Sort"
          className="grid size-10 flex-none place-items-center rounded-full border-0 bg-[#141419] text-[var(--muted)]"
        >
          <SlidersHorizontal size={17} />
        </button>
      </div>

      {sortOpen ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {SORTS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setSort(item.value);
                setSortOpen(false);
              }}
              aria-pressed={sort === item.value}
              className="min-h-8 rounded-full border-0 px-3 text-[12px] font-bold"
              style={
                sort === item.value
                  ? { background: "#ffffff", color: "#000000" }
                  : { background: "#1a1a1f", color: "var(--muted)" }
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {catalog.isLoading ? (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
            <div key={item} className="skeleton aspect-[4/5] rounded-[20px]" />
          ))}
        </div>
      ) : catalog.isError ? (
        <div className="empty-state">
          <RefreshCw className="mx-auto mb-3 text-[var(--danger)]" />
          <p className="font-bold text-white">Couldn&apos;t load the catalog</p>
          <p className="text-sm">{catalog.error.message}</p>
          <button className="quiet-button mt-3" onClick={() => catalog.refetch()}>
            <RefreshCw size={16} />
            Retry
          </button>
        </div>
      ) : models.length ? (
        <>
          <p className="mb-0 mt-3 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--faint)]">
            {models.length} {models.length === 1 ? "design" : "designs"}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:gap-3">
            {models.map((model, index) => (
              <CatalogTile
                key={model.slug}
                model={model}
                index={index}
                balance={balance}
                reduceMotion={Boolean(reduceMotion)}
                pending={pendingSlug === model.slug}
                onBuy={() => onPick(model)}
              />
            ))}
          </div>
          <GiftArtCredit className="mt-4" />
        </>
      ) : (
        <div className="empty-state">
          <GiftIcon className="mx-auto mb-3 text-[var(--stars)]" />
          <p className="font-bold text-white">Nothing in this collection yet</p>
          <button
            className="quiet-button mt-3"
            onClick={() => {
              setScope("all");
              setCategory(null);
              setQuery("");
            }}
          >
            Show all
          </button>
        </div>
      )}
    </>
  );
}
