"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Link as LinkIcon, Sparkles, Star } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/utils";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";
import { GiftBackdrop } from "./gift-art";
import { GiftDetailTrigger, type RichGift } from "./gift-gallery";
import { GiftUpgradeStage } from "./gift-upgrade";

/**
 * One collectible at an address of its own.
 *
 * A gift is a thing somebody owns, and showing it to a person who does not own it used to mean
 * describing it in words. This is the page a link leads to: the item on its own backdrop, its
 * traits, who holds it, and — for anybody signed in — the same sheet the collection opens, so
 * an owner can act on it from here too.
 */
export function GiftDetailView({ id }: { id: string }) {
  const { notify } = useToast();
  const query = useQuery({ queryKey: ["gift", id], queryFn: () => api.gift(id) });
  const gift = query.data as RichGift | undefined;

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    notify("Gift link copied", { variant: "success" });
  }

  return (
    <>
      <div className="mobile-topbar">
        <Link href="/" className="icon-button" aria-label="Back">
          <ArrowLeft size={21} />
        </Link>
        <span className="wordmark">GIFT</span>
        <button
          type="button"
          onClick={() => copyLink()}
          className="icon-button"
          aria-label="Copy link"
        >
          <LinkIcon size={19} />
        </button>
      </div>

      {query.isLoading ? (
        <div className="px-3 py-4 sm:px-5">
          <div className="skeleton h-[320px] rounded-[24px]" />
          <div className="skeleton mt-3 h-40 rounded-[20px]" />
        </div>
      ) : gift ? (
        <div className="px-3 pb-8 sm:px-5">
          {/* The backdrop is the card: one continuous surface, as the collectible rolled it. */}
          <GiftBackdrop
            design={gift.design_slug ?? gift.slug.replace(/-\d+$/, "")}
            pattern={gift.upgraded === false ? null : (gift.symbol ?? gift.pattern ?? null)}
            accent={gift.accent}
            backdropEdge={gift.backdrop_edge}
            patternColor={gift.pattern_color}
            className="flex flex-col items-center rounded-[24px] px-6 py-8 text-center"
          >
            <GiftUpgradeStage gift={gift} size={200} phase="revealed" bare />
            <h1 className="relative m-0 mt-4 text-[26px] font-extrabold leading-tight text-white">
              {gift.name} #{gift.serial_number}
            </h1>
            <p className="relative mb-0 mt-1 text-sm text-white/80">
              {gift.model ?? (gift.upgraded === false ? "Regular gift" : "Collectible")}
            </p>
            {gift.message ? (
              <p className="relative mb-0 mt-4 max-w-[36ch] rounded-[16px] bg-black/45 px-3.5 py-2 text-sm leading-5 text-white/90">
                &quot;{gift.message}&quot;
              </p>
            ) : null}
          </GiftBackdrop>

          <div className="mt-3 overflow-hidden rounded-[20px] bg-[#17171d] shadow-[inset_0_0_0_1px_var(--line)]">
            <Row label="Type">Collectible</Row>
            <Row label="Owner">
              {gift.owner_username ? (
                <Link
                  href={`/u/${gift.owner_username}`}
                  className="flex items-center gap-2 font-bold text-[var(--link)]"
                >
                  <UserAvatar
                    src={gift.owner?.avatar_url}
                    name={gift.owner?.display_name ?? gift.owner_username}
                    size={22}
                  />
                  @{gift.owner_username}
                </Link>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Model">
              {gift.model ?? "Original"}
              <Percent value={gift.model_rarity_percent} />
            </Row>
            <Row label="Symbol">
              {gift.symbol ?? "GRAM"}
              <Percent value={gift.symbol_rarity_percent} />
            </Row>
            <Row label="Background">
              {gift.backdrop ?? gift.background ?? "Midnight"}
              <Percent value={gift.background_rarity_percent} />
            </Row>
            <Row label="Availability">
              {gift.serial_number}/{gift.edition_size ?? gift.supply ?? "—"} issued
            </Row>
            <Row label="Value">
              <span className="flex items-center gap-1 font-bold text-[var(--stars)]">
                <Star size={13} fill="currentColor" />
                {gift.value_stars ?? 0}
              </span>
            </Row>
          </div>

          <p className="mt-3 text-center text-[13px] text-[var(--muted)]">
            {gift.sender ? `Gifted by @${gift.sender.username}` : "Issued by GRAM"}
            {gift.received_at ? ` · ${relativeTime(gift.received_at)}` : ""}
          </p>

          <GiftDetailTrigger
            gift={gift}
            className="signal-button mt-4 w-full justify-center border-0"
            label={`Open gift ${gift.name}`}
          >
            <Sparkles size={17} />
            All properties and actions
          </GiftDetailTrigger>
        </div>
      ) : (
        <div className="empty-state">
          <p className="font-bold text-white">Gift not found</p>
          <p className="text-sm">
            {query.error?.message === "Подарок не найден"
              ? "This link may have expired."
              : (query.error?.message ?? "This link leads nowhere.")}
          </p>
          <Link href="/" className="quiet-button mt-3">
            Go home
          </Link>
        </div>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-12 grid-cols-[92px_1fr] items-center gap-3 border-b border-[var(--line)] px-3 last:border-0 sm:grid-cols-[120px_1fr]">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">{children}</span>
    </div>
  );
}

function Percent({ value }: { value?: number | null }) {
  return value == null ? null : (
    <span className="rounded-full bg-[#1d3441] px-2 py-0.5 text-[0.65rem] font-bold text-[var(--link)]">
      {value}%
    </span>
  );
}
