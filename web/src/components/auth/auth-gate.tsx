"use client";

import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { ApiError, api } from "@/lib/api";
import { rememberAccount } from "@/lib/accounts";
import { useAuthStore } from "@/store/auth";

import styles from "./auth.module.css";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const setStatus = useAuthStore((state) => state.setStatus);
  const clearSession = useAuthStore((state) => state.clearSession);

  const session = useQuery({
    queryKey: ["auth", "me"],
    queryFn: api.restoreSession,
    retry: false,
    staleTime: 60_000
  });

  const unauthorized = session.error instanceof ApiError && session.error.status === 401;

  useEffect(() => {
    if (session.isPending) {
      setStatus("checking");
      return;
    }
    if (session.data) {
      setUser(session.data);
      // A restored session counts as a use of this account, so the switcher lists it even
      // when the visitor did not sign in during this visit.
      rememberAccount(session.data);
      if (session.data.onboarding_complete === false) {
        router.replace("/onboarding");
      }
      return;
    }
    if (unauthorized) {
      clearSession();
      const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
      router.replace(`/login${next}`);
    }
  }, [clearSession, pathname, router, session.data, session.isPending, setStatus, setUser, unauthorized]);

  if (session.data && session.data.onboarding_complete !== false) return children;

  if (session.isError && !unauthorized) {
    return (
      <main className={styles.gateViewport}>
        <section className={styles.gateCard} aria-labelledby="session-error-title">
          <span className={styles.gateIcon}><RotateCcw size={22} /></span>
          <h1 id="session-error-title">Couldn&apos;t verify your session</h1>
          <p>GRAM didn&apos;t get a response from the server. Your data isn&apos;t lost — try checking again.</p>
          <button className={styles.primaryButton} type="button" onClick={() => session.refetch()}>
            Check again
          </button>
          <Link className={styles.textLink} href="/login">Back to sign in</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.gateViewport} aria-live="polite" aria-busy="true">
      <div className={styles.sessionLoader}>
        <LoaderCircle className={styles.spin} size={24} />
        <span>Checking your session…</span>
      </div>
    </main>
  );
}
