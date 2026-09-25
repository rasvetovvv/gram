"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, ExternalLink, EyeOff, Scale, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, type ReportAction } from "@/lib/api";
import type { AdminCommunity, LegalReport, Report } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { useToast } from "../ui/toast";

const FIELD =
  "min-h-10 w-full rounded-[12px] border-0 bg-[var(--surface-raised)] px-3 text-[14px] outline-none placeholder:text-[var(--dim)]";
const CHIP =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border-0 px-3 text-[13px] font-semibold transition active:scale-95";

const TARGETS: Record<string, string> = {
  user: "account",
  post: "post",
  comment: "comment",
  message: "message",
  community: "community"
};

/** Where the reported thing actually lives, so a moderator can look before deciding. */
function targetHref(report: Report) {
  if (report.target_type === "post") return `/post/${report.target_id}`;
  if (report.target_type === "community") return `/c/${report.target_id}`;
  if (report.target_type === "user") return `/u/${report.subject?.username ?? report.target_id}`;
  return null;
}

function ReportCard({ report }: { report: Report }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [resolution, setResolution] = useState("");
  const resolve = useMutation({
    mutationFn: (action: ReportAction) =>
      api.adminResolveReport(report.id, action, resolution.trim() || undefined),
    onSuccess: async (_result, action) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-reports"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-actions"] })
      ]);
      notify(
        action === "ban"
          ? "Account blocked"
          : action === "hide"
            ? "Content hidden"
            : action === "dismiss"
              ? "Report dismissed"
              : "Report closed",
        { variant: "success" }
      );
    },
    onError: (error: Error) => notify("Something went wrong", { variant: "error", detail: error.message })
  });
  const href = targetHref(report);

  return (
    <li className="border-b border-[var(--line)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="rounded-full bg-white/[0.07] px-2 py-0.5 font-semibold text-[var(--muted)]">
          {TARGETS[report.target_type] ?? report.target_type}
        </span>
        <span className="font-bold text-[var(--danger)]">{report.reason_label}</span>
        {report.target_reports > 1 ? (
          <span className="rounded-full bg-[rgba(229,57,53,.14)] px-2 py-0.5 font-bold text-[var(--danger)]">
            {report.target_reports} reports on the same thing
          </span>
        ) : null}
        <span className="ml-auto text-[var(--dim)]">{relativeTime(report.created_at)}</span>
      </div>

      {report.excerpt ? (
        <p className="mb-0 mt-2 line-clamp-3 border-l-2 border-[var(--line-strong)] pl-2.5 text-[14px] leading-5 text-[var(--muted)]">
          {report.excerpt}
        </p>
      ) : null}
      {report.text ? (
        <p className="mb-0 mt-2 text-[13px] leading-5 text-[var(--dim)]">
          Reported: {report.text}
        </p>
      ) : null}
      <p className="mb-0 mt-2 text-[12px] text-[var(--dim)]">
        {report.reporter ? `@${report.reporter.username}` : "unknown"} → author:{" "}
        {report.subject ? (
          <Link href={`/u/${report.subject.username}`} className="text-[var(--link)]">
            @{report.subject.username}
          </Link>
        ) : (
          "not identified"
        )}
        {href ? (
          <>
            {" · "}
            <Link href={href} className="text-[var(--link)]">
              open
            </Link>
          </>
        ) : null}
      </p>

      {report.status === "open" ? (
        <div className="mt-2.5 space-y-2">
          <input
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            placeholder="Resolution — visible to both the author and the reporter"
            className={FIELD}
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate("note")}
              className={`${CHIP} bg-white/[0.07] text-[var(--ink)]`}
            >
              Reviewed
            </button>
            <button
              type="button"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate("dismiss")}
              className={`${CHIP} bg-white/[0.07] text-[var(--muted)]`}
            >
              <X size={13} />
              Dismiss
            </button>
            {report.target_type !== "user" && report.target_type !== "community" ? (
              <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate("hide")}
                className={`${CHIP} bg-white/[0.07] text-[var(--ink)]`}
              >
                <EyeOff size={13} />
                Hide content
              </button>
            ) : null}
            <button
              type="button"
              disabled={resolve.isPending || !report.subject}
              onClick={() => resolve.mutate("ban")}
              className={`${CHIP} bg-[var(--danger)] text-white disabled:opacity-50`}
            >
              <Ban size={13} />
              Ban author
            </button>
          </div>
        </div>
      ) : (
        <p className="mb-0 mt-2 text-[12px] text-[var(--muted)]">
          {report.status === "dismissed" ? "Dismissed" : "Reviewed"}
          {report.resolved_by ? ` · @${report.resolved_by.username}` : ""}
          {report.resolution ? ` · ${report.resolution}` : ""}
        </p>
      )}
    </li>
  );
}

