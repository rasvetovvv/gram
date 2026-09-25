"use client";

import { useQuery } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import {
  AlertTriangle,
  ArrowDownToLine,
  Flag,
  Gavel,
  Gift,
  Megaphone,
  Scale,
  ShieldCheck,
  Users2,
  UsersRound
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { compactNumber } from "@/lib/utils";
import { AdminDesignsPanel } from "./admin-designs";
import { AdminBroadcastPanel, AdminFinancePanel } from "./admin-finance";
import { AdminUsersPanel } from "./admin-users";
import {
  AdminAuditPanel,
  AdminCommunitiesPanel,
  AdminLegalReportsPanel,
  AdminReportsPanel
} from "./admin-queues";

const TAB =
  "flex shrink-0 items-center gap-2 border-0 bg-transparent px-4 py-3 text-[15px] font-medium text-[var(--dim)] transition-colors hover:bg-white/5 data-[state=active]:font-bold data-[state=active]:text-white";

/** One number with its label — the panel's first screen is nothing but these. */
function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-[18px] bg-[var(--surface)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
      <strong className="block text-2xl font-extrabold leading-tight" style={tone ? { color: tone } : undefined}>
        {compactNumber(value)}
      </strong>
      <span className="mt-0.5 block text-[13px] text-[var(--muted)]">{label}</span>
    </div>
  );
}

export function AdminView() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: api.adminOverview,
    enabled: Boolean(me.data?.is_admin),
    refetchInterval: 60_000
  });

  if (me.isLoading) {
    return <div className="p-6 text-[var(--muted)]">Checking permissions…</div>;
  }
  // The server refuses every admin call anyway; this is so the refusal is readable rather than
  // a wall of failed requests.
  if (!me.data?.is_admin) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-white/[0.06] text-[var(--danger)]">
          <ShieldCheck size={26} />
        </span>
        <h1 className="mb-0 mt-4 text-xl font-extrabold">Administrators only</h1>
        <p className="mb-0 mt-2 text-[14px] leading-6 text-[var(--muted)]">
          The account @{me.data?.username} does not have administrator rights. Another administrator grants them —
          you cannot buy or enable them yourself.
        </p>
        <Link href="/" className="mt-5 inline-block text-[14px] font-semibold text-[var(--link)]">
          Back to feed
        </Link>
      </div>
    );
  }

  const stats = overview.data;
  return (
    <div className="pb-10">
      <header className="sticky top-0 z-30 flex min-h-[56px] items-center gap-3 border-b border-[var(--line-structural)] bg-[var(--header)] px-4 backdrop-blur-xl">
        <span className="grid size-8 place-items-center rounded-full bg-[var(--primary-dim)] text-[var(--primary-strong)]">
          <Gavel size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block text-[15px] font-black leading-tight">Administration</strong>
          <span className="block truncate text-xs text-[var(--dim)]">
            {stats
              ? `${stats.open_reports} reports · ${stats.open_legal_reports} requests · ${stats.actions_today} decisions today`
              : "GRAM"}
          </span>
        </div>
      </header>

      {stats ? (
        <section className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
          <Stat label="Accounts" value={stats.users} />
          <Stat label="Open reports" value={stats.open_reports} tone={stats.open_reports ? "var(--danger)" : undefined} />
          <Stat
            label="Legal requests"
            value={stats.open_legal_reports}
            tone={stats.open_legal_reports ? "var(--identity)" : undefined}
          />
          <Stat label="Banned" value={stats.banned_users} />
          <Stat label="Verified" value={stats.verified_users} />
          <Stat
            label="Payouts queued"
            value={stats.pending_payouts}
            tone={stats.pending_payouts ? "var(--stars)" : undefined}
          />
          <Stat
            label="Refunds queued"
            value={stats.pending_refunds}
            tone={stats.pending_refunds ? "var(--danger)" : undefined}
          />
          <Stat label="Stars in circulation" value={stats.stars_in_circulation} tone="var(--stars)" />
          <Stat label="Held for payout" value={stats.pending_payout_stars} />
          <Stat label="XTR collected" value={stats.xtr_collected} />
          <Stat label="XTR refunded" value={stats.xtr_refunded} />
          <Stat label="XTR paid out" value={stats.xtr_paid_out} />
          <Stat label="Communities" value={stats.communities} />
        </section>
      ) : null}

      <Tabs.Root defaultValue="users">
        <Tabs.List className="sticky top-[56px] z-20 flex overflow-x-auto border-b border-[var(--line-structural)] bg-[var(--canvas)] px-2">
          <Tabs.Trigger value="users" className={TAB}>
            <UsersRound size={16} />
            Users
          </Tabs.Trigger>
          <Tabs.Trigger value="reports" className={TAB}>
            <Flag size={16} />
            Reports
            {stats?.open_reports ? (
              <span className="rounded-full bg-[var(--danger)] px-1.5 text-[11px] font-bold text-white">
                {stats.open_reports}
              </span>
            ) : null}
          </Tabs.Trigger>
          <Tabs.Trigger value="legal" className={TAB}>
            <Scale size={16} />
            Legal & support
            {stats?.open_legal_reports ? (
              <span className="rounded-full bg-[var(--primary)] px-1.5 text-[11px] font-bold text-white">
                {stats.open_legal_reports}
              </span>
            ) : null}
          </Tabs.Trigger>
          <Tabs.Trigger value="communities" className={TAB}>
            <Users2 size={16} />
            Communities
          </Tabs.Trigger>
          <Tabs.Trigger value="money" className={TAB}>
            <ArrowDownToLine size={16} />
            Stars
            {stats?.pending_payouts || stats?.pending_refunds ? (
              <span className="rounded-full bg-[var(--stars)] px-1.5 text-[11px] font-bold text-black">
                {(stats?.pending_payouts ?? 0) + (stats?.pending_refunds ?? 0)}
              </span>
            ) : null}
          </Tabs.Trigger>
          <Tabs.Trigger value="designs" className={TAB}>
            <Gift size={16} />
            Gifts
          </Tabs.Trigger>
          <Tabs.Trigger value="audit" className={TAB}>
            <AlertTriangle size={16} />
            Audit log
          </Tabs.Trigger>
          <Tabs.Trigger value="tools" className={TAB}>
            <Megaphone size={16} />
            Broadcast
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="users" className="panel-enter outline-none">
          <AdminUsersPanel />
        </Tabs.Content>
        <Tabs.Content value="reports" className="panel-enter outline-none">
          <AdminReportsPanel />
        </Tabs.Content>
        <Tabs.Content value="legal" className="panel-enter outline-none">
          <AdminLegalReportsPanel />
        </Tabs.Content>
        <Tabs.Content value="communities" className="panel-enter outline-none">
          <AdminCommunitiesPanel />
        </Tabs.Content>
        <Tabs.Content value="money" className="panel-enter outline-none">
          <AdminFinancePanel />
        </Tabs.Content>
        <Tabs.Content value="designs" className="panel-enter outline-none">
          <AdminDesignsPanel />
        </Tabs.Content>
        <Tabs.Content value="audit" className="panel-enter outline-none">
          <AdminAuditPanel />
        </Tabs.Content>
        <Tabs.Content value="tools" className="panel-enter outline-none">
          <AdminBroadcastPanel />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
