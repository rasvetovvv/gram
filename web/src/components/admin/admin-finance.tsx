"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  BadgeCheck,
  Check,
  Clock,
  Megaphone,
  RotateCcw,
  Send,
  Star,
  X
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { AdminLedgerEntry, AdminPayout, AdminRefund, AdminStarOrder } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { useToast } from "../ui/toast";

/*
 * The money half of the panel.
 *
 * Two of these are queues rather than logs: a withdrawal and a refund each wait for a person to
 * answer, and until now the only place to answer was the bot's buttons in Telegram. Both answers
 * live here too, and next to them the two logs that explain any balance on the site — what came
 * in through Telegram, and every line of every wallet.
 */
const CHIP =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border-0 px-3 text-[13px] font-semibold transition active:scale-95";
const FIELD =
  "min-h-10 w-full rounded-[12px] border-0 bg-[var(--surface-raised)] px-3 text-[14px] outline-none placeholder:text-[var(--dim)]";

const PAYOUT_STATUS: Record<string, string> = {
  pending: "awaiting decision",
  approved: "approved — send in Telegram",
  paid: "sent",
  declined: "declined",
  failed: "failed — stars returned",
  cancelled: "cancelled by the user"
};

const REFUND_STATUS: Record<string, string> = {
  pending: "awaiting decision",
  approved: "approved",
  declined: "declined",
  failed: "failed — stars returned"
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function PayoutCard({ payout }: { payout: AdminPayout }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [note, setNote] = useState("");
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-actions"] })
    ]);
  const act = useMutation({
    mutationFn: (what: "approve" | "decline" | "paid" | "failed") =>
      what === "approve"
        ? api.adminDecidePayout(payout.id, true, note)
        : what === "decline"
          ? api.adminDecidePayout(payout.id, false, note)
          : what === "paid"
            ? api.adminPayoutPaid(payout.id, note)
            : api.adminPayoutFailed(payout.id, note),
    onSuccess: async (updated, what) => {
      await refresh();
      setNote("");
      notify(
        what === "approve"
          ? "Payout approved"
          : what === "decline"
            ? "Payout declined"
            : what === "paid"
              ? "Marked as sent"
              : "Payout failed — stars returned",
        {
          variant: what === "approve" || what === "paid" ? "success" : "error",
          detail: `@${updated.user.username} · ${money(updated.stars)} ★ / ${updated.price_xtr} XTR`
        }
      );
    },
    onError: (error: Error) => notify("Something went wrong", { variant: "error", detail: error.message })
  });

  const target = payout.telegram_username
    ? `@${payout.telegram_username}`
    : payout.telegram_user_id
      ? `Telegram id ${payout.telegram_user_id}`
      : "no address provided";

  return (
    <li className="border-b border-[var(--line)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="rounded-full bg-[rgba(255,183,3,.14)] px-2 py-0.5 font-bold text-[var(--stars)]">
          {money(payout.stars)} ★ → {payout.price_xtr} XTR
        </span>
        <Link href={`/u/${payout.user.username}`} className="font-bold text-[var(--link)]">
          @{payout.user.username}
        </Link>
        <span className="text-[var(--dim)]">balance {money(payout.balance)} ★</span>
        <span className="ml-auto text-[var(--dim)]">{relativeTime(payout.requested_at)}</span>
      </div>
      <p className="mb-0 mt-1.5 text-[13px] leading-5 text-[var(--muted)]">
        To: <strong className="font-semibold text-[var(--ink)]">{target}</strong> ·{" "}
        {PAYOUT_STATUS[payout.status] ?? payout.status}
        {payout.decided_by ? ` · decided by @${payout.decided_by.username}` : ""}
        {payout.admin_note ? ` · «${payout.admin_note}»` : ""}
      </p>
      {payout.automatic && (payout.status === "pending" || payout.status === "approved") ? (
        <p className="mb-0 mt-1 text-[12px] font-semibold leading-4 text-[var(--online)]">
          Goes out automatically: this account has a payment for exactly {payout.price_xtr} XTR, and the bot will refund it —
          the Telegram Stars go to the same person, so there’s nothing to send by hand.
        </p>
      ) : null}

      {payout.status === "pending" || payout.status === "approved" ? (
        <div className="mt-2 space-y-2">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Comment — the requester will see it"
            aria-label="Comment on the decision"
            className={FIELD}
          />
          <div className="flex flex-wrap gap-1.5">
            {payout.status === "pending" ? (
              <>
                <button
                  type="button"
                  disabled={act.isPending}
                  onClick={() => act.mutate("approve")}
                  className={`${CHIP} bg-[var(--online)] text-black`}
                >
                  <Check size={14} />
                  Approve
                </button>
                <button
                  type="button"
                  disabled={act.isPending}
                  onClick={() => act.mutate("decline")}
                  className={`${CHIP} bg-[var(--danger)] text-white`}
                >
                  <X size={14} />
                  Decline
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={act.isPending}
                  onClick={() => act.mutate("paid")}
                  className={`${CHIP} bg-[var(--online)] text-black`}
                >
                  <Send size={14} />
                  Sent
                </button>
                <button
                  type="button"
                  disabled={act.isPending}
                  onClick={() => act.mutate("failed")}
                  className={`${CHIP} bg-[var(--danger)] text-white`}
                >
                  <RotateCcw size={14} />
                  Failed
                </button>
              </>
            )}
          </div>
          {payout.status === "approved" ? (
            <p className="mb-0 text-[12px] leading-4 text-[var(--dim)]">
              {payout.automatic
                ? `The bot will refund the ${payout.price_xtr} XTR payment on its own at the next check — these buttons are only needed if it can’t.`
                : `Telegram can’t send stars via the API — transfer ${payout.price_xtr} Telegram Stars to ${target} by hand and mark it here. The bot will send this request with the same two buttons.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** A shared filter row: the same chips over any status list. */
function StatusChips<T extends string>({
  value,
  onChange,
  options
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly { key: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5 px-4 py-3">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={`${CHIP} ${
            value === option.key
              ? "bg-[var(--primary)] text-white"
              : "bg-white/[0.07] text-[var(--muted)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const PAYOUT_FILTERS = [
  { key: "pending", label: "Awaiting decision" },
  { key: "open", label: "In progress" },
  { key: "paid", label: "Sent" },
  { key: "all", label: "All" }
] as const;

export function AdminPayoutsPanel() {
  const [scope, setScope] = useState<(typeof PAYOUT_FILTERS)[number]["key"]>("pending");
  const payouts = useQuery({
    queryKey: ["admin-payouts", scope],
    queryFn: () => api.adminPayouts(scope),
    refetchInterval: 30_000
  });
  return (
    <section>
      <header className="flex items-center gap-2 px-4 pt-4">
        <span className="grid size-7 place-items-center rounded-full bg-[rgba(255,183,3,.16)] text-[var(--stars)]">
          <ArrowDownToLine size={15} />
        </span>
        <h2 className="m-0 text-[16px] font-extrabold">Star withdrawals</h2>
      </header>
      <StatusChips value={scope} onChange={setScope} options={PAYOUT_FILTERS} />
      {payouts.data?.length ? (
        <ul className="m-0 list-none p-0">
          {payouts.data.map((payout) => (
            <PayoutCard key={payout.id} payout={payout} />
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-4 pt-1 text-[14px] text-[var(--muted)]">
          {payouts.isLoading ? "Loading…" : "No requests"}
        </p>
      )}
    </section>
  );
}

function RefundCard({ refund }: { refund: AdminRefund }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (approved: boolean) => api.adminDecideRefund(refund.id, approved, note),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-refunds"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-actions"] })
      ]);
      setNote("");
      notify("Decision saved", { variant: "success", detail: result.detail });
    },
    onError: (error: Error) => notify("Something went wrong", { variant: "error", detail: error.message })
  });

  return (
    <li className="border-b border-[var(--line)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="rounded-full bg-white/[0.07] px-2 py-0.5 font-semibold text-[var(--muted)]">
          {money(refund.stars)} ★ / {refund.price_xtr} XTR
        </span>
        <Link href={`/u/${refund.user.username}`} className="font-bold text-[var(--link)]">
          @{refund.user.username}
        </Link>
        <span className="text-[var(--dim)]">balance {money(refund.balance)} ★</span>
        <span className="ml-auto text-[var(--dim)]">{relativeTime(refund.requested_at)}</span>
      </div>
      <p className="mb-0 mt-1.5 border-l-2 border-[var(--line-strong)] pl-2.5 text-[14px] leading-5 text-[var(--muted)]">
        {refund.reason}
      </p>
      <p className="mb-0 mt-1.5 text-[12px] text-[var(--dim)]">
        {REFUND_STATUS[refund.status] ?? refund.status}
        {refund.telegram_charge_id ? ` · payment ${refund.telegram_charge_id}` : " · no payment"}
        {refund.telegram_done_at ? " · Telegram refunded" : ""}
        {refund.admin_note ? ` · «${refund.admin_note}»` : ""}
      </p>

      {refund.status === "pending" ? (
        refund.blocked_reason ? (
          <p className="mb-0 mt-2 text-[13px] font-semibold text-[var(--danger)]">
            {refund.blocked_reason}
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Reply to the buyer"
              aria-label="Reply to the buyer"
              className={FIELD}
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate(true)}
                className={`${CHIP} bg-[var(--online)] text-black`}
              >
                <Check size={14} />
                Refund {refund.price_xtr} XTR
              </button>
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate(false)}
                className={`${CHIP} bg-[var(--danger)] text-white`}
              >
                <X size={14} />
                Decline
              </button>
            </div>
          </div>
        )
      ) : null}
    </li>
  );
}