export function AdminReportsPanel() {
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const reports = useQuery({
    queryKey: ["admin-reports", status],
    queryFn: () => api.adminReports({ status })
  });
  return (
    <div>
      <div className="flex gap-1.5 px-4 py-3">
        {(["open", "resolved", "all"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatus(key)}
            className={`${CHIP} ${
              status === key ? "bg-[var(--primary)] text-white" : "bg-white/[0.07] text-[var(--muted)]"
            }`}
          >
            {key === "open" ? "In queue" : key === "resolved" ? "Reviewed" : "All"}
          </button>
        ))}
      </div>
      {reports.isLoading ? (
        <p className="px-4 py-8 text-center text-[var(--muted)]">Loading…</p>
      ) : reports.data?.length ? (
        <ul className="m-0 list-none p-0">
          {reports.data.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-[var(--muted)]">
          {status === "open" ? "The queue is empty" : "Nothing here"}
        </p>
      )}
    </div>
  );
}

const LEGAL_KINDS: Record<string, string> = {
  copyright: "Copyright",
  trademark: "Trademark",
  privacy: "Privacy",
  illegal_content: "Illegal content",
  impersonation: "Impersonation",
  abuse: "Harassment and threats",
  fraud_spam: "Fraud or spam",
  account_access: "Account access",
  technical: "Technical problem",
  other: "Other"
};

const REPORTER_ROLES: Record<string, string> = {
  rights_holder: "rights holder",
  authorized_agent: "authorized agent",
  content_subject: "content subject",
  platform_user: "user",
  other: "other role"
};

function LegalReportCard({ report }: { report: LegalReport }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [resolution, setResolution] = useState("");
  const resolve = useMutation({
    mutationFn: (action: "resolve" | "dismiss") =>
      api.adminResolveLegalReport(report.id, action, resolution.trim()),
    onSuccess: async (_result, action) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-legal-reports"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-actions"] })
      ]);
      notify(action === "dismiss" ? "Request dismissed" : "Request reviewed", {
        variant: "success"
      });
    },
    onError: (error: Error) =>
      notify("Something went wrong", { variant: "error", detail: error.message })
  });

  return (
    <li className="border-b border-[var(--line)] px-4 py-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(109,95,196,.16)] px-2 py-0.5 font-bold text-[var(--identity)]">
          <Scale size={12} />
          {LEGAL_KINDS[report.kind] ?? report.kind}
        </span>
        <strong>{report.reference_code}</strong>
        <span className="ml-auto text-[var(--dim)]">{relativeTime(report.created_at)}</span>
      </div>
      <p className="mb-0 mt-2 text-[13px] leading-5 text-[var(--muted)]">
        {report.reporter_name} · {REPORTER_ROLES[report.reporter_role] ?? report.reporter_role} ·{" "}
        <a className="text-[var(--link)]" href={`mailto:${report.reporter_email}`}>
          {report.reporter_email}
        </a>
        {report.account_username ? ` · @${report.account_username}` : ""}
        {report.country ? ` · ${report.country}` : ""}
      </p>
      <p className="mb-0 mt-2 whitespace-pre-wrap text-[14px] leading-6">{report.details}</p>
      {report.original_work ? (
        <p className="mb-0 mt-2 whitespace-pre-wrap border-l-2 border-[var(--line-strong)] pl-3 text-[13px] leading-5 text-[var(--muted)]">
          Rights object: {report.original_work}
        </p>
      ) : null}
      {report.content_urls.length ? (
        <div className="mt-2 grid gap-1">
          {report.content_urls.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1.5 truncate text-[13px] text-[var(--link)]"
            >
              <ExternalLink size={12} className="shrink-0" />
              <span className="truncate">{url}</span>
            </a>
          ))}
        </div>
      ) : null}
      {report.requested_action ? (
        <p className="mb-0 mt-2 text-[13px] text-[var(--muted)]">
          Requested action: {report.requested_action}
        </p>
      ) : null}
      {report.status === "open" ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            placeholder="Resolution or internal note"
            className={`${FIELD} min-h-20 py-2`}
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={resolve.isPending || resolution.trim().length < 3}
              onClick={() => resolve.mutate("resolve")}
              className={`${CHIP} bg-[var(--primary)] text-white disabled:opacity-50`}
            >
              <CheckCircle2 size={13} />
              Reviewed
            </button>
            <button
              type="button"
              disabled={resolve.isPending || resolution.trim().length < 3}
              onClick={() => resolve.mutate("dismiss")}
              className={`${CHIP} bg-white/[0.07] text-[var(--muted)] disabled:opacity-50`}
            >
              <X size={13} />
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <p className="mb-0 mt-2 text-[12px] text-[var(--muted)]">
          {report.status === "dismissed" ? "Dismissed" : "Reviewed"}
          {report.resolved_by ? ` · @${report.resolved_by.username}` : ""}
          {report.resolution ? ` · ${report.resolution}` : ""}
        </p>
      )}
    </li>
  );
}

