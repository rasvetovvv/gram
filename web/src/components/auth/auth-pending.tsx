"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { AuthShell } from "./auth-shell";
import styles from "./auth.module.css";

/**
 * A named auth screen that exists but is not wired to a backend yet.
 *
 * The reference offers both entry points, and a dead link is worse than a screen that says
 * plainly what is missing and what to do instead — so each keeps its own URL and explains.
 */
export function AuthPending({
  title,
  subtitle,
  body,
  action
}: {
  title: string;
  subtitle: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <AuthShell>
      <section aria-labelledby="pending-title">
        <h1 className={styles.plainTitle} id="pending-title">
          {title}
        </h1>
        <p className={styles.plainSubtitle}>{subtitle}</p>
        <p className={styles.plainSubtitle} style={{ marginTop: 18 }}>
          {body}
        </p>
        <div className={styles.plainForm}>
          {action}
          <Link className={styles.ghostButton} href="/login">
            <ArrowLeft size={19} />
            Back to sign in
          </Link>
        </div>
      </section>
    </AuthShell>
  );
}