"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LogOut, Plus, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { forgetAccount, listAccounts, rememberAccount, type RememberedAccount } from "@/lib/accounts";
import type { AccountSlot } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { UserAvatar } from "../user-avatar";

import styles from "./auth.module.css";

/** Mirrors `MAX_PARKED_ACCOUNTS` on the server, plus the one that is currently active. */
export const MAX_DEVICE_ACCOUNTS = 5;

/** Roster changes come from this tab or another, so both events are watched. */
function useRoster() {
  const [roster, setRoster] = useState<RememberedAccount[]>([]);
  useEffect(() => {
    const sync = () => setRoster(listAccounts());
    sync();
    window.addEventListener("gram:accounts", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("gram:accounts", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return { roster, refresh: () => setRoster(listAccounts()) };
}

/**
 * The accounts this browser holds, as switchable rows.
 *
 * Each account keeps its own refresh token in its own httpOnly cookie, so switching is a
 * single call and never asks for a password. An account whose session has since expired
 * falls back to the local roster: it still shows, but choosing it opens the login screen with
 * the handle filled in, because there is no longer a credential to switch with.
 */
export function AccountSwitcher({ variant }: { variant: "login" | "app" }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const clearSession = useAuthStore((state) => state.clearSession);
  const setUser = useAuthStore((state) => state.setUser);
  const { roster, refresh } = useRoster();

  const slots = useQuery({ queryKey: ["auth-accounts"], queryFn: api.authAccounts });
  const live: AccountSlot[] = slots.data ?? [];
  const liveIds = new Set(live.map((slot) => slot.user.id));
  // Remembered but no longer signed in: shown so the account is not lost, but needs a password.
  const stale = roster.filter((account) => !liveIds.has(account.id));

  const activate = useMutation({
    mutationFn: (slot: AccountSlot) => api.activateAccount(slot.user.id),
    onSuccess: async (session) => {
      setUser(session.user);
      rememberAccount(session.user);
      // Every cached query belonged to the previous account.
      queryClient.clear();
      await queryClient.invalidateQueries();
      router.replace("/");
    }
  });

  const drop = useMutation({
    mutationFn: (userId: string) => api.removeAccount(userId),
    onSuccess: async (_result, userId) => {
      forgetAccount(userId);
      refresh();
      await queryClient.invalidateQueries({ queryKey: ["auth-accounts"] });
    }
  });

  const rows = variant === "login" ? live : live.filter((slot) => !slot.active);
  const active = live.find((slot) => slot.active);
  const busy = activate.isPending || drop.isPending;

  if (variant === "login" && !rows.length && !stale.length) return null;

  return (
    <div className={styles.accountList}>
      {variant === "login" ? (
        <p className={styles.accountHint}>Accounts on this device</p>
      ) : null}

      {variant === "app" && active ? (
        <div className={`${styles.accountRow} ${styles.accountRowActive}`}>
          <span className={styles.accountPick}>
            <UserAvatar
              src={active.user.avatar_url}
              name={active.user.display_name}
              size={40}
              ringColor="transparent"
            />
            <span className={styles.accountMeta}>
              <span className={styles.accountName}>{active.user.display_name}</span>
              <span className={styles.accountHandle}>@{active.user.username} · now</span>
            </span>
          </span>
          <span className={styles.accountCheck} aria-hidden>
            <Check size={16} />
          </span>
        </div>
      ) : null}

      {rows.map((slot) => (
        <div key={slot.user.id} className={styles.accountRow}>
          <button
            type="button"
            className={styles.accountPick}
            disabled={busy}
            onClick={() => activate.mutate(slot)}
          >
            <UserAvatar
              src={slot.user.avatar_url}
              name={slot.user.display_name}
              size={40}
              ringColor="transparent"
            />
            <span className={styles.accountMeta}>
              <span className={styles.accountName}>{slot.user.display_name}</span>
              <span className={styles.accountHandle}>
                @{slot.user.username}
                {slot.active ? " · now" : ""}
              </span>
            </span>
          </button>
          <button
            type="button"
            className={styles.accountForget}
            aria-label={`Sign out of @${slot.user.username} on this device`}
            disabled={busy}
            onClick={() => drop.mutate(slot.user.id)}
          >
            <LogOut size={16} />
          </button>
        </div>
      ))}

      {stale.map((account) => (
        <div key={account.id} className={styles.accountRow}>
          <button
            type="button"
            className={styles.accountPick}
            onClick={() =>
              router.replace(`/login?identifier=${encodeURIComponent(account.username)}`)
            }
          >
            <UserAvatar
              src={account.avatar_url}
              name={account.display_name}
              size={40}
              ringColor="transparent"
            />
            <span className={styles.accountMeta}>
              <span className={styles.accountName}>{account.display_name}</span>
              <span className={styles.accountHandle}>@{account.username} · password needed</span>
            </span>
          </button>
          <button
            type="button"
            className={styles.accountForget}
            aria-label={`Remove @${account.username} from the list`}
            onClick={() => {
              forgetAccount(account.id);
              refresh();
            }}
          >
            <UserRound size={16} />
          </button>
        </div>
      ))}

      {activate.error ? (
        <p className={styles.accountError}>{activate.error.message}</p>
      ) : null}

      <button
        type="button"
        className={styles.accountAdd}
        onClick={() => {
          if (variant === "app") {
            // The current account stays parked, so this adds one rather than replacing it.
            clearSession();
            queryClient.clear();
          }
          router.replace("/login");
        }}
      >
        <span className={styles.accountAddIcon}>
          <Plus size={18} />
        </span>
        Add account
      </button>
    </div>
  );
}