const REFUND_FILTERS = [
  { key: "pending", label: "Awaiting decision" },
  { key: "approved", label: "Approved" },
  { key: "declined", label: "Declined" },
  { key: "all", label: "All" }
] as const;

export function AdminRefundsPanel() {
  const [scope, setScope] = useState<(typeof REFUND_FILTERS)[number]["key"]>("pending");
  const refunds = useQuery({
    queryKey: ["admin-refunds", scope],
    queryFn: () => api.adminRefunds(scope),
    refetchInterval: 30_000
  });
  return (
    <section className="border-t border-[var(--line-structural)]">
      <header className="flex items-center gap-2 px-4 pt-4">
        <span className="grid size-7 place-items-center rounded-full bg-[rgba(0,199,112,.16)] text-[var(--online)]">
          <RotateCcw size={15} />
        </span>
        <h2 className="m-0 text-[16px] font-extrabold">Payment refunds</h2>
      </header>
      <p className="mb-0 px-4 pt-1 text-[12px] leading-4 text-[var(--dim)]">
        Approval deducts the stars here; the Telegram Stars themselves are refunded by the bot at the next check.
      </p>
      <StatusChips value={scope} onChange={setScope} options={REFUND_FILTERS} />
      {refunds.data?.length ? (
        <ul className="m-0 list-none p-0">
          {refunds.data.map((refund) => (
            <RefundCard key={refund.id} refund={refund} />
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-4 pt-1 text-[14px] text-[var(--muted)]">
          {refunds.isLoading ? "Loading…" : "No requests"}
        </p>
      )}
    </section>
  );
}

const ORDER_FILTERS = [
  { key: "paid", label: "Paid" },
  { key: "refunded", label: "Refunded" },
  { key: "pending", label: "Open" },
  { key: "all", label: "All" }
] as const;

function OrderRow({ order }: { order: AdminStarOrder }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--line)] px-4 py-2.5 text-[13px]">
      <Link href={`/u/${order.user.username}`} className="font-bold text-[var(--link)]">
        @{order.user.username}
      </Link>
      <span className="font-semibold text-[var(--stars)]">
        {money(order.stars)} ★ for {order.price_xtr} XTR
      </span>
      <span className="text-[var(--muted)]">{order.package_slug}</span>
      <span
        className={
          order.status === "paid"
            ? "text-[var(--online)]"
            : order.status === "refunded"
              ? "text-[var(--danger)]"
              : "text-[var(--dim)]"
        }
      >
        {order.status}
        {order.refund_status ? ` · refund ${order.refund_status}` : ""}
      </span>
      {order.telegram_charge_id ? (
        <span className="font-mono text-[11px] text-[var(--dim)]">
          {order.telegram_charge_id}
        </span>
      ) : null}
      <span className="ml-auto text-[var(--dim)]">
        {relativeTime(order.paid_at ?? order.created_at)}
      </span>
    </li>
  );
}

