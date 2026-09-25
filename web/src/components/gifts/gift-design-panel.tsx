"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Gift as GiftIcon, ShoppingBag, Star } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { GiftDesign, GiftMarketItem } from "@/lib/types";
import { GiftImage, giftArtProps } from "./gift-image";
import { useToast } from "../ui/toast";
import { UserAvatar } from "../user-avatar";

/**
 * One design, opened from the grid.
 *
 * The reference splits this into two genuinely different purchases and so does this: a fresh
 * mint whose model, pattern and backdrop are rolled at random, or somebody's existing copy at
 * a fixed price. They cost different amounts and yield different serials, so they are tabs,
 * not one button with a footnote.
 */
export function GiftDesignPanel({
  slug,
  recipientUsername,
  recipientName,
  recipientAvatar,
  balance,
  actionLabel,
  submitting,
  errorMessage,
  allowMessage = true,
  onBack,
  onSubmit
}: {
  slug: string;
  recipientUsername?: string | null;
  recipientName?: string | null;
  recipientAvatar?: string | null;
  balance: number;
  actionLabel: string;
  submitting: boolean;
  errorMessage?: string | null;
  allowMessage?: boolean;
  onBack: () => void;
  onSubmit: (input: { message: string; hideMyName: boolean; quantity: number }) => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [tab, setTab] = useState<"new" | "resale">("new");
  const [message, setMessage] = useState("");
  const [hideMyName, setHideMyName] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const design = useQuery({
    queryKey: ["gift-design", slug],
    queryFn: () => api.giftDesign(slug)
  });

  const buy = useMutation({
    mutationFn: (item: GiftMarketItem) => api.buyGift(item.gift_id),
    onSuccess: async (gift) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gift-design", slug] }),
        queryClient.invalidateQueries({ queryKey: ["gift-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["gift-market"] }),
        queryClient.invalidateQueries({ queryKey: ["gifts"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["stars-wallet"] })
      ]);
      notify(`"${gift.name}" #${gift.serial_number} is yours`, {
        variant: "success",
        detail: "Bought from another owner — the item is already in your collection"
      });
    },
    onError: (error: Error) => notify("Purchase failed", { variant: "error", detail: error.message })
  });

  const model = design.data;
  const listings = model?.resale ?? [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="icon-button !size-9 bg-[#1a1a1f] text-white"
          aria-label="Back to catalog"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="flex min-h-9 items-center gap-1.5 rounded-full bg-[#1a1a1f] px-3 text-sm font-extrabold text-[var(--stars)]">
          <Star size={16} fill="currentColor" />
          {balance}
        </span>
      </div>

      <div className="mt-3 text-center">
        <h2 className="mb-0 text-2xl font-extrabold leading-tight tracking-[-0.02em]">
          {model?.name ?? "Gift"}
        </h2>
        <p className="mb-0 mt-1 text-[15px] text-[var(--muted)]">
          {recipientName ? `for ${recipientName}` : "to your own collection"}
        </p>
      </div>

      <div className="mt-3 flex justify-center gap-2">
        {(
          [
            ["new", "Buy new"],
            ["resale", `Buy resale${listings.length ? ` · ${listings.length}` : ""}`]
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className="min-h-9 rounded-full border-0 px-4 text-[13px] font-bold transition-colors"
            style={
              tab === value
                ? { background: "#ffffff", color: "#000000" }
                : { background: "#1a1a1f", color: "var(--muted)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {design.isLoading || !model ? (
        <div className="skeleton mt-4 h-72 rounded-[24px]" />
      ) : tab === "new" ? (
        <NewMintTab
          design={model}
          balance={balance}
          allowMessage={allowMessage}
          message={message}
          setMessage={setMessage}
          hideMyName={hideMyName}
          setHideMyName={setHideMyName}
          recipientName={recipientName}
          recipientUsername={recipientUsername}
          recipientAvatar={recipientAvatar}
          actionLabel={actionLabel}
          submitting={submitting}
          errorMessage={errorMessage}
          quantity={quantity}
          setQuantity={setQuantity}
          onSubmit={() => onSubmit({ message, hideMyName, quantity })}
        />
      ) : (
        <ResaleTab
          listings={listings}
          balance={balance}
          pendingId={buy.isPending ? buy.variables?.gift_id : null}
          onBuy={(item) => buy.mutate(item)}
        />
      )}
    </div>
  );
}

function NewMintTab({
  design,
  balance,
  allowMessage,
  message,
  setMessage,
  hideMyName,
  setHideMyName,
  recipientName,
  recipientUsername,
  recipientAvatar,
  actionLabel,
  submitting,
  errorMessage,
  quantity,
  setQuantity,
  onSubmit
}: {
  design: GiftDesign;
  balance: number;
  allowMessage: boolean;
  message: string;
  setMessage: (value: string) => void;
  hideMyName: boolean;
  setHideMyName: (value: boolean) => void;
  recipientName?: string | null;
  recipientUsername?: string | null;
  recipientAvatar?: string | null;
  actionLabel: string;
  submitting: boolean;
  errorMessage?: string | null;
  quantity: number;
  setQuantity: (value: number) => void;
  onSubmit: () => void;
}) {
  const variants = design.models.length * design.backdrops.length * design.symbols.length;
  const runs = [1, 2, 3, 5, 10].filter((count) => count <= Math.max(1, design.remaining));
  const total = design.price_stars * quantity;
  return (
    <>
      {/* The design brings its own backdrop, so the card behind it stays neutral. */}
      <div className="mt-4 flex flex-col items-center overflow-hidden rounded-[24px] bg-[var(--surface)] px-4 pb-5 pt-6 text-center shadow-[inset_0_0_0_1px_var(--line)]">
        <GiftImage
          {...giftArtProps(design)}
          size={168}
          rounded="rounded-[22px]"
          animate="always"
          className="shadow-[0_18px_36px_rgba(0,0,0,.42)]"
        />
        <strong className="mt-3 block text-xl font-extrabold tracking-[-0.01em]">{design.name}</strong>
        <p className="mb-0 mt-1 max-w-[34ch] text-[13px] leading-5 text-[var(--muted)]">
          Model, pattern and backdrop are assigned at random
        </p>
        <p className="mb-0 mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--faint)]">
          {design.models.length} models · {design.backdrops.length} backdrops ·{" "}
          {design.symbols.length} patterns
        </p>
      </div>

      <div className="mt-3 overflow-hidden rounded-[18px] bg-[#141419]">
        <Row label="Edition">
          <strong>
            {design.minted.toLocaleString("ru-RU")} of {design.edition_size.toLocaleString("ru-RU")}
          </strong>
        </Row>
        <Row label="Remaining">
          <strong className={design.sold_out ? "text-[var(--danger)]" : "text-[var(--online)]"}>
            {design.sold_out ? "sold out" : design.remaining.toLocaleString("ru-RU")}
          </strong>
        </Row>
        <Row label="Combinations">
          <strong>{variants.toLocaleString("ru-RU")}</strong>
        </Row>
        {design.resale_count ? (
          <Row label="Resale">
            <strong className="text-[var(--stars)]">
              from {design.resale_floor_stars} ★ · {design.resale_count} available
            </strong>
          </Row>
        ) : null}
      </div>

      {recipientUsername ? (
        <div className="mt-3 flex items-center gap-2.5 rounded-[16px] bg-[#141419] p-2.5">
          <UserAvatar
            src={recipientAvatar ?? undefined}
            name={recipientName ?? recipientUsername}
            size={34}
            ringColor="transparent"
          />
          <span className="min-w-0 flex-1 truncate text-[14px]">
            Recipient: <strong>{recipientName ?? `@${recipientUsername}`}</strong>
          </span>
        </div>
      ) : null}

      {runs.length > 1 ? (
        <fieldset className="mt-3 border-0 p-0">
          <legend className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--faint)]">
            How many
          </legend>
          <div className="flex gap-2">
            {runs.map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => setQuantity(count)}
                aria-pressed={quantity === count}
                className="min-h-9 flex-1 rounded-[14px] border-0 text-[14px] font-extrabold transition-colors"
                style={
                  quantity === count
                    ? { background: "#ffffff", color: "#000000" }
                    : { background: "#141419", color: "var(--muted)" }
                }
              >
                ×{count}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {allowMessage ? (
        <>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, 200))}
            rows={2}
            placeholder="Add a message (optional)"
            aria-label="Message for the gift"
            className="mt-3 w-full resize-none rounded-[16px] bg-[#141419] p-3 text-[15px] outline-none placeholder:text-[var(--dim)]"
          />
          <label className="mt-2 flex min-h-11 cursor-pointer items-center justify-between rounded-[16px] bg-[#141419] px-3 text-[15px]">
            Hide my name
            <input
              type="checkbox"
              checked={hideMyName}
              onChange={(event) => setHideMyName(event.target.checked)}
              className="size-5 accent-[var(--primary)]"
            />
          </label>
        </>
      ) : null}

      {errorMessage ? (
        <p
          className="mt-3 rounded-[16px] bg-[#2a1418] p-3 text-sm text-[var(--danger)]"
          aria-live="polite"
        >
          {errorMessage}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || design.sold_out || balance < total}
        className="signal-button mt-3 w-full disabled:opacity-55"
      >
        <GiftIcon size={18} />
        {submitting
          ? "Sending…"
          : `${actionLabel}${quantity > 1 ? ` ×${quantity}` : ""} · ${total} ★`}
      </button>
      {balance < total && !design.sold_out ? (
        <p className="mb-0 mt-2 text-center text-[13px] font-semibold text-[var(--stars)]">
          Not enough stars in your balance
        </p>
      ) : null}
    </>
  );
}

function ResaleTab({
  listings,
  balance,
  pendingId,
  onBuy
}: {
  listings: GiftMarketItem[];
  balance: number;
  pendingId?: string | null;
  onBuy: (item: GiftMarketItem) => void;
}) {
  if (!listings.length) {
    return (
      <div className="empty-state mt-4">
        <ShoppingBag className="mx-auto mb-3 text-[var(--muted)]" />
        <p className="font-bold text-white">No one is selling this gift</p>
        <p className="text-sm">You can buy a new one from the edition — on the adjacent tab.</p>
      </div>
    );
  }
  return (
    <ul className="m-0 mt-4 grid list-none gap-2 p-0">
      {listings.map((item) => (
        <li key={item.gift_id} className="flex items-center gap-3 rounded-[18px] bg-[#141419] p-2.5">
          <GiftImage {...giftArtProps(item)} size={46} rounded="rounded-[14px]" />
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-[14px]">
              #{item.serial_number.toLocaleString("ru-RU")} · {item.model ?? "—"}
            </strong>
            <span className="block truncate text-[12px] text-[var(--muted)]">
              {item.backdrop ?? "—"} · @{item.owner.username}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onBuy(item)}
            disabled={item.is_mine || balance < item.price_stars || pendingId === item.gift_id}
            className="flex min-h-9 flex-none items-center gap-1.5 rounded-full border-0 bg-[var(--stars)] px-3 text-[13px] font-extrabold text-black disabled:opacity-45"
          >
            {pendingId === item.gift_id ? (
              "…"
            ) : item.is_mine ? (
              <>
                <Check size={14} />
                yours
              </>
            ) : (
              <>
                <Star size={13} fill="currentColor" />
                {item.price_stars}
              </>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-[var(--line)] px-3 text-[14px] last:border-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="flex min-w-0 items-center gap-2">{children}</span>
    </div>
  );
}
