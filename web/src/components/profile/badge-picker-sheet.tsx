"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Crown, Lock, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { BadgeOffer } from "@/lib/types";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";
import { BadgeDetailPopover, rarityLabel } from "./badge-detail";

/**
 * Choosing which badges a profile wears.
 *
 * Every badge in GRAM is on the shelf, including the ones this account has not earned: a list of
 * only what somebody already has tells them nothing to aim at, and the requirement is the
 * interesting part. Three fit at once, seven with Premium — the server enforces both, and this
 * sheet says which before anybody presses save.
 */
export function BadgePickerSheet({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const shelf = useQuery({
    queryKey: ["my-badges"],
    queryFn: api.myBadges,
    enabled: open
  });
  // The sheet's own draft, so an accidental tap is undone by closing it.
  const [draft, setDraft] = useState<string[] | null>(null);
  const limit = shelf.data?.limit ?? 3;
  const chosen = draft ?? shelf.data?.slots ?? [];

  const save = useMutation({
    mutationFn: () => api.chooseBadges(chosen),
    onSuccess: async (profile) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["my-badges"] }),
        queryClient.invalidateQueries({ queryKey: ["profile", profile.username] })
      ]);
      notify("Badges updated", {
        variant: "success",
        detail: chosen.length ? `Wearing ${chosen.length} of ${limit}` : "Badges hidden"
      });
      setDraft(null);
      onOpenChange(false);
    },
    onError: (error: Error) =>
      notify("Couldn't save badges", { variant: "error", detail: error.message })
  });

  function toggle(offer: BadgeOffer) {
    const slug = offer.badge.slug;
    if (!offer.earned) {
      notify(offer.badge.title, { variant: "error", detail: offer.badge.qualification });
      return;
    }
    setDraft(() => {
      if (chosen.includes(slug)) return chosen.filter((item) => item !== slug);
      if (chosen.length >= limit) {
        notify(`Can't wear more than ${limit}`, {
          variant: "error",
          detail: limit === 3 ? "With Premium you can wear 7 badges" : undefined
        });
        return chosen;
      }
      return [...chosen, slug];
    });
  }

  const offers = shelf.data?.badges ?? [];
  const earned = offers.filter((offer) => offer.earned);
  const locked = offers.filter((offer) => !offer.earned);

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setDraft(null);
      }}
      title="Profile badges"
      description="Pins shown on your profile"
      headerRight={
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="icon-button !size-9 bg-[#27272a]"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      }
      footer={
        <button
          type="button"
          className="profile-primary-action w-full"
          disabled={save.isPending || shelf.isLoading}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : `Save · ${chosen.length} of ${limit}`}
        </button>
      }
    >
      <div className="pb-2">
        <p className="mb-4 mt-1 text-[13px] leading-5 text-[var(--muted)]">
          Selected {chosen.length} of {limit}.{" "}
          {limit === 3 ? (
            <>
              With{" "}
              <Link href="/premium" className="font-semibold text-[var(--link)]">
                Premium
              </Link>{" "}
              you can wear seven.
            </>
          ) : (
            "Premium: seven slots."
          )}
        </p>

        {shelf.isLoading ? (
          <div className="grid gap-2">
            {[0, 1, 2].map((index) => (
              <div key={index} className="skeleton h-16 rounded-[18px]" />
            ))}
          </div>
        ) : (
          <>
            <Group title="Your badges" empty="No badges earned yet.">
              {earned.map((offer) => (
                <Row
                  key={offer.badge.slug}
                  offer={offer}
                  chosen={chosen.includes(offer.badge.slug)}
                  onToggle={() => toggle(offer)}
                />
              ))}
            </Group>
            <Group title="Still available" empty="You've collected everything.">
              {locked.map((offer) => (
                <Row key={offer.badge.slug} offer={offer} chosen={false} onToggle={() => toggle(offer)} />
              ))}
            </Group>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

function Group({
  title,
  empty,
  children
}: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="m-0 text-[0.95rem] font-bold">{title}</h3>
      <div className="mt-2 grid gap-2">
        {children.length ? children : <p className="m-0 text-[13px] text-[var(--dim)]">{empty}</p>}
      </div>
    </section>
  );
}

/** One badge: its seal, what it is, and either a checkbox or what it still needs. */
function Row({
  offer,
  chosen,
  onToggle
}: {
  offer: BadgeOffer;
  chosen: boolean;
  onToggle: () => void;
}) {
  const { badge, earned, progress, target } = offer;
  return (
    <div
      className={`flex items-center gap-3 rounded-[18px] p-2.5 transition ${
        chosen ? "bg-[#1b2a3a]" : "bg-[#17171d]"
      } ${earned ? "" : "opacity-70"}`}
    >
      <span className="flex-none">
        <BadgeDetailPopover badge={badge} />
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left"
      >
        <span className="flex items-center gap-1.5">
          <strong className="truncate text-[0.95rem]">{badge.title}</strong>
          <span className="flex-none rounded-full bg-black/35 px-1.5 py-0.5 text-[0.58rem] font-extrabold uppercase text-[var(--muted)]">
            {rarityLabel(badge.rarity)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-[var(--muted)]">
          {earned ? badge.description : badge.qualification}
        </span>
        {!earned && target ? (
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/10">
            <span
              className="block h-full rounded-full bg-[var(--primary)]"
              style={{ width: `${Math.min(100, Math.round(((progress ?? 0) / target) * 100))}%` }}
            />
          </span>
        ) : null}
      </button>
      {earned ? (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={chosen}
          aria-label={chosen ? `Remove ${badge.title}` : `Wear ${badge.title}`}
          className="grid size-8 flex-none place-items-center rounded-full border transition"
          style={
            chosen
              ? { borderColor: "var(--primary)", background: "var(--primary)", color: "#fff" }
              : { borderColor: "rgba(255,255,255,.2)" }
          }
        >
          {chosen ? <Check size={16} /> : <Crown size={15} className="text-[var(--muted)]" />}
        </button>
      ) : (
        <span className="flex-none text-right text-[11px] font-bold text-[var(--dim)]">
          <Lock size={14} className="mx-auto" />
          {target ? `${progress ?? 0}/${target}` : "granted"}
        </span>
      )}
    </div>
  );
}
