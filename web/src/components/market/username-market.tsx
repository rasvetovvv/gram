"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AtSign, BadgeCheck, Hash, Search, Sparkles, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "@/lib/api";
import type { UsernameAsset, UsernameOffer } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { useToast } from "../ui/toast";
import { OFFER_STATUS, stars, UsernameSheet } from "./username-sheet";

const reserveSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{2,31}$/, "3–32 characters: Latin letters, digits and _")
});

type Scope = "all" | "mine" | "listed" | "bids";
type Sort = "fresh" | "price-asc" | "price-desc" | "short";

const SCOPES: { value: Scope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "listed", label: "For sale" },
  { value: "mine", label: "Mine" },
  { value: "bids", label: "Bids" }
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "fresh", label: "Newest lots" },
  { value: "price-asc", label: "Price ↑" },
  { value: "price-desc", label: "Price ↓" },
  { value: "short", label: "Shortest" }
];

/** A listed lot sorts by its price; anything unpriced sorts after all of them. */
function priceOf(item: UsernameAsset) {
  return item.status === "listed" && item.price != null ? item.price : Number.POSITIVE_INFINITY;
}

function listedAtOf(item: UsernameAsset) {
  return new Date(item.listed_at ?? item.acquired_at).getTime();
}

/**
 * The handle market.
 *
 * One namespace: a handle here is either somebody's account, somebody's channel or nobody's, and
 * the same row says which. Everything a marketplace needs is on the row or one tap behind it —
 * a price, the standing bids, who holds it and everyone who held it before.
 */
