"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, History, LogOut, Phone, ShieldCheck, Star, Tag, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { AnonymousNumber } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { BottomSheet } from "../ui/bottom-sheet";
import { TopUpButton } from "../stars/top-up-button";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";

const ACTION_LABEL: Record<string, string> = {
  acquired: "Bought",
  listed: "Listed for sale",
  unlisted: "Removed from sale",
  released: "Released"
};

/** Every stars figure in the market is written the same way. */
function stars(amount: number) {
  return `${new Intl.NumberFormat("en-US").format(amount)} ★`;
}

/**
 * One anonymous +888 number, and everything its owner or a buyer can do with it: buy a listing,
 * list the held number for resale, take it off the market, release it, and the ownership trail.
 */
export function NumberSheet({
  number,
  open,
  onClose,
  mine
}: {
  number: AnonymousNumber;
  open: boolean;
  onClose: () => void;
  mine: boolean;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [price, setPrice] = useState(String(number.price ?? 1000));
  const [confirmBuy, setConfirmBuy] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);

  const history = useQuery({
    queryKey: ["number-history", number.id],
    queryFn: () => api.numberHistory(number.id),
    enabled: open
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["numbers"] }),
      queryClient.invalidateQueries({ queryKey: ["number-history", number.id] }),
      queryClient.invalidateQueries({ queryKey: ["me"] })
    ]);
  }

  const fail = (title: string) => (error: Error) =>
    notify(title, { variant: "error", detail: error.message });

  const list = useMutation({
    mutationFn: () => api.updateNumberListing(number.id, true, Number(price)),
    onSuccess: async () => {
      await refresh();
      notify(`${number.formatted} listed for ${stars(Number(price))}`, { variant: "success" });
    },
    onError: fail("Couldn't list")
  });
  const unlist = useMutation({
    mutationFn: () => api.updateNumberListing(number.id, false),
    onSuccess: async () => {
      await refresh();
      notify(`${number.formatted} removed from sale`, { variant: "success" });
    },
    onError: fail("Couldn't remove from sale")
  });
  const buy = useMutation({
    mutationFn: () => api.buyListedNumber(number.id),
    onSuccess: async () => {
      await refresh();
      notify(`${number.formatted} is now yours`, {
        variant: "success",
        detail: `${stars(number.price ?? 0)} charged`
      });
      onClose();
    },
    onError: fail("Couldn't buy")
  });
  const release = useMutation({
    mutationFn: () => api.releaseNumber(number.id),
    onSuccess: async () => {
      await refresh();
      notify(`${number.formatted} released`, {
        variant: "success",
        detail: "The number is free again"
      });
      setConfirmRelease(false);
      onClose();
    },
    onError: fail("Couldn't release")
  });

  const listed = number.status === "listed" && number.price != null;
  const busy = list.isPending || unlist.isPending || buy.isPending || release.isPending;

  async function copy(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    notify(message, { variant: "success" });
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={number.formatted}
      description="Anonymous +888 number"
      headerRight={
        <Dialog.Close className="icon-button !size-9 bg-[#27272a]" aria-label="Close">
          <X size={18} />
        </Dialog.Close>
      }
    >
      <div className="pt-1">
        <h2 className="m-0 flex items-center gap-2 text-2xl font-extrabold tracking-[-0.02em] text-[var(--link)]">
          <Phone size={22} />
          {number.formatted}
        </h2>
        <p className="mb-0 mt-1 flex flex-wrap items-center gap-1.5 text-sm text-[var(--muted)]">
          {listed ? (
            <span className="rounded-full bg-[#342813] px-2 py-0.5 text-[11px] font-extrabold text-[var(--stars)]">
              {stars(number.price ?? 0)}
            </span>
          ) : null}
          {number.curated ? (
            <span className="rounded-full bg-[#1b2a3a] px-2 py-0.5 text-[11px] font-extrabold text-[var(--link)]">
              showcase
            </span>
          ) : null}
        </p>
      </div>

      <div className="mt-4 overflow-hidden rounded-[20px] bg-[#27272a]">
        <Fact label="Owner">
          {number.owner ? (
            <span className="flex items-center gap-2">
              <UserAvatar src={number.owner.avatar_url} name={number.owner.display_name} size={22} />
              @{number.owner_username}
            </span>
          ) : (
            "Available"
          )}
        </Fact>
        <Fact label="Acquired">
          {new Intl.DateTimeFormat("en-US", {
            day: "numeric",
            month: "short",
            year: "numeric"
          }).format(new Date(number.acquired_at))}
        </Fact>
      </div>

      <div className="mt-3">
        <button className="quiet-button w-full !px-3" onClick={() => copy(number.formatted, "Number copied")}>
          <Copy size={17} />
          Copy number
        </button>
      </div>

      {mine ? (
        <>
          <section className="mt-4 rounded-[22px] bg-[#27272a] p-4">
            <h3 className="m-0 flex items-center gap-2 text-base font-bold">
              <Tag size={16} className="text-[var(--stars)]" />
              {listed ? "Listing on sale" : "List for sale"}
            </h3>
            <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
              Ownership passes to the buyer only after an atomic payment. The floor is {stars(1000)}.
            </p>
            <label className="field mt-3 flex items-center gap-2 px-3">
              <Star size={17} className="text-[var(--stars)]" fill="currentColor" />
              <input
                type="number"
                min={1000}
                max={100_000_000}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                aria-label="Price in stars"
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
            <div className="mt-3 flex gap-2">
              <button
                className="gold-button flex-1"
                disabled={busy || Number(price) < 1000}
                onClick={() => list.mutate()}
              >
                <Tag size={17} />
                {listed ? "Update price" : "List"}
              </button>
              {listed ? (
                <button className="quiet-button flex-1" disabled={busy} onClick={() => unlist.mutate()}>
                  Remove
                </button>
              ) : null}
            </div>
          </section>

          <section className="mt-3 rounded-[22px] bg-[#27272a] p-4">
            <h3 className="m-0 flex items-center gap-2 text-base font-bold">
              <LogOut size={16} className="text-[var(--danger)]" />
              Release number
            </h3>
            <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
              {confirmRelease
                ? `${number.formatted} will no longer be yours and will return to the pool.`
                : "The number leaves your account and becomes free again."}
            </p>
            {confirmRelease ? (
              <div className="mt-3 flex gap-2">
                <button
                  className="quiet-button flex-1"
                  disabled={release.isPending}
                  onClick={() => setConfirmRelease(false)}
                >
                  Keep it
                </button>
                <button
                  className="inline-flex min-h-9 flex-1 items-center justify-center rounded-full border-0 bg-[var(--danger)] px-4 text-base font-medium text-white transition-transform active:scale-[.97] disabled:opacity-50"
                  disabled={release.isPending}
                  onClick={() => release.mutate()}
                >
                  {release.isPending ? "Releasing…" : "Yes, release"}
                </button>
              </div>
            ) : (
              <button
                className="quiet-button mt-3 w-full text-[var(--danger)]"
                onClick={() => setConfirmRelease(true)}
              >
                Release {number.formatted}
              </button>
            )}
          </section>
        </>
      ) : (
        <section className="mt-4 space-y-3">
          {listed ? (
            confirmBuy ? (
              <div className="rounded-[22px] bg-[#2b2024] p-4">
                <p className="m-0 text-sm leading-5">
                  Buy <strong>{number.formatted}</strong> for{" "}
                  <strong>{stars(number.price ?? 0)}</strong>? The number will transfer to you right away.
                </p>
                <div className="mt-3 flex gap-2">
                  <button className="quiet-button flex-1" onClick={() => setConfirmBuy(false)}>
                    Back
                  </button>
                  <button className="gold-button flex-1" disabled={busy} onClick={() => buy.mutate()}>
                    {buy.isPending ? "Buying…" : "Confirm"}
                  </button>
                </div>
                <TopUpButton label="Top up stars" className="quiet-button mt-2 w-full" />
              </div>
            ) : (
              <button className="gold-button w-full" onClick={() => setConfirmBuy(true)}>
                <Star size={17} fill="currentColor" />
                Buy for {stars(number.price ?? 0)}
              </button>
            )
          ) : (
            <p className="m-0 rounded-[22px] bg-[#27272a] p-4 text-sm text-[var(--muted)]">
              This number isn&apos;t listed for sale right now.
            </p>
          )}
        </section>
      )}

      <section className="mt-5">
        <h3 className="m-0 text-base font-bold">Ownership history</h3>
        <div className="mt-3 space-y-2">
          {history.isLoading ? (
            <div className="skeleton h-14 rounded-[18px]" />
          ) : history.data?.length ? (
            history.data.map((event, index) => (
              <div key={index} className="flex items-center gap-3 rounded-[18px] bg-[#27272a] p-3">
                <span className="grid size-9 flex-none place-items-center rounded-full bg-[#1f1f24] text-[var(--primary-strong)]">
                  <History size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">
                    {ACTION_LABEL[event.action] ?? event.action}
                  </strong>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {event.to_username ? `@${event.to_username}` : "GRAM"}
                    {event.from_username ? ` ← @${event.from_username}` : ""} ·{" "}
                    {relativeTime(event.created_at)}
                  </span>
                </span>
                {event.price_stars ? (
                  <span className="flex-none text-xs font-bold text-[var(--stars)]">
                    {stars(event.price_stars)}
                  </span>
                ) : null}
              </div>
            ))
          ) : (
            <p className="m-0 text-sm text-[var(--muted)]">No history yet.</p>
          )}
        </div>
      </section>

      <div className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]">
        <ShieldCheck size={16} className="text-[var(--online)]" />
        Every ownership change stays in the history
      </div>
    </BottomSheet>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-13 items-center gap-3 border-b border-[var(--line)] px-4 last:border-b-0">
      <span className="w-24 flex-none text-sm text-[var(--muted)]">{label}</span>
      <strong className="min-w-0 flex-1 truncate text-sm font-semibold">{children}</strong>
    </div>
  );
}

export { stars };
