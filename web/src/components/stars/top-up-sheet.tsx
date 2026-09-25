"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, ExternalLink, Loader2, Send, Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { StarOrder } from "@/lib/types";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";
import styles from "./stars.module.css";

/*
 * Stars are bought with Telegram Stars, and the charge happens inside GRAM's own bot.
 *
 * The site never sees a card: it opens an order, hands over a deep link, and waits for the bot to
 * report the charge. So this sheet has two screens — the shop, and one order being paid — and the
 * second one polls rather than guesses, because the money arrives out of band.
 */
function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function TopUpSheet({
  open,
  onOpenChange,
  onCredited
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once an order is paid, so the screen behind can refresh what it shows. */
  onCredited?: () => void;
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Top up balance"
      description="Payment goes through Telegram Stars in the GRAM bot"
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
      {/* Radix unmounts the content on close, so the flow resets by construction. */}
      <TopUpFlow onCredited={onCredited} onDone={() => onOpenChange(false)} />
    </BottomSheet>
  );
}

function TopUpFlow({
  onCredited,
  onDone
}: {
  onCredited?: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [orderId, setOrderId] = useState<string | null>(null);

  const packages = useQuery({ queryKey: ["star-packages"], queryFn: api.starPackages });
  // An unfinished order from an earlier visit: it is still payable, so it is offered rather than
  // buried under a new one.
  const recent = useQuery({ queryKey: ["star-orders"], queryFn: () => api.starOrders(5) });

  const create = useMutation({
    mutationFn: (slug: string) => api.createStarOrder(slug),
    onSuccess: (order) => {
      setOrderId(order.id);
      // Opened here, in the click's own task, so the browser does not read it as a popup.
      window.open(order.bot_url, "_blank", "noopener,noreferrer");
    },
    onError: (error: Error) =>
      notify("Couldn't open payment", { variant: "error", detail: error.message })
  });

  if (orderId) {
    return (
      <PendingOrder
        orderId={orderId}
        onBack={() => setOrderId(null)}
        onDone={onDone}
        onCredited={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["me"] }),
            queryClient.invalidateQueries({ queryKey: ["stars", "wallet"] }),
            queryClient.invalidateQueries({ queryKey: ["stars", "transactions"] }),
            queryClient.invalidateQueries({ queryKey: ["star-orders"] })
          ]);
          onCredited?.();
        }}
      />
    );
  }

  const openOrder = (recent.data ?? []).find((order) => order.status === "pending");

  return (
    <>
      <div className={styles.sheetHeading}>
        <p>Choose a package</p>
      </div>

      {openOrder ? (
        <button
          type="button"
          className={styles.optionRow}
          onClick={() => setOrderId(openOrder.id)}
        >
          <span className={styles.methodChip}>
            <Loader2 size={19} className="animate-spin" />
          </span>
          <span className={styles.optionLabel}>
            Unfinished payment
            <span className={styles.optionMeta}>
              {formatNumber(openOrder.stars)} ★ for {openOrder.price_xtr} Telegram Stars
            </span>
          </span>
          <span className={styles.optionTrail}>
            <ExternalLink size={17} />
          </span>
        </button>
      ) : null}

      <div className={styles.optionList}>
        {packages.isLoading ? (
          <p className={styles.sheetNote}>Loading packages…</p>
        ) : packages.isError ? (
          <p className={styles.formError} role="alert">
            {packages.error.message}
          </p>
        ) : (
          (packages.data ?? []).map((item) => (
            <button
              key={item.slug}
              type="button"
              className={styles.optionRow}
              disabled={create.isPending}
              onClick={() => create.mutate(item.slug)}
            >
              <Star size={26} fill="currentColor" strokeWidth={1.4} />
              <span className={styles.optionLabel}>
                {formatNumber(item.stars)} stars
                <span className={styles.optionMeta}>
                  {item.bonus_percent > 0
                    ? `${item.per_xtr} ★ per 1 Telegram Star · +${item.bonus_percent}% bonus`
                    : `${item.per_xtr} ★ per 1 Telegram Star`}
                </span>
              </span>
              <span className={styles.optionTrail}>
                <strong>{item.price_xtr}</strong>
                <Send size={14} />
              </span>
            </button>
          ))
        )}
      </div>

      <p className={styles.sheetNote}>
        Payment goes through Telegram Stars inside the GRAM bot. After paying, stars are credited
        automatically — no card or external payment services involved.
      </p>
    </>
  );
}

