"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";

import styles from "./auth.module.css";

/** The wordmark the reference centres above every auth screen. */
export function AuthBrand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      className={compact ? styles.introBrand : styles.plainBrand}
      href="/login"
      aria-label="GRAM — вход"
    >
      {/* The same bold G the navigation uses, so the mark does not change between screens. */}
      <span className={styles.plainBrandMark} style={{ fontSize: compact ? 13 : 19 }}>
        G
      </span>
      <span>GRAM</span>
    </Link>
  );
}

/**
 * The auth shell from `authref/`: flat black, one centred column, the wordmark above the
 * form and a © line pinned to the bottom. Deliberately plain — the screens carry no card,
 * no gradient and no marketing panel, so the form itself is the whole page.
 */
export function AuthShell({
  children,
  wide = false
}: {
  children: React.ReactNode;
  /** Onboarding needs a wider column than a login form does. */
  wide?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <main className={styles.plainViewport}>
      <header className={styles.plainHeader}>
        <AuthBrand />
      </header>

      <motion.div
        className={`${styles.plainStage} ${wide ? styles.plainStageWide : ""}`}
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>

      <p className={styles.copyright}>© GRAM</p>
    </main>
  );
}
