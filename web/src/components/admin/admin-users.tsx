"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api, type AdminUserScope } from "@/lib/api";
import type { AdminUser } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { UserAvatar } from "../user-avatar";
import { AdminUserSheet, CHIP, FIELD, QUIET } from "./admin-user-sheet";

const SCOPES: { key: AdminUserScope; label: string }[] = [
  { key: "all", label: "All" },
  { key: "reported", label: "Reported" },
  { key: "banned", label: "Banned" },
  { key: "verified", label: "Verified" },
  { key: "admins", label: "Admins" }
];

/**
 * The list is a list: one line per account, the numbers a moderator scans by, and one way in.
 *
 * Every control lives in the sheet behind it. Cramming them onto the row was what made the panel
 * unusable — the reason field scrolled out of view, and there was no room for the collection or
 * the posts the decision was actually about.
 */
function UserRow({ user, onOpen }: { user: AdminUser; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 border-0 border-b border-[var(--line)] bg-transparent px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <UserAvatar src={user.avatar_url} name={user.display_name} size={42} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-bold">{user.display_name}</span>
            {user.is_verified ? (
              <ShieldCheck size={14} className="shrink-0 text-[var(--verified)]" />
            ) : null}
            {user.is_admin ? (
              <span className="shrink-0 rounded-full bg-[var(--primary-dim)] px-1.5 text-[11px] font-bold text-[var(--primary-strong)]">
                admin
              </span>
            ) : null}
            {user.is_banned ? (
              <span className="shrink-0 rounded-full bg-[rgba(229,57,53,.16)] px-1.5 text-[11px] font-bold text-[var(--danger)]">
                banned
              </span>
            ) : null}
            {user.open_reports_count ? (
              <span className="shrink-0 rounded-full bg-[rgba(245,158,11,.16)] px-1.5 text-[11px] font-bold text-[#f59e0b]">
                {user.open_reports_count} reports
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-[var(--dim)]">
            @{user.username} · {user.stars_balance ?? 0} ★ · {user.gifts_count ?? 0} gifts ·{" "}
            {user.posts_count ?? 0} posts · joined {relativeTime(user.joined_at)}
          </span>
          {user.ban_reason ? (
            <span className="mt-0.5 block truncate text-[12px] text-[var(--danger)]">
              {user.ban_reason}
            </span>
          ) : null}
        </span>
        <span className={`${QUIET} pointer-events-none`}>Open</span>
      </button>
    </li>
  );
}

export function AdminUsersPanel() {
  const [scope, setScope] = useState<AdminUserScope>("all");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const users = useQuery({
    queryKey: ["admin-users", scope, query],
    queryFn: () => api.adminUsers({ scope, q: query.trim() || undefined })
  });

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-3">
        <Search size={16} className="shrink-0 text-[var(--muted)]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or @handle"
          aria-label="Search users"
          className={FIELD}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        {SCOPES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setScope(item.key)}
            className={
              scope === item.key
                ? `${CHIP} bg-[var(--primary)] text-white`
                : `${CHIP} bg-white/[0.07] text-[var(--muted)]`
            }
          >
            {item.label}
          </button>
        ))}
      </div>
      {users.isLoading ? (
        <p className="px-4 py-8 text-center text-[var(--muted)]">Loading…</p>
      ) : users.data?.length ? (
        <ul className="m-0 list-none p-0">
          {users.data.map((user) => (
            <UserRow key={user.id} user={user} onOpen={() => setActive(user.username)} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-[var(--muted)]">No one found</p>
      )}
      {active ? (
        <AdminUserSheet username={active} open onClose={() => setActive(null)} />
      ) : null}
    </div>
  );
}
