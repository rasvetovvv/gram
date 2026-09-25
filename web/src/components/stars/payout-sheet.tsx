"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, Check, Clock, Send, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { StarPayout } from "@/lib/types";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";

/*
 * Taking stars out into Telegram.
 *
 * The same rate as the shop, read backwards: twenty of ours for one of theirs, so 100 ★ leave as
 * the 5 Telegram Stars they cost. Two things are worth saying plainly here rather than hiding,
 * because both surprise people otherwise: the stars are held the moment the request is made — not
 * when it is granted — and the transfer itself is done by a person, since Telegram has no way for
 * a bot to send Stars to somebody. Everything that does not end in a transfer gives the stars back.
 */
const STARS_PER_XTR = 20;
const MIN_PAYOUT = 100;

const STATUS_TEXT: Record<StarPayout["status"], string> = {
  pending: "Awaiting an administrator’s decision",
  approved: "Approved — the stars will arrive in Telegram soon",
  paid: "Sent",
  declined: "Declined — the stars were returned to your balance",
  failed: "Failed — the stars were returned to your balance",
  cancelled: "Cancelled"
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatMoment(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

const PRESETS = [100, 500, 1000, 5000];

export function PayoutSheet({
  open,
  onOpenChange,
  balance,
  enabled = true
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: number;
  /**
   * Whether withdrawals are running at all.
   *
   * When they are not, the form is replaced by a plain sentence and the requests already made stay
   * listed — anything asked for before the door closed has to remain visible and cancellable.
   */
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [amount, setAmount] = useState(String(MIN_PAYOUT));
  const [handle, setHandle] = useState("");

  const payouts = useQuery({
    queryKey: ["star-payouts"],
    queryFn: api.starPayouts,
    enabled: open,
    refetchInterval: open ? 20_000 : false
  });

  /*
   * Which withdrawals can happen without a person.
   *
   * Telegram has no call that sends Stars to somebody, but it does have one that hands a charge
   * back — so a payout worth exactly what an old purchase cost can be carried out by returning
   * that purchase. These are the amounts for which that is true right now, and the sheet says so
   * before anybody waits for an admin.
   */
  const orders = useQuery({ queryKey: ["star-orders"], queryFn: () => api.starOrders(50), enabled: open });
  const instantXtr = new Set(
    (orders.data ?? [])
      .filter((order) => order.status === "paid" && !order.refund)
      .map((order) => order.price_xtr)
  );

  const stars = Number.parseInt(amount, 10) || 0;
  const xtr = Math.floor(stars / STARS_PER_XTR);
  // Every reason the request would be refused, said before it is sent.
  const problem =
    stars < MIN_PAYOUT
      ? `Minimum ${MIN_PAYOUT} ★`
      : stars % STARS_PER_XTR
        ? `Multiples of ${STARS_PER_XTR} ★ — that’s exactly 1 Telegram Star`
        : stars > balance
          ? `Only ${formatNumber(balance)} ★ on your balance`
          : null;

  const request = useMutation({
    mutationFn: () => api.requestStarPayout(stars, handle),
    onSuccess: async (payout) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["star-payouts"] }),
        queryClient.invalidateQueries({ queryKey: ["stars"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] })
      ]);
      notify("Withdrawal request submitted", {
        variant: "success",
        detail: `${formatNumber(payout.stars)} ★ → ${payout.price_xtr} Telegram Stars`
      });
    },
    onError: (error: Error) =>
      notify("Withdrawal not submitted", { variant: "error", detail: error.message })
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelStarPayout(id),
    onSuccess: async (payout) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["star-payouts"] }),
        queryClient.invalidateQueries({ queryKey: ["stars"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] })
      ]);
      notify("Request cancelled", {
        variant: "success",
        detail: `${formatNumber(payout.stars)} ★ returned to your balance`
      });
    },
    onError: (error: Error) =>
      notify("Couldn’t cancel", { variant: "error", detail: error.message })
  });

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Withdraw stars"
      description="Back to Telegram Stars at the same rate"
      headerRight={
        <button
          type="button"
          className="icon-button !size-8 text-[var(--muted)]"
          aria-label="Close"
          onClick={() => onOpenChange(false)}
        >
          <X size={18} />
        </button>
      }
    >
      <div className="pb-2">
        {enabled ? null : (
          <p className="mb-4 mt-0 rounded-[14px] bg-[#1a1a1f] px-3.5 py-3 text-[14px] leading-5">
            <strong className="block font-extrabold">Star withdrawals are temporarily unavailable</strong>
            <span className="mt-0.5 block text-[13px] text-[var(--dim)]">
              Top-ups, transfers, and purchases work as usual. Requests submitted earlier are below —
              you can still cancel them.
            </span>
          </p>
        )}
        {enabled ? (
          <>
        <label className="block text-[13px] font-semibold text-[var(--muted)]" htmlFor="payout-sum">
          How much to withdraw
        </label>
        <div className="mt-1.5 flex items-center gap-2 rounded-[14px] bg-[#101014] px-3">
          <input
            id="payout-sum"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/\D/g, "").slice(0, 7))}
            className="min-h-12 w-full border-0 bg-transparent text-[20px] font-extrabold outline-none"
          />
          <span className="text-[18px] font-bold text-[var(--stars)]">★</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setAmount(String(preset))}
              disabled={preset > balance}
              className="min-h-9 rounded-full border-0 bg-white/[0.07] px-3 text-[13px] font-semibold text-[var(--muted)] disabled:opacity-40"
            >
              {formatNumber(preset)} ★
            </button>
          ))}
          {balance >= MIN_PAYOUT ? (
            <button
              type="button"
              onClick={() => setAmount(String(balance - (balance % STARS_PER_XTR)))}
              className="min-h-9 rounded-full border-0 bg-white/[0.07] px-3 text-[13px] font-semibold text-[var(--muted)]"
            >
              All
            </button>
          ) : null}
        </div>

        <p className="mb-0 mt-3 rounded-[14px] bg-[#1a1a1f] px-3.5 py-2.5 text-[14px] leading-5">
          Arrives in Telegram:{" "}
          <strong className="font-extrabold text-[var(--stars)]">{xtr} Telegram Stars</strong>
          <span className="mt-0.5 block text-[12px] text-[var(--dim)]">
            The rate is the same as when buying: {STARS_PER_XTR} ★ = 1 Telegram Star.
          </span>
          {!problem && instantXtr.has(xtr) ? (
            <span className="mt-1 block text-[12px] font-semibold text-[var(--online)]">
              This amount goes out right after approval: you have a payment for exactly {xtr} Telegram
              Stars, and the bot will refund that very one.
            </span>
          ) : null}
        </p>

        <label
          className="mt-3 block text-[13px] font-semibold text-[var(--muted)]"
          htmlFor="payout-handle"
        >
          Where to send
        </label>
        <input
          id="payout-handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value.slice(0, 33))}
          placeholder="@username on Telegram"
          className="mt-1.5 min-h-12 w-full rounded-[14px] border-0 bg-[#101014] px-3 text-[15px] outline-none placeholder:text-[var(--dim)]"
        />
        <p className="mb-0 mt-1.5 text-[12px] leading-4 text-[var(--dim)]">
          If you’ve already bought stars through our bot, you can leave this empty — the withdrawal
          will go to the same Telegram account.
        </p>

        <button
          type="button"
          disabled={request.isPending || Boolean(problem)}
          onClick={() => request.mutate()}
          className="gold-button mt-3 w-full"
        >
          <ArrowDownToLine size={17} />
          {request.isPending ? "Submitting…" : problem ? problem : `Withdraw ${xtr} Telegram Stars`}
        </button>
        <p className="mb-0 mt-2 text-[12px] leading-4 text-[var(--dim)]">
          Stars are deducted immediately so they can’t be spent twice while the request is pending. An
          administrator makes the decision; if it’s declined or the transfer fails, they return to your balance.
        </p>
          </>
        ) : null}

        {payouts.data?.length ? (
          <section className="mt-4">
            <h3 className="m-0 text-[15px] font-bold">My requests</h3>
            <ul className="m-0 mt-2 list-none space-y-2 p-0">
              {payouts.data.map((payout) => (
                <li key={payout.id} className="rounded-[16px] bg-[#1a1a1f] p-3">
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-full bg-white/[0.06] text-[var(--muted)]">
                      {payout.status === "paid" ? (
                        <Check size={16} className="text-[var(--online)]" />
                      ) : payout.status === "pending" || payout.status === "approved" ? (
                        <Clock size={16} />
                      ) : (
                        <X size={16} className="text-[var(--danger)]" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <strong className="block text-[14px] font-bold">
                        {formatNumber(payout.stars)} ★ → {payout.price_xtr} Telegram Stars
                      </strong>
                      <span className="block text-[12px] text-[var(--dim)]">
                        {formatMoment(payout.requested_at)}
                        {payout.telegram_username ? ` · @${payout.telegram_username}` : ""}
                      </span>
                    </div>
                  </div>
                  <p className="mb-0 mt-1.5 text-[13px] leading-5 text-[var(--muted)]">
                    {STATUS_TEXT[payout.status]}
                    {payout.admin_note ? (
                      <span className="mt-0.5 block text-[12px] text-[var(--dim)]">
                        Administrator: {payout.admin_note}
                      </span>
                    ) : null}
                  </p>
                  {payout.cancellable ? (
                    <button
                      type="button"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(payout.id)}
                      className="quiet-button mt-2 w-full !min-h-10"
                    >
                      <Send size={14} />
                      Cancel request
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </BottomSheet>
  );
}
