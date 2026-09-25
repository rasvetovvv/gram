"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Copy, Receipt, RotateCcw, Send, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { StarTransaction } from "@/lib/social-types";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";

/*
 * The receipt for one operation.
 *
 * Every line of the ledger can be opened, because "-500 ★" on its own is not an answer to what
 * happened. A Telegram Stars purchase gets more than the rest: it is the only kind that can be
 * handed back, so its receipt carries the charge id and the way to ask for a refund.
 */
const KIND_TITLES: Record<string, string> = {
  welcome: "Starting balance",
  top_up: "Top-up",
  stars_telegram: "Stars purchase via Telegram",
  stars_refund: "Payment refund",
  stars_refund_reversed: "Refund reversed",
  transfer_sent: "Transfer sent",
  transfer_received: "Transfer received",
  subscription: "Creator subscription",
  subscription_income: "Subscription income",
  premium_purchase: "GRAM Premium",
  gift_purchase: "Gift purchase",
  gift_sale: "Gift sale",
  username_purchase: "Username purchase",
  username_sale: "Username sale",
  username_offer_hold: "Username bid",
  username_offer_refund: "Bid refund",
  refund: "Refund"
};

const REFUND_STATUS: Record<string, string> = {
  pending: "The refund request is awaiting an admin's decision",
  approved: "Refund approved",
  declined: "Refund declined",
  failed: "The refund did not go through — the stars stayed on your balance"
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMoment(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function StarReceiptSheet({
  transaction,
  onClose
}: {
  transaction: StarTransaction | null;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      open={Boolean(transaction)}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Operation receipt"
      description="What happened, when, and for how much"
      headerRight={
        <button
          type="button"
          className="icon-button !size-8 text-[var(--muted)]"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      }
    >
      {transaction ? <Receipt2 transaction={transaction} onClose={onClose} /> : null}
    </BottomSheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-start gap-3 border-b border-[var(--line)] px-3 py-2 last:border-b-0">
      <span className="w-28 flex-none pt-0.5 text-[13px] text-[var(--muted)]">{label}</span>
      <span className="min-w-0 flex-1 break-words text-[14px] font-semibold">{children}</span>
    </div>
  );
}

function Receipt2({
  transaction,
  onClose
}: {
  transaction: StarTransaction;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);

  // A Telegram purchase points at its order, which is where the price, the charge and the refund
  // state live. Every other kind of line has everything it needs in the ledger row itself.
  const orderId = transaction.entity_type === "star_purchase" ? transaction.entity_id : null;
  const order = useQuery({
    queryKey: ["star-order", orderId],
    queryFn: () => api.starOrder(orderId!),
    enabled: Boolean(orderId)
  });

  const request = useMutation({
    mutationFn: () => api.requestStarRefund(orderId!, reason.trim()),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["star-order", orderId] }),
        queryClient.invalidateQueries({ queryKey: ["star-orders"] })
      ]);
      setAsking(false);
      setReason("");
      notify("Refund request sent", {
        variant: "success",
        detail: "An admin will reply in Telegram"
      });
    },
    onError: (error: Error) =>
      notify("Refund not submitted", { variant: "error", detail: error.message })
  });

  const title = KIND_TITLES[transaction.kind] ?? transaction.description;
  const incoming = transaction.amount >= 0;

  return (
    <>
      <div className="pb-1 pt-1 text-center">
        <span
          className="mx-auto grid size-12 place-items-center rounded-full"
          style={{
            background: incoming ? "rgba(0,199,112,.16)" : "rgba(255,255,255,.07)",
            color: incoming ? "var(--online)" : "var(--ink)"
          }}
        >
          <Receipt size={22} />
        </span>
        <p className="mb-0 mt-3 text-[22px] font-extrabold leading-tight">
          {incoming ? "+" : ""}
          {formatNumber(transaction.amount)} ★
        </p>
        <p className="mb-0 mt-1 text-[14px] text-[var(--muted)]">{title}</p>
      </div>

      <div className="mt-4 overflow-hidden rounded-[18px] bg-[#1a1a1f]">
        <Row label="Operation">{transaction.description}</Row>
        <Row label="When">{formatMoment(transaction.created_at)}</Row>
        <Row label="Balance after">{formatNumber(transaction.balance_after)} ★</Row>
        {transaction.counterparty ? (
          <Row label="Who">
            {transaction.counterparty.display_name} · @{transaction.counterparty.username}
          </Row>
        ) : null}
        {order.data ? (
          <>
            <Row label="Paid">
              {order.data.price_xtr} Telegram Stars
              <span className="ml-1.5 text-[12px] font-medium text-[var(--muted)]">
                for {formatNumber(order.data.stars)} ★
              </span>
            </Row>
            {order.data.paid_at ? (
              <Row label="Payment">{formatMoment(order.data.paid_at)}</Row>
            ) : null}
            {order.data.telegram_charge_id ? (
              <Row label="Payment number">
                <span className="font-mono text-[12px]">{order.data.telegram_charge_id}</span>
              </Row>
            ) : null}
            <Row label="Status">
              {order.data.status === "refunded" ? "Refunded" : "Paid"}
            </Row>
          </>
        ) : null}
        <Row label="Identifier">
          <span className="font-mono text-[12px]">{transaction.id}</span>
        </Row>
      </div>

      <button
        type="button"
        className="quiet-button mt-3 w-full"
        onClick={async () => {
          await navigator.clipboard.writeText(
            [
              `GRAM · ${title}`,
              `${incoming ? "+" : ""}${transaction.amount} ★`,
              formatMoment(transaction.created_at),
              order.data ? `Paid ${order.data.price_xtr} Telegram Stars` : null,
              order.data?.telegram_charge_id
                ? `Payment ${order.data.telegram_charge_id}`
                : null,
              `Operation ${transaction.id}`
            ]
              .filter(Boolean)
              .join("\n")
          );
          notify("Receipt copied", { variant: "success" });
        }}
      >
        <Copy size={16} />
        Copy receipt
      </button>

      {/* Only a Telegram payment can be handed back, so only its receipt says anything about it. */}
      {order.data ? (
        <section className="mt-4 rounded-[18px] bg-[#1a1a1f] p-3.5">
          <h3 className="m-0 flex items-center gap-2 text-[15px] font-bold">
            <RotateCcw size={16} className="text-[var(--stars)]" />
            Payment refund
          </h3>

          {order.data.refund ? (
            <p className="mb-0 mt-1.5 flex items-start gap-2 text-[13px] leading-5 text-[var(--muted)]">
              {order.data.refund.status === "pending" ? (
                <Clock size={15} className="mt-0.5 flex-none" />
              ) : order.data.refund.status === "approved" ? (
                <Check size={15} className="mt-0.5 flex-none text-[var(--online)]" />
              ) : (
                <X size={15} className="mt-0.5 flex-none text-[var(--danger)]" />
              )}
              <span>
                {REFUND_STATUS[order.data.refund.status] ?? order.data.refund.status}
                <span className="mt-0.5 block text-[12px] text-[var(--dim)]">
                  Reason: {order.data.refund.reason}
                </span>
                {order.data.refund.admin_note ? (
                  <span className="mt-0.5 block text-[12px] text-[var(--dim)]">
                    Admin reply: {order.data.refund.admin_note}
                  </span>
                ) : null}
              </span>
            </p>
          ) : null}

          {order.data.refundable ? (
            asking ? (
              <>
                <p className="mb-0 mt-1.5 text-[13px] leading-5 text-[var(--muted)]">
                  Describe what happened. The request will be reviewed by an admin in Telegram; once
                  approved, {order.data.price_xtr} Telegram Stars will be returned to you, and{" "}
                  {formatNumber(order.data.stars)} ★ will be deducted from your balance.
                </p>
                <textarea
                  autoFocus
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Refund reason"
                  aria-label="Refund reason"
                  className="mt-2.5 w-full resize-none rounded-[12px] border-0 bg-[#101014] p-3 text-[14px] outline-none placeholder:text-[var(--dim)]"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="quiet-button flex-1 !min-h-11"
                    onClick={() => setAsking(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="gold-button flex-1 !min-h-11"
                    disabled={request.isPending || reason.trim().length < 10}
                    onClick={() => request.mutate()}
                  >
                    <Send size={15} />
                    {request.isPending ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-0 mt-1.5 text-[13px] leading-5 text-[var(--muted)]">
                  A refund is possible within 14 days and only while the stars are unspent. The
                  decision is made by an admin.
                </p>
                <button
                  type="button"
                  className="quiet-button mt-2.5 w-full"
                  onClick={() => setAsking(true)}
                >
                  <RotateCcw size={16} />
                  Request a refund
                </button>
              </>
            )
          ) : order.data.refund_blocked_reason ? (
            <p className="mb-0 mt-1.5 text-[13px] leading-5 text-[var(--dim)]">
              {order.data.refund_blocked_reason}
            </p>
          ) : null}
        </section>
      ) : null}

      <button type="button" className="quiet-button mt-3 w-full" onClick={onClose}>
        Close
      </button>
    </>
  );
}
