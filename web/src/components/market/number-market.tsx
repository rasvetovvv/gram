"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Phone, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { AnonymousNumber, NumberCheck } from "@/lib/types";
import { useToast } from "../ui/toast";
import { NumberSheet, stars } from "./number-sheet";

type Scope = "showcase" | "listed" | "mine";
type Sort = "fresh" | "price-asc" | "price-desc";

const SCOPES: { value: Scope; label: string }[] = [
  { value: "showcase", label: "Showcase" },
  { value: "listed", label: "For sale" },
  { value: "mine", label: "Mine" }
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "fresh", label: "Newest lots" },
  { value: "price-asc", label: "Price ↑" },
  { value: "price-desc", label: "Price ↓" }
];

function priceOf(item: AnonymousNumber) {
  return item.status === "listed" && item.price != null ? item.price : Number.POSITIVE_INFINITY;
}

function listedAtOf(item: AnonymousNumber) {
  return new Date(item.listed_at ?? item.acquired_at).getTime();
}

/**
 * The anonymous +888 number market.
 *
 * Mirrors the handle market: a curated showcase sells at the floor, any valid unheld number can
 * be bought on demand from the search box, and a held number can be listed for resale. One held
 * number per account, so the search box doubles as an availability check.
 */
export function NumberMarket() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [scope, setScope] = useState<Scope>("showcase");
  const [sort, setSort] = useState<Sort>("fresh");
  const [needle, setNeedle] = useState("");
  const [check, setCheck] = useState<NumberCheck | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["numbers"],
    queryFn: api.numbers
  });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });

  const mine = items.filter((item) => item.is_owned_by_me);
  const listed = items.filter((item) => item.status === "listed");
  const showcase = items.filter((item) => item.status === "available");

  const checkNumber = useMutation({
    mutationFn: (value: string) => api.checkNumber(value),
    onSuccess: (result) => setCheck(result),
    onError: (error: Error) => {
      setCheck(null);
      notify("That doesn't look like a +888 number", { variant: "error", detail: error.message });
    }
  });

  const buy = useMutation({
    mutationFn: (value: string) => api.buyNumber(value),
    onSuccess: async (number) => {
      setCheck(null);
      setNeedle("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["numbers"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] })
      ]);
      notify(`${number.formatted} is now yours`, {
        variant: "success",
        detail: `${stars(1000)} charged`
      });
    },
    onError: (error: Error) =>
      notify("Couldn't buy the number", { variant: "error", detail: error.message })
  });

  const visible = useMemo(() => {
    const query = needle.replace(/\D/g, "");
    const pool =
      scope === "mine" ? mine : scope === "listed" ? listed : showcase;
    const filtered = query
      ? pool.filter((item) => item.number.includes(query))
      : pool;
    const sorted = [...filtered];
    if (sort === "price-asc") sorted.sort((a, b) => priceOf(a) - priceOf(b));
    if (sort === "price-desc") sorted.sort((a, b) => priceOf(b) - priceOf(a));
    if (sort === "fresh") sorted.sort((a, b) => listedAtOf(b) - listedAtOf(a));
    return sorted;
  }, [listed, mine, needle, scope, showcase, sort]);

  const openNumber = items.find((item) => item.id === openId) ?? null;
  const alreadyHolds = mine.length > 0;

  return (
    <>
      <section className="relative overflow-hidden px-4 pb-7 pt-8 sm:px-6 sm:pt-11">
        <div className="absolute -left-10 -top-8 size-56 rounded-full bg-[#123047] opacity-45 blur-3xl" />
        <div className="relative">
          <h1 className="channel-title max-w-[560px]">An anonymous +888 number</h1>
          <p className="mt-4 max-w-[65ch] text-sm leading-6 text-[var(--muted)]">
            A collectible identifier in the +888 space. Check whether a number is free, buy it at
            the floor of {stars(1000)}, and resell it on the market. One number per account.
          </p>
          <div className="mt-6 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <label className="field flex items-center px-4">
                <span className="mr-1 font-bold text-[var(--link)]">+888</span>
                <input
                  inputMode="numeric"
                  className="min-w-0 flex-1 bg-transparent outline-none"
                  placeholder="8888 8888"
                  value={needle}
                  onChange={(event) => {
                    setNeedle(event.target.value);
                    setCheck(null);
                  }}
                />
                <Search size={18} className="text-[var(--faint)]" />
              </label>
              {check ? (
                <p
                  className={`mb-0 mt-2 min-h-5 text-xs font-semibold ${
                    check.available ? "text-[var(--online)]" : "text-[var(--danger)]"
                  }`}
                >
                  {check.available
                    ? `${check.formatted} is free — ${stars(check.price ?? 1000)}`
                    : `${check.formatted} is already taken`}
                </p>
              ) : (
                <p className="mb-0 mt-2 min-h-5 text-xs text-[var(--muted)]">
                  Enter the eight digits after +888.
                </p>
              )}
            </div>
            {check?.available ? (
              <button
                className="gold-button h-12"
                disabled={buy.isPending || alreadyHolds}
                title={alreadyHolds ? "You already hold a number" : undefined}
                onClick={() => buy.mutate(needle)}
              >
                {buy.isPending ? "Buying…" : "Buy"}
              </button>
            ) : (
              <button
                className="signal-button h-12"
                disabled={checkNumber.isPending || needle.replace(/\D/g, "").length < 8}
                onClick={() => checkNumber.mutate(needle)}
              >
                {checkNumber.isPending ? "Checking…" : "Check"}
              </button>
            )}
          </div>
          {alreadyHolds ? (
            <p className="mb-0 mt-2 text-xs text-[var(--muted)]">
              You already hold {mine[0].formatted}. Release or sell it to buy another.
            </p>
          ) : null}
        </div>
      </section>

      <div className="mx-3 grid grid-cols-3 overflow-hidden rounded-[22px] bg-[#121216] text-center text-xs text-[var(--muted)] sm:mx-5">
        <div className="py-4">
          <strong className="block text-lg text-white">{mine.length}</strong>yours
        </div>
        <div className="border-l border-[var(--line)] py-4">
          <strong className="block text-lg text-white">{listed.length}</strong>lots
        </div>
        <div className="border-l border-[var(--line)] py-4">
          <strong className="block text-lg text-[var(--stars)]">{me?.stars_balance ?? 0} ★</strong>
          balance
        </div>
      </div>

      <div className="space-y-2.5 px-3 py-4 sm:px-5">
        <div className="segmented-control" role="tablist" aria-label="Number market section">
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
        <div className="flex justify-end">
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
      </div>

      <div key={scope} className="panel-enter">
        <NumberList items={visible} loading={isLoading} onOpen={setOpenId} />
      </div>

      {openNumber ? (
        <NumberSheet
          key={openNumber.id}
          number={openNumber}
          mine={Boolean(openNumber.is_owned_by_me)}
          open
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}

function NumberList({
  items,
  loading,
  onOpen
}: {
  items: AnonymousNumber[];
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
        <Phone className="mx-auto mb-3" />
        <p>Nothing here yet</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 px-3 pb-8 sm:px-5">
      {items.map((item, index) => (
        <NumberRow key={item.id} item={item} index={index} onOpen={onOpen} />
      ))}
    </div>
  );
}

function NumberRow({
  item,
  index,
  onOpen
}: {
  item: AnonymousNumber;
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
        ? stars(item.price ?? 1000)
        : "Taken";
  return (
    <motion.button
      type="button"
      id={`number-${item.number}`}
      onClick={() => onOpen(item.id)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.15) }}
      className="surface flex min-h-20 w-full scroll-mt-4 items-center gap-3 border-0 p-3.5 text-left hover:bg-[#17171d]"
    >
      <span className="grid size-12 flex-none place-items-center rounded-[16px] bg-[#17171d] text-[var(--link)]">
        <Phone size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <strong className="truncate tracking-wide">{item.formatted}</strong>
          {item.curated ? (
            <span className="rounded-full bg-[#1b2a3a] px-1.5 py-0.5 text-[0.58rem] font-extrabold text-[var(--link)]">
              SHOWCASE
            </span>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-xs text-[var(--muted)]">
          {item.owner_username ? `Owner @${item.owner_username}` : "No owner"}
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
      </span>
    </motion.button>
  );
}