export function AdminOrdersPanel() {
  const [scope, setScope] = useState<(typeof ORDER_FILTERS)[number]["key"]>("paid");
  const [query, setQuery] = useState("");
  const orders = useQuery({
    queryKey: ["admin-star-orders", scope, query],
    queryFn: () => api.adminStarOrders({ status: scope, q: query })
  });
  return (
    <section className="border-t border-[var(--line-structural)]">
      <header className="flex items-center gap-2 px-4 pt-4">
        <span className="grid size-7 place-items-center rounded-full bg-[rgba(255,183,3,.16)] text-[var(--stars)]">
          <Star size={15} />
        </span>
        <h2 className="m-0 text-[16px] font-extrabold">Purchases via Telegram</h2>
      </header>
      <StatusChips value={scope} onChange={setScope} options={ORDER_FILTERS} />
      <div className="px-4 pb-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Username or payment ID"
          aria-label="Search purchases"
          className={FIELD}
        />
      </div>
      {orders.data?.length ? (
        <ul className="m-0 list-none p-0">
          {orders.data.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-4 text-[14px] text-[var(--muted)]">
          {orders.isLoading ? "Loading…" : "Nothing found"}
        </p>
      )}
    </section>
  );
}

const LEDGER_KINDS = [
  { key: "", label: "All activity" },
  { key: "stars_telegram", label: "Purchases" },
  { key: "payout_hold", label: "Withdrawal requests" },
  { key: "stars_refund", label: "Refunds" },
  { key: "gift_purchase", label: "Gifts" },
  { key: "transfer_sent", label: "Transfers" }
] as const;

function LedgerRow({ entry }: { entry: AdminLedgerEntry }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--line)] px-4 py-2.5 text-[13px]">
      <Link href={`/u/${entry.user.username}`} className="font-bold text-[var(--link)]">
        @{entry.user.username}
      </Link>
      <strong
        className="font-extrabold"
        style={{ color: entry.amount >= 0 ? "var(--online)" : "var(--ink)" }}
      >
        {entry.amount >= 0 ? "+" : ""}
        {money(entry.amount)} ★
      </strong>
      <span className="min-w-0 flex-1 truncate text-[var(--muted)]">{entry.description}</span>
      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-[var(--dim)]">
        {entry.kind}
      </span>
      <span className="text-[var(--dim)]">{relativeTime(entry.created_at)}</span>
    </li>
  );
}