export function AdminLegalReportsPanel() {
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const reports = useQuery({
    queryKey: ["admin-legal-reports", status],
    queryFn: () => api.adminLegalReports(status)
  });
  return (
    <div>
      <div className="flex gap-1.5 px-4 py-3">
        {(["open", "resolved", "all"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatus(key)}
            className={`${CHIP} ${
              status === key ? "bg-[var(--primary)] text-white" : "bg-white/[0.07] text-[var(--muted)]"
            }`}
          >
            {key === "open" ? "In queue" : key === "resolved" ? "Reviewed" : "All"}
          </button>
        ))}
      </div>
      {reports.isLoading ? (
        <p className="px-4 py-8 text-center text-[var(--muted)]">Loading…</p>
      ) : reports.data?.length ? (
        <ul className="m-0 list-none p-0">
          {reports.data.map((report) => (
            <LegalReportCard key={report.id} report={report} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-[var(--muted)]">
          {status === "open" ? "The queue is empty" : "Nothing here"}
        </p>
      )}
    </div>
  );
}

function CommunityRow({ community }: { community: AdminCommunity }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState(community.title);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-communities"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-actions"] })
    ]);
  return (
    <li className="border-b border-[var(--line)] px-4 py-3">
      <div className="flex items-center gap-2">
        <Link href={`/c/${community.slug}`} className="min-w-0 flex-1">
          <strong className="block truncate text-[15px] font-bold">{community.title}</strong>
          <span className="block truncate text-[13px] text-[var(--dim)]">
            /c/{community.slug} · {community.members_count ?? 0} members ·{" "}
            {community.posts_count ?? 0} posts
            {community.owner ? ` · @${community.owner.username}` : ""}
            {community.reports_count ? ` · ${community.reports_count} reports` : ""}
          </span>
        </Link>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={FIELD} />
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason"
          className={FIELD}
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={!title.trim() || title === community.title}
            onClick={() =>
              api
                .adminUpdateCommunity(community.slug, { title: title.trim(), reason: reason || undefined })
                .then(async () => {
                  await refresh();
                  notify("Community updated", { variant: "success" });
                })
                .catch((error: Error) =>
                  notify("Something went wrong", { variant: "error", detail: error.message })
                )
            }
            className={`${CHIP} bg-white/[0.07] text-[var(--ink)] disabled:opacity-50`}
          >
            Save
          </button>
          <button
            type="button"
            disabled={reason.trim().length < 3}
            onClick={() =>
              api
                .adminDeleteCommunity(community.slug, reason.trim())
                .then(async () => {
                  await refresh();
                  notify("Community closed", { variant: "success" });
                })
                .catch((error: Error) =>
                  notify("Something went wrong", { variant: "error", detail: error.message })
                )
            }
            className={`${CHIP} bg-[var(--danger)] text-white disabled:opacity-50`}
          >
            <Trash2 size={13} />
            Close
          </button>
        </div>
      </div>
    </li>
  );
}

