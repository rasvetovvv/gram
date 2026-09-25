"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Gavel, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { useToast } from "../ui/toast";
import { AdminUserSheet, CHIP, DANGER, FIELD, QUIET } from "./admin-user-sheet";

/**
 * Staff controls where the content is.
 *
 * A moderator reading a profile or a community already has the context the panel would make them
 * rebuild, so the common decisions belong right here; the full sheet is one tap away for the
 * rest. Rendered only for admins — and the server refuses every call again regardless.
 */
function useStaff() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  return Boolean(me.data?.is_admin);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="mt-3 rounded-[18px] bg-[rgba(109,95,196,.10)] px-3.5 py-3 shadow-[inset_0_0_0_1px_rgba(109,95,196,.28)]">
      <h3 className="m-0 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[.07em] text-[var(--primary-strong)]">
        <Gavel size={13} />
        Administration
      </h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

export function StaffUserControls({ profile }: { profile: User }) {
  const isStaff = useStaff();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [reason, setReason] = useState("");
  const [sheet, setSheet] = useState(false);
  if (!isStaff || profile.is_me) return null;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["profile", profile.username] }),
      queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-actions"] })
    ]);

  async function act<T>(label: string, call: () => Promise<T>) {
    try {
      await call();
      await refresh();
      notify(label, { variant: "success" });
    } catch (error) {
      notify("Something went wrong", { variant: "error", detail: (error as Error).message });
    }
  }

  return (
    <>
      <Shell>
        <div className="space-y-2">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason — required to ban"
            className={FIELD}
          />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setSheet(true)} className={QUIET}>
              <Gavel size={13} />
              All actions
            </button>
            {profile.verified ? (
              <button
                type="button"
                onClick={() =>
                  act("Verification removed", () =>
                    api.adminUpdateUser(profile.username, {
                      is_verified: false,
                      reason: reason || undefined
                    })
                  )
                }
                className={QUIET}
              >
                <Undo2 size={13} />
                Remove verification
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  act("Profile verified", () =>
                    api.adminUpdateUser(profile.username, {
                      is_verified: true,
                      verification_tier: "signal",
                      reason: reason || undefined
                    })
                  )
                }
                className={QUIET}
              >
                <ShieldCheck size={13} />
                Verify
              </button>
            )}
            {profile.is_banned ? (
              <button
                type="button"
                onClick={() => act("Ban lifted", () => api.adminUnbanUser(profile.username))}
                className={`${CHIP} bg-white/[0.09] text-[var(--online)]`}
              >
                <Undo2 size={13} />
                Unban
              </button>
            ) : (
              <button
                type="button"
                disabled={reason.trim().length < 3}
                onClick={() =>
                  act(`@${profile.username} banned`, () =>
                    api.adminBanUser(profile.username, reason.trim())
                  )
                }
                className={DANGER}
              >
                <Ban size={13} />
                Ban
              </button>
            )}
          </div>
        </div>
      </Shell>
      {sheet ? (
        <AdminUserSheet username={profile.username} open onClose={() => setSheet(false)} />
      ) : null}
    </>
  );
}

export function StaffCommunityControls({
  slug,
  title,
  ownerUsername
}: {
  slug: string;
  title: string;
  ownerUsername?: string | null;
}) {
  const isStaff = useStaff();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [reason, setReason] = useState("");
  const [owner, setOwner] = useState("");
  const [draftTitle, setDraftTitle] = useState(title);
  if (!isStaff) return null;

  async function act<T>(label: string, call: () => Promise<T>) {
    try {
      await call();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["community", slug] }),
        queryClient.invalidateQueries({ queryKey: ["admin-communities"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-actions"] })
      ]);
      notify(label, { variant: "success" });
    } catch (error) {
      notify("Something went wrong", { variant: "error", detail: (error as Error).message });
    }
  }

  return (
    <Shell>
      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            aria-label="Community name"
            className={FIELD}
          />
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason"
            className={FIELD}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!draftTitle.trim() || draftTitle === title}
            onClick={() =>
              act("Name updated", () =>
                api.adminUpdateCommunity(slug, {
                  title: draftTitle.trim(),
                  reason: reason || undefined
                })
              )
            }
            className={QUIET}
          >
            Save
          </button>
          <input
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            placeholder={ownerUsername ? `owner @${ownerUsername}` : "new owner"}
            className={`${FIELD} max-w-[190px]`}
          />
          <button
            type="button"
            disabled={!owner.trim()}
            onClick={() =>
              act("Owner changed", () =>
                api.adminTransferCommunity(slug, owner.trim(), reason || undefined)
              )
            }
            className={QUIET}
          >
            Transfer
          </button>
          <button
            type="button"
            disabled={reason.trim().length < 3}
            onClick={() =>
              act("Community closed", () => api.adminDeleteCommunity(slug, reason.trim()))
            }
            className={DANGER}
          >
            <Trash2 size={13} />
            Close
          </button>
        </div>
      </div>
    </Shell>
  );
}