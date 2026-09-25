"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, type ShowcaseSlot } from "@/lib/api";
import type { Gift, User } from "@/lib/types";
import { useUiStore } from "@/store/ui";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";
import { GiftImage, giftArtProps } from "../gifts/gift-image";

/**
 * Which gift sits where on the cover.
 *
 * Four places, in a fixed order: the first is anyone's to arrange, the rest come with Premium.
 * Every filled slot can be emptied whatever the account pays, so a lapsed subscription leaves
 * a cover its owner can still tidy.
 */
export const COVER_SLOTS: ShowcaseSlot[] = ["featured", "cover2", "cover3", "cover4"];

const SLOT_TITLES: Record<string, string> = {
  featured: "First gift",
  cover2: "Second gift",
  cover3: "Third gift",
  cover4: "Fourth gift"
};

export function CoverGiftsSheet({
  profile,
  gifts,
  open,
  onOpenChange
}: {
  profile: User;
  gifts: Gift[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const openPremium = useUiStore((state) => state.openPremium);
  const [picking, setPicking] = useState<ShowcaseSlot | null>(null);

  function showPremium() {
    onOpenChange(false);
    setPicking(null);
    window.setTimeout(openPremium, 0);
  }

  const owned = useQuery({
    queryKey: ["gifts", profile.username],
    queryFn: () => api.gifts(profile.username),
    enabled: open
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["profile", profile.username] }),
      queryClient.invalidateQueries({ queryKey: ["me"] }),
      queryClient.invalidateQueries({ queryKey: ["gifts", profile.username] })
    ]);

  const place = useMutation({
    mutationFn: ({ id, slot }: { id: string; slot: ShowcaseSlot }) => api.setGiftShowcase(id, slot),
    onSuccess: async () => {
      setPicking(null);
      await refresh();
      notify("Cover updated", { variant: "success" });
    },
    onError: (error: Error) => {
      // 402 is the premium boundary, and the sheet says so rather than reading as a failure.
      const premium = error.message.includes("Premium");
      notify(premium ? "This is a Premium feature" : "Couldn’t set gift", {
        variant: premium ? "info" : "error",
        detail: error.message
      });
      if (premium) showPremium();
    }
  });
  const clear = useMutation({
    mutationFn: (slot: ShowcaseSlot) => api.clearShowcaseSlot(slot),
    onSuccess: async () => {
      await refresh();
      notify("Gift removed from cover", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn’t remove gift", { variant: "error", detail: error.message })
  });
  const clearAll = useMutation({
    mutationFn: async () => {
      const current = owned.data ?? gifts;
      for (const slot of COVER_SLOTS) {
        if (current.some((gift) => gift.showcased_as === slot)) {
          await api.clearShowcaseSlot(slot);
        }
      }
    },
    onSuccess: async () => {
      await refresh();
      notify("Cover cleared", { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Couldn’t clear cover", { variant: "error", detail: error.message })
  });

  const cover = profile.cover_gifts ?? [];
  const isPremium = Boolean(profile.is_premium);
  const source = owned.data ?? gifts;
  const filled = new Map(
    COVER_SLOTS.map((slot, index) => [
      slot,
      source.find((gift) => gift.showcased_as === slot) ?? cover[index]
    ])
  );
  const filledCount = [...filled.values()].filter(Boolean).length;
  const pool = source.filter((gift) => !gift.hidden_in_profile);

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setPicking(null);
      }}
      title="Cover gifts"
      description="Up to four gifts on top of your cover"
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Cover gifts</h2>
        <p className="mb-3 mt-1 text-[13px] leading-5 text-[var(--muted)]">
          Anyone can set the first gift. The second, third, and fourth — plus the gift next to your
          name — are part of Premium.
        </p>
        <div className="mb-4 flex min-h-11 items-center justify-between gap-3 rounded-[14px] bg-white/[0.04] px-3">
          <span className="text-[13px] font-semibold text-[var(--muted)]">
            {filledCount} of {COVER_SLOTS.length} filled
            {!isPremium ? " · one slot is free" : " · all slots unlocked"}
          </span>
          {filledCount ? (
            <button
              type="button"
              className="min-h-10 flex-none rounded-full px-3 text-[12px] font-bold text-[var(--danger)] disabled:opacity-50"
              onClick={() => clearAll.mutate()}
              disabled={clearAll.isPending || clear.isPending}
            >
              {clearAll.isPending ? "Clearing…" : "Clear"}
            </button>
          ) : null}
        </div>

        {picking ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong className="text-[15px] font-bold">{SLOT_TITLES[picking]}</strong>
              <button type="button" className="quiet-button !h-9" onClick={() => setPicking(null)}>
                Back
              </button>
            </div>
            {pool.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {pool.map((gift) => (
                  <button
                    key={gift.id}
                    type="button"
                    disabled={place.isPending}
                    onClick={() => place.mutate({ id: gift.id, slot: picking })}
                    className="grid place-items-center gap-1 rounded-[16px] bg-[var(--surface-raised)] p-2 transition hover:brightness-110 active:scale-95 disabled:opacity-60"
                  >
                    <GiftImage {...giftArtProps(gift)} size={56} bare animate="hover" />
                    <span className="w-full truncate text-center text-[11px] text-[var(--muted)]">
                      #{gift.serial_number}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-[14px] bg-white/[0.04] p-3 text-[13px] leading-5 text-[var(--muted)]">
                <p className="m-0">
                  {source.length
                    ? "Hidden gifts can’t go on your cover — return them to your collection first."
                    : "You don’t have any gifts yet. Pick one from the catalog — after purchase it will show up here."}
                </p>
                {!source.length ? (
                  <Link href="/gifts" onClick={() => onOpenChange(false)} className="quiet-button mt-3 inline-flex !min-h-10 !px-3 text-[13px]">
                    Open gift catalog
                  </Link>
                ) : null}
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-2">
            {COVER_SLOTS.map((slot, index) => {
              const gift = filled.get(slot);
              const locked = index > 0 && !isPremium;
              return (
                <div
                  key={slot}
                  className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-3 rounded-[16px] bg-[var(--surface-raised)] p-2.5 sm:flex"
                >
                  <span className="grid size-12 flex-none place-items-center rounded-[14px] bg-black/25">
                    {gift ? (
                      <GiftImage {...giftArtProps(gift)} size={40} bare />
                    ) : (
                      <Sparkles size={18} className="text-[var(--dim)]" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.95rem] font-bold">{SLOT_TITLES[slot]}</span>
                    <span className="block truncate text-[12px] text-[var(--muted)]">
                      {gift
                        ? `${gift.name} #${gift.serial_number}`
                        : locked
                          ? "Unlocks with Premium"
                          : "Empty"}
                    </span>
                  </span>
                  <span className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1 sm:ml-auto">
                    {gift ? (
                      <button
                        type="button"
                        className="icon-button !size-11"
                        aria-label={`Remove ${gift.name} from cover`}
                        disabled={clear.isPending || clearAll.isPending}
                        onClick={() => clear.mutate(slot)}
                      >
                        <X size={17} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="quiet-button !min-h-11 !px-3 !text-[13px]"
                      disabled={place.isPending || clearAll.isPending}
                      onClick={() => (locked ? showPremium() : setPicking(slot))}
                    >
                      {locked ? <Crown size={14} /> : <Plus size={14} />}
                      {gift ? "Replace" : locked ? "Premium" : "Choose"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
