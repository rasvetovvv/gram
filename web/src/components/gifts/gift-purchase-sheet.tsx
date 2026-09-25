"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Gift as GiftIcon, Star, User as UserIcon, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { GiftModel, GiftPurchaseResult } from "@/lib/types";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";
import { TopUpButton } from "../stars/top-up-button";
import { UserAvatar } from "../user-avatar";
import { GiftCatalogBrowser } from "./gift-catalog-browser";
import { GiftImage, giftArtProps } from "./gift-image";
import { GiftDesignPanel } from "./gift-design-panel";
import { GiftCelebration } from "./gift-upgrade";

type View =
  | { kind: "catalog" }
  | { kind: "design"; slug: string }
  | { kind: "done"; result: GiftPurchaseResult };

/**
 * Buying a gift, for someone else or for yourself.
 *
 * The reference only ever gifts outward, which leaves a collector unable to buy a limited
 * design at all unless a friend agrees to hold it. "For myself" is therefore a first-class
 * destination here, not a fallback for a missing recipient: the same catalogue, the same
 * limited editions, minted straight into your own collection and already unwrapped.
 */
export function GiftPurchaseSheet({
  recipient,
  open,
  onOpenChange
}: {
  recipient?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [mode, setMode] = useState<"self" | "other">(recipient ? "other" : "self");
  const [target, setTarget] = useState(recipient ?? "");
  const [view, setView] = useState<View>({ kind: "catalog" });

  const me = useQuery({ queryKey: ["me"], queryFn: api.currentUser, enabled: open });
  const handle = mode === "other" ? target.trim().replace(/^@+/, "").toLowerCase() : "";
  const profile = useQuery({
    queryKey: ["profile", handle],
    queryFn: () => api.profile(handle),
    enabled: open && handle.length >= 3
  });

  const purchase = useMutation({
    mutationFn: ({
      slug,
      message,
      hideMyName,
      quantity
    }: {
      slug: string;
      message: string;
      hideMyName: boolean;
      quantity: number;
    }) =>
      api.purchaseGift(slug, {
        toUsername: mode === "other" ? handle : undefined,
        message: mode === "other" ? message : undefined,
        hideMyName: mode === "other" ? hideMyName : false,
        quantity
      }),
    onSuccess: async (result) => {
      setView({ kind: "done", result });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gift-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["gift-design"] }),
        queryClient.invalidateQueries({ queryKey: ["gift-market"] }),
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["stars-wallet"] }),
        handle ? queryClient.invalidateQueries({ queryKey: ["profile", handle] }) : Promise.resolve()
      ]);
      const first = result.gifts[0];
      const run = result.gifts.length;
      notify(
        `"${first.name}"${run > 1 ? ` ×${run}` : ""} ${mode === "other" ? "sent" : "is yours"}`,
        {
          variant: "success",
          detail:
            mode === "other"
              ? `Recipient: @${handle}`
              : run > 1
                ? `${result.spent_stars} ★ spent`
                : `Issue #${first.serial_number}`
        }
      );
    },
    onError: (error: Error) => notify("Gift not purchased", { variant: "error", detail: error.message })
  });

  const balance = me.data?.stars_balance ?? 0;
  const recipientName = profile.data?.display_name ?? (handle ? `@${handle}` : null);
  const ready = mode === "self" || Boolean(profile.data);

  function close() {
    onOpenChange(false);
    setView({ kind: "catalog" });
    purchase.reset();
  }

  function pick(model: GiftModel) {
    purchase.reset();
    setView({ kind: "design", slug: model.slug });
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Buy a gift"
      description={recipientName ? `A gift for ${recipientName}` : "A gift for your own collection"}
    >
      {view.kind === "design" ? (
        <GiftDesignPanel
          slug={view.slug}
          recipientUsername={mode === "other" ? handle : null}
          recipientName={mode === "other" ? recipientName : null}
          recipientAvatar={profile.data?.avatar_url}
          balance={balance}
          allowMessage={mode === "other"}
          actionLabel={mode === "other" ? "Send" : "Buy for myself"}
          submitting={purchase.isPending}
          errorMessage={
            purchase.error?.message ??
            (mode === "other" && !profile.data ? "Choose a recipient in the catalogue" : null)
          }
          onBack={() => setView({ kind: "catalog" })}
          onSubmit={({ message, hideMyName, quantity }) =>
            purchase.mutate({ slug: view.slug, message, hideMyName, quantity })
          }
        />
      ) : view.kind === "done" ? (
        <Receipt
          result={view.result}
          recipient={mode === "other" ? recipientName : null}
          onMore={() => {
            purchase.reset();
            setView({ kind: "catalog" });
          }}
          onClose={close}
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={close}
              className="icon-button !size-9 bg-[#1a1a1f] text-white"
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <Link
              href="/stars"
              onClick={close}
              className="flex min-h-9 items-center gap-1.5 rounded-full bg-[#1a1a1f] px-3 text-sm font-extrabold text-[var(--stars)]"
            >
              <Star size={16} fill="currentColor" />
              {balance}
            </Link>
            {/* The wallet can be topped up without leaving the purchase: the payment is a sheet
                over this one, and what was already chosen stays chosen. */}
            <TopUpButton
              label="Top up"
              className="flex min-h-9 items-center gap-1.5 rounded-full border-0 bg-[#1a1a1f] px-3 text-sm font-bold text-[var(--ink)]"
            />
          </div>

          <div className="mt-2 flex items-center gap-3">
            {mode === "other" && profile.data ? (
              <UserAvatar
                src={profile.data.avatar_url}
                name={profile.data.display_name}
                size={64}
                ringColor="transparent"
              />
            ) : (
              <span className="grid size-16 flex-none place-items-center rounded-full bg-[#1a1a1f] text-[var(--stars)]">
                {mode === "self" ? <GiftIcon size={28} /> : <UserIcon size={28} />}
              </span>
            )}
            <div className="min-w-0">
              <p className="mb-0 text-xl font-extrabold leading-tight tracking-[-0.02em]">
                Buy a gift
              </p>
              <p className="mb-0 mt-0.5 truncate text-[15px] text-[var(--muted)]">
                {mode === "self" ? "for your collection" : recipientName ? `for ${recipientName}` : "choose a recipient"}
              </p>
            </div>
          </div>

          <RecipientSwitch
            mode={mode}
            setMode={setMode}
            target={target}
            setTarget={setTarget}
            resolved={Boolean(profile.data)}
            searching={profile.isFetching}
            unknown={handle.length >= 3 && !profile.isFetching && !profile.data}
          />

          <GiftCatalogBrowser
            balance={balance}
            pendingSlug={purchase.isPending ? purchase.variables?.slug : null}
            onPick={pick}
          />
          {!ready ? (
            <p className="mb-0 mt-3 rounded-[16px] bg-[#1a1a1f] p-3 text-sm text-[var(--muted)]">
              Choose a recipient above or switch to &quot;For myself&quot;.
            </p>
          ) : null}
        </>
      )}
    </BottomSheet>
  );
}