export function AdminLedgerPanel() {
  const [kind, setKind] = useState<(typeof LEDGER_KINDS)[number]["key"]>("");
  const [username, setUsername] = useState("");
  const ledger = useQuery({
    queryKey: ["admin-ledger", kind, username],
    queryFn: () => api.adminLedger({ kind, username, limit: 80 })
  });
  return (
    <section className="border-t border-[var(--line-structural)]">
      <header className="flex items-center gap-2 px-4 pt-4">
        <span className="grid size-7 place-items-center rounded-full bg-white/[0.07] text-[var(--muted)]">
          <Clock size={15} />
        </span>
        <h2 className="m-0 text-[16px] font-extrabold">Star activity</h2>
      </header>
      <p className="mb-0 px-4 pt-1 text-[12px] leading-4 text-[var(--dim)]">
        Every line of every wallet: who, how much, and for what.
      </p>
      <StatusChips value={kind} onChange={setKind} options={LEDGER_KINDS} />
      <div className="px-4 pb-3">
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username — for example leon"
          aria-label="Filter by account"
          className={FIELD}
        />
      </div>
      {ledger.data?.length ? (
        <ul className="m-0 list-none p-0">
          {ledger.data.map((entry) => (
            <LedgerRow key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-4 text-[14px] text-[var(--muted)]">
          {ledger.isLoading ? "Loading…" : "Nothing found"}
        </p>
      )}
    </section>
  );
}

/** Everything money-shaped in one scroll: two queues, then the two logs behind them. */
export function AdminFinancePanel() {
  return (
    <div className="pb-6">
      <AdminPayoutsPanel />
      <AdminRefundsPanel />
      <AdminOrdersPanel />
      <AdminLedgerPanel />
    </div>
  );
}

const BROADCAST_SCOPES = [
  { key: "all", label: "Everyone" },
  { key: "active", label: "Active this month" },
  { key: "premium", label: "With Premium" },
  { key: "admins", label: "Administrators" }
] as const;

/**
 * An announcement, as a notification each.
 *
 * The one staff action that reaches everybody at once, so it says how many it reached and lands
 * in the journal with its own text — an announcement nobody can audit is a rumour.
 */
export function AdminBroadcastPanel() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [text, setText] = useState("");
  const [scope, setScope] = useState<(typeof BROADCAST_SCOPES)[number]["key"]>("all");
  const send = useMutation({
    mutationFn: () => api.adminBroadcast(text.trim(), scope),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-actions"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] })
      ]);
      setText("");
      notify("Announcement sent", { variant: "success", detail: result.detail });
    },
    onError: (error: Error) =>
      notify("Not sent", { variant: "error", detail: error.message })
  });
  return (
    <section className="px-4 py-4">
      <header className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-[var(--primary-dim)] text-[var(--primary-strong)]">
          <Megaphone size={15} />
        </span>
        <h2 className="m-0 text-[16px] font-extrabold">Announcement</h2>
      </header>
      <p className="mb-0 mt-1 text-[12px] leading-4 text-[var(--dim)]">
        Delivered as a notification. Banned accounts are skipped, and the send is recorded in the audit log.
      </p>
      <StatusChips value={scope} onChange={setScope} options={BROADCAST_SCOPES} />
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        maxLength={240}
        placeholder="What to announce"
        aria-label="Announcement text"
        className="w-full resize-none rounded-[12px] border-0 bg-[var(--surface-raised)] p-3 text-[14px] outline-none placeholder:text-[var(--dim)]"
      />
      <button
        type="button"
        disabled={send.isPending || text.trim().length < 3}
        onClick={() => send.mutate()}
        className={`${CHIP} mt-2 bg-[var(--primary)] text-white disabled:opacity-50`}
      >
        <BadgeCheck size={14} />
        {send.isPending ? "Sending…" : "Send"}
      </button>
    </section>
  );
}