export function UsernameMarket() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [scope, setScope] = useState<Scope>("all");
  const [sort, setSort] = useState<Sort>("fresh");
  const [needle, setNeedle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const form = useForm<z.infer<typeof reserveSchema>>({
    resolver: zodResolver(reserveSchema),
    defaultValues: { username: "" }
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["usernames"],
    queryFn: api.usernames
  });
  const { data: myOffers = [] } = useQuery({
    queryKey: ["my-username-offers"],
    queryFn: api.myUsernameOffers
  });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });

  const mine = items.filter((item) => item.is_owned_by_me);
  const listed = items.filter((item) => item.status === "listed");
  const standingBids = myOffers.filter((offer) => offer.status === "pending");

  const reserve = useMutation({
    mutationFn: ({ username }: z.infer<typeof reserveSchema>) => api.reserveUsername(username),
    onSuccess: async (asset) => {
      form.reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["usernames"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] })
      ]);
      notify(`@${asset.username} is now attached to your account`, { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn't claim the name", { variant: "error", detail: error.message })
  });

  const visible = useMemo(() => {
    const query = needle.trim().toLowerCase().replace(/^@/, "");
    const pool =
      scope === "mine" ? mine : scope === "listed" ? listed : scope === "bids" ? [] : items;
    const filtered = query
      ? pool.filter(
          (item) =>
            item.username.includes(query) ||
            item.owner_username.toLowerCase().includes(query) ||
            (item.community_slug ?? "").toLowerCase().includes(query)
        )
      : pool;
    const sorted = [...filtered];
    if (sort === "price-asc") sorted.sort((a, b) => priceOf(a) - priceOf(b));
    if (sort === "price-desc") sorted.sort((a, b) => priceOf(b) - priceOf(a));
    if (sort === "short") sorted.sort((a, b) => a.username.length - b.username.length);
    if (sort === "fresh") sorted.sort((a, b) => listedAtOf(b) - listedAtOf(a));
    return sorted;
  }, [items, listed, mine, needle, scope, sort]);

  const openAsset = items.find((item) => item.id === openId) ?? null;

  return (
    <>
      <div className="mobile-topbar">
        <span className="wordmark">USERNAMES</span>
        <Sparkles size={20} className="text-[var(--stars)]" />
      </div>

      <section className="relative overflow-hidden px-4 pb-7 pt-8 sm:px-6 sm:pt-11">
        <div className="absolute -right-10 -top-8 size-56 rounded-full bg-[#203648] opacity-45 blur-3xl" />
        <div className="relative">
          <h1 className="channel-title max-w-[560px]">A name that belongs to you</h1>
          <p className="mt-4 max-w-[65ch] text-sm leading-6 text-[var(--muted)]">
            Check whether a @username is free, attach it to your account, buy a listed lot, or
            make your own offer. Account and channel names live in one space: what&apos;s taken
            here can&apos;t be taken anywhere else.
          </p>
          <form
            className="mt-6 flex items-start gap-2"
            onSubmit={form.handleSubmit((values) => reserve.mutate(values))}
          >
            <div className="min-w-0 flex-1">
              <label className="field flex items-center px-4">
                <span className="mr-1 font-bold text-[var(--link)]">@</span>
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="min-w-0 flex-1 bg-transparent outline-none"
                  placeholder="your_username"
                  {...form.register("username")}
                />
                <Search size={18} className="text-[var(--faint)]" />
              </label>
              <p className="mb-0 mt-2 min-h-5 text-xs text-[var(--danger)]">
                {form.formState.errors.username?.message ?? reserve.error?.message}
              </p>
            </div>
            <button className="signal-button h-12" disabled={reserve.isPending}>
              {reserve.isPending ? "Checking…" : "Claim"}
            </button>
          </form>
        </div>
      </section>

      <div className="mx-3 grid grid-cols-4 overflow-hidden rounded-[22px] bg-[#121216] text-center text-xs text-[var(--muted)] sm:mx-5">
        <div className="py-4">
          <strong className="block text-lg text-white">{mine.length}</strong>yours
        </div>
        <div className="border-l border-[var(--line)] py-4">
          <strong className="block text-lg text-white">{listed.length}</strong>lots
        </div>
        <div className="border-l border-[var(--line)] py-4">
          <strong className="block text-lg text-white">{standingBids.length}</strong>bids
        </div>
        <div className="border-l border-[var(--line)] py-4">
          <strong className="block text-lg text-[var(--stars)]">{me?.stars_balance ?? 0} ★</strong>
          balance
        </div>
      </div>

      <div className="space-y-2.5 px-3 py-4 sm:px-5">
        <div className="segmented-control" role="tablist" aria-label="Market section">
          {SCOPES.map((tab) => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={scope === tab.value}
              data-active={scope === tab.value}
              onClick={() => setScope(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {scope === "bids" ? null : (
          <div className="flex gap-2">
            <label className="field flex min-w-0 flex-1 items-center gap-2 px-3">
              <Search size={17} className="flex-none text-[var(--faint)]" />
              <input
                value={needle}
                onChange={(event) => setNeedle(event.target.value)}
                placeholder="Find a name or owner"
                aria-label="Search the market"
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              aria-label="Sort"
              className="field !w-auto flex-none px-3 text-sm"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Keyed by the section: the market's four shelves look alike enough that a snap between them
          reads as nothing having happened. */}
      <div key={scope} className="panel-enter">
        {scope === "bids" ? (
          <BidList
            offers={myOffers}
            onOpen={(assetId) => setOpenId(assetId)}
            knownAssets={items}
          />
        ) : (
          <AssetList items={visible} loading={isLoading} onOpen={setOpenId} />
        )}
      </div>

      {openAsset ? (
        <UsernameSheet
          key={openAsset.id}
          asset={openAsset}
          mine={Boolean(openAsset.is_owned_by_me)}
          open
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

function AssetList({
  items,
  loading,
  onOpen
}: {
  items: UsernameAsset[];
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2 px-3 sm:px-5">
        {[0, 1, 2].map((index) => (
          <div key={index} className="skeleton h-20 rounded-[20px]" />
        ))}
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="empty-state">
        <AtSign className="mx-auto mb-3" />
        <p>Nothing here yet</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 px-3 pb-8 sm:px-5">
      {items.map((item, index) => (
        <AssetRow key={item.id} item={item} index={index} onOpen={onOpen} />
      ))}
    </div>
  );
}

/** One lot. The right edge answers "what does it cost me", the second line "whose is it". */
function AssetRow({
  item,
  index,
  onOpen
}: {
  item: UsernameAsset;
  index: number;
  onOpen: (id: string) => void;
}) {
  const listed = item.status === "listed" && item.price != null;
  const right = item.is_owned_by_me
    ? listed
      ? stars(item.price ?? 0)
      : "Yours"
    : listed
      ? stars(item.price ?? 0)
      : item.status === "available"
        ? "Free"
        : item.offers_disabled
          ? "Not for sale"
          : "Taken";
  return (
    <motion.button
      type="button"
      id={`username-${item.username}`}
      onClick={() => onOpen(item.id)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.15) }}
      className="surface flex min-h-20 w-full scroll-mt-4 items-center gap-3 border-0 p-3.5 text-left hover:bg-[#17171d]"
    >
      <span className="grid size-12 flex-none place-items-center rounded-[16px] bg-[#17171d] text-lg font-black text-[var(--link)]">
        {item.community_slug ? <Hash size={20} /> : "@"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <strong className="truncate">@{item.username}</strong>
          {item.is_primary_handle ? (
            <span className="rounded-full bg-[#1b2a3a] px-1.5 py-0.5 text-[0.58rem] font-extrabold text-[var(--link)]">
              PRIMARY
            </span>
          ) : null}
          {item.community_slug ? (
            <span className="rounded-full bg-[#1f2a20] px-1.5 py-0.5 text-[0.58rem] font-extrabold text-[var(--online)]">
              CHANNEL
            </span>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-xs text-[var(--muted)]">
          {item.community_slug
            ? `Channel «${item.community_title}»`
            : item.owner_username
              ? `Owner @${item.owner_username}`
              : "No owner"}
          {item.offers_count ? ` · bids: ${item.offers_count}` : ""}
          {item.top_offer_stars ? ` · top ${stars(item.top_offer_stars)}` : ""}
        </span>
      </span>
      <span className="flex-none text-right">
        <span
          className={`block text-sm font-bold ${
            listed
              ? "text-[var(--stars)]"
              : item.status === "available"
                ? "text-[var(--online)]"
                : "text-[var(--muted)]"
          }`}
        >
          {right}
        </span>
        {item.my_offer_stars ? (
          <span className="mt-0.5 block text-[0.62rem] font-bold text-[var(--link)]">
            your bid {stars(item.my_offer_stars)}
          </span>
        ) : null}
      </span>
    </motion.button>
  );
}

/**
 * My own bids, standing and settled.
 *
 * A bid holds real stars, so where they are has to be visible somewhere that is not the handle's
 * own page — a bidder should not have to remember which lots they are waiting on.
 */
function BidList({
  offers,
  knownAssets,
  onOpen
}: {
  offers: UsernameOffer[];
  knownAssets: UsernameAsset[];
  onOpen: (assetId: string) => void;
}) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const withdraw = useMutation({
    mutationFn: (offerId: string) => api.withdrawUsernameOffer(offerId),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-username-offers"] }),
        queryClient.invalidateQueries({ queryKey: ["usernames"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] })
      ]);
      notify(result.detail, { variant: "success", detail: "Stars are back on your balance" });
    },
    onError: (error: Error) =>
      notify("Couldn't withdraw the bid", { variant: "error", detail: error.message })
  });

  if (!offers.length) {
    return (
      <div className="empty-state">
        <Star className="mx-auto mb-3" />
        <p>You haven&apos;t placed any bids yet</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 px-3 pb-8 sm:px-5">
      {offers.map((offer) => {
        const known = knownAssets.some((item) => item.id === offer.asset_id);
        return (
          <div key={offer.id} className="surface flex min-h-20 items-center gap-3 p-3.5">
            <button
              type="button"
              disabled={!known}
              onClick={() => onOpen(offer.asset_id)}
              className="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent p-0 text-left disabled:cursor-default"
            >
              <span className="grid size-12 flex-none place-items-center rounded-[16px] bg-[#17171d] text-lg font-black text-[var(--link)]">
                @
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate">@{offer.username}</strong>
                <span className="mt-1 block truncate text-xs text-[var(--muted)]">
                  {OFFER_STATUS[offer.status] ?? offer.status} · {relativeTime(offer.created_at)}
                </span>
              </span>
            </button>
            <span className="flex-none text-right">
              <strong className="block text-sm text-[var(--stars)]">
                {stars(offer.amount_stars)}
              </strong>
              {offer.status === "pending" ? (
                <button
                  type="button"
                  disabled={withdraw.isPending}
                  onClick={() => withdraw.mutate(offer.id)}
                  className="mt-1 border-0 bg-transparent p-0 text-[0.7rem] font-bold text-[var(--danger)]"
                >
                  withdraw
                </button>
              ) : offer.status === "accepted" ? (
                <span className="mt-1 flex items-center justify-end gap-1 text-[0.7rem] font-bold text-[var(--online)]">
                  <BadgeCheck size={12} />
                  yours
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}