export function AdminCommunitiesPanel() {
  const [query, setQuery] = useState("");
  const communities = useQuery({
    queryKey: ["admin-communities", query],
    queryFn: () => api.adminCommunities(query.trim() || undefined)
  });
  return (
    <div>
      <div className="px-4 py-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or slug"
          aria-label="Search communities"
          className={FIELD}
        />
      </div>
      {communities.data?.length ? (
        <ul className="m-0 list-none p-0">
          {communities.data.map((community) => (
            <CommunityRow key={community.id} community={community} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-[var(--muted)]">Nothing found</p>
      )}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  user_updated: "updated a profile",
  user_banned: "banned",
  user_unbanned: "unbanned",
  stars_granted: "granted stars",
  stars_taken: "deducted stars",
  gift_granted: "granted a gift",
  gift_revoked: "revoked a gift",
  username_granted: "assigned a username",
  username_revoked: "revoked a username",
  post_hidden: "hid a post",
  post_restored: "restored a post",
  comment_hidden: "deleted a comment",
  community_updated: "updated a community",
  community_deleted: "closed a community",
  report_ban: "closed a report with a ban",
  report_hide: "closed a report by hiding",
  report_dismiss: "dismissed a report",
  report_note: "reviewed a report",
  legal_report_resolve: "reviewed a legal request",
  legal_report_dismiss: "dismissed a legal request",
  // The money side. Payouts and refunds are decided both here and on the bot's buttons, and
  // `details.source` in each row says which of the two it was.
  payout_approved: "approved a withdrawal",
  payout_declined: "declined a withdrawal",
  payout_paid: "sent a withdrawal",
  payout_failed: "failed to send a withdrawal",
  refund_approved: "approved a refund",
  refund_declined: "declined a refund",
  broadcast_sent: "sent an announcement"
};

/** What to show as one filter chip over the trail. */
const AUDIT_FILTERS = [
  { key: "", label: "All decisions" },
  { key: "payout_approved", label: "Withdrawals" },
  { key: "refund_approved", label: "Refunds" },
  { key: "user_banned", label: "Bans" },
  { key: "stars_granted", label: "Grants" },
  { key: "broadcast_sent", label: "Announcements" }
] as const;

export function AdminAuditPanel() {
  const [action, setAction] = useState<(typeof AUDIT_FILTERS)[number]["key"]>("");
  const [actor, setActor] = useState("");
  const [recent, setRecent] = useState(false);
  const actions = useQuery({
    queryKey: ["admin-actions", action, actor, recent],
    queryFn: () =>
      api.adminActions({
        action: action || undefined,
        actor: actor.trim() || undefined,
        hours: recent ? 24 : undefined
      })
  });
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 px-4 py-3">
        {AUDIT_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setAction(filter.key)}
            className={`${CHIP} ${
              action === filter.key
                ? "bg-[var(--primary)] text-white"
                : "bg-white/[0.07] text-[var(--muted)]"
            }`}
          >
            {filter.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setRecent((value) => !value)}
          className={`${CHIP} ${
            recent ? "bg-[var(--primary)] text-white" : "bg-white/[0.07] text-[var(--muted)]"
          }`}
        >
          Last 24 hours
        </button>
      </div>
      <div className="px-4 pb-3">
        <input
          value={actor}
          onChange={(event) => setActor(event.target.value)}
          placeholder="Who made the decision — username"
          aria-label="Filter by admin"
          className={FIELD}
        />
      </div>
      {actions.data?.length ? (
        <ul className="m-0 list-none p-0">
          {actions.data.map((entry) => (
            <li key={entry.id} className="border-b border-[var(--line)] px-4 py-2.5 text-[14px]">
              <span className="block">
                <strong className="font-bold">@{entry.actor?.username ?? "system"}</strong>{" "}
                {ACTION_LABELS[entry.action] ?? entry.action}{" "}
                <span className="text-[var(--muted)]">{entry.target_label ?? entry.target_id}</span>
              </span>
              <span className="mt-0.5 block text-[12px] text-[var(--dim)]">
                {relativeTime(entry.created_at)}
                {entry.reason ? ` · ${entry.reason}` : ""}
                {entry.details?.source ? ` · ${entry.details.source}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-[var(--muted)]">
          {actions.isLoading ? "Loading…" : "Nothing found"}
        </p>
      )}
    </div>
  );
}