/** "For myself" or "For someone" — the choice the reference never offered. */
function RecipientSwitch({
  mode,
  setMode,
  target,
  setTarget,
  resolved,
  searching,
  unknown
}: {
  mode: "self" | "other";
  setMode: (mode: "self" | "other") => void;
  target: string;
  setTarget: (value: string) => void;
  resolved: boolean;
  searching: boolean;
  unknown: boolean;
}) {
  return (
    <fieldset className="mt-4 border-0 p-0">
      <legend className="mb-2 text-[13px] font-semibold uppercase tracking-[.06em] text-[var(--faint)]">
        Recipient
      </legend>
      <div className="segmented-control">
        <button type="button" data-active={mode === "self"} onClick={() => setMode("self")}>
          For myself
        </button>
        <button type="button" data-active={mode === "other"} onClick={() => setMode("other")}>
          For someone
        </button>
      </div>
      {mode === "other" ? (
        <>
          <label className="mt-2 flex min-h-11 items-center gap-2 rounded-[16px] bg-[#141419] px-3">
            <span className="text-[var(--link)]">@</span>
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="username"
              autoComplete="off"
              aria-label="Recipient username"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--dim)]"
            />
            {resolved ? <Check size={17} className="flex-none text-[var(--online)]" /> : null}
          </label>
          <p className="mb-0 mt-1.5 min-h-4 px-1 text-[12px]">
            {searching ? (
              <span className="text-[var(--muted)]">Searching for the account…</span>
            ) : unknown ? (
              <span className="text-[var(--danger)]">No such account</span>
            ) : null}
          </p>
        </>
      ) : null}
    </fieldset>
  );
}

/** The purchase lands as a celebration, because a mint is the moment the item exists. */
function Receipt({
  result,
  recipient,
  onMore,
  onClose
}: {
  result: GiftPurchaseResult;
  recipient?: string | null;
  onMore: () => void;
  onClose: () => void;
}) {
  const [lead, ...rest] = result.gifts;
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <GiftCelebration gift={lead} size={200} />
      <strong className="mt-4 block text-2xl font-extrabold tracking-[-0.02em]">
        {lead.name} #{lead.serial_number}
        {rest.length ? ` and ${rest.length} more` : ""}
      </strong>
      <p className="mb-0 mt-1 text-[15px] text-[var(--muted)]">
        {recipient ? `Sent to ${recipient}` : "Added to your collection"}
      </p>
      {/* A run rolled its own model and backdrop per serial, so the rest are worth showing. */}
      {rest.length ? (
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {rest.map((item) => (
            <span key={item.id} className="flex flex-col items-center gap-1">
              <GiftImage {...giftArtProps(item)} size={44} rounded="rounded-[13px]" />
              <span className="text-[10px] text-[var(--faint)]">#{item.serial_number}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-[12px] font-semibold">
          {[lead.model, lead.backdrop, lead.symbol].filter(Boolean).map((trait) => (
            <span
              key={trait}
              className="rounded-full bg-[#1a1a1f] px-2.5 py-1 text-[var(--identity)]"
            >
              {trait}
            </span>
          ))}
        </div>
      )}
      <p className="mb-0 mt-2 text-[13px] text-[var(--stars)]">
        {result.spent_stars} ★ spent · logged in history
      </p>
      <div className="mt-4 flex w-full gap-2">
        <button type="button" className="quiet-button flex-1" onClick={onMore}>
          Another gift
        </button>
        <button type="button" className="signal-button flex-1" onClick={onClose}>
          <Check size={17} />
          Done
        </button>
      </div>
    </div>
  );
}