/**
 * One order being paid.
 *
 * The charge happens in Telegram, so nothing here can know it has landed: the order is polled
 * while the sheet is open, and the screen changes only when the server says the money arrived.
 */
function PendingOrder({
  orderId,
  onBack,
  onDone,
  onCredited
}: {
  orderId: string;
  onBack: () => void;
  onDone: () => void;
  onCredited: () => Promise<void>;
}) {
  const { notify } = useToast();
  // The credit is a one-off event, but the poll keeps answering "paid" — a ref remembers that the
  // caches were already refreshed without turning it into render state.
  const settled = useRef(false);
  const order = useQuery({
    queryKey: ["star-order", orderId],
    queryFn: () => api.starOrder(orderId),
    // Paid orders stop being news; anything still open is checked every few seconds.
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== "pending" ? false : 3000
  });

  const cancel = useMutation({
    mutationFn: () => api.cancelStarOrder(orderId),
    onSuccess: () => {
      notify("Order cancelled", { variant: "success", detail: "The link will no longer open payment" });
      onBack();
    },
    onError: (error: Error) =>
      notify("Couldn't cancel", { variant: "error", detail: error.message })
  });

  const current: StarOrder | undefined = order.data;
  const status = current?.status;
  useEffect(() => {
    if (status !== "paid" || settled.current) return;
    settled.current = true;
    void onCredited();
  }, [onCredited, status]);

  if (!current) {
    return <p className={styles.sheetNote}>Opening order…</p>;
  }

  if (current.status === "paid") {
    return (
      <>
        <div className={styles.sheetHeading}>
          <p>Paid</p>
        </div>
        <div className={styles.optionList}>
          <span className={styles.optionRow}>
            <span className={styles.methodChip}>
              <Check size={19} />
            </span>
            <span className={styles.optionLabel}>
              {formatNumber(current.stars)} ★ credited
              <span className={styles.optionMeta}>
                Charged {current.price_xtr} Telegram Stars
              </span>
            </span>
          </span>
        </div>
        <button type="button" className={styles.actionPrimary} onClick={onDone}>
          Done
        </button>
      </>
    );
  }

  if (current.status !== "pending") {
    return (
      <>
        <div className={styles.sheetHeading}>
          <p>Order closed</p>
          <button type="button" className={styles.sheetBack} onClick={onBack}>
            <ArrowLeft size={15} /> Packages
          </button>
        </div>
        <p className={styles.sheetNote}>
          {current.status === "expired"
            ? "The payment link expired — pick a package again, it only takes a second."
            : "This order was cancelled. Pick a package again to pay."}
        </p>
      </>
    );
  }

  return (
    <>
      <div className={styles.sheetHeading}>
        <p>Payment in Telegram</p>
        <button type="button" className={styles.sheetBack} onClick={onBack}>
          <ArrowLeft size={15} /> Packages
        </button>
      </div>

      <div className={styles.optionList}>
        <span className={styles.optionRow}>
          <Star size={26} fill="currentColor" strokeWidth={1.4} />
          <span className={styles.optionLabel}>
            {formatNumber(current.stars)} ★
            <span className={styles.optionMeta}>
              Price — {current.price_xtr} Telegram Stars
            </span>
          </span>
          <span className={styles.optionTrail}>
            <Loader2 size={17} className="animate-spin" />
          </span>
        </span>
      </div>

      <a
        className={styles.actionPrimary}
        href={current.bot_url}
        target="_blank"
        rel="noreferrer"
      >
        <ExternalLink size={17} />
        Open the bot and pay
      </a>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="quiet-button flex-1 !min-h-11"
          onClick={async () => {
            await navigator.clipboard.writeText(current.bot_url);
            notify("Link copied", { variant: "success" });
          }}
        >
          <Copy size={16} />
          Link
        </button>
        <button
          type="button"
          className="quiet-button flex-1 !min-h-11"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          Cancel order
        </button>
      </div>

      <p className={styles.sheetNote}>
        The bot will send an invoice for {current.price_xtr} Telegram Stars. Once payment goes through, the stars
        will appear here on their own — you can leave this window open.
      </p>
    </>
  );
}
