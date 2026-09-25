import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import styles from "./public-info.module.css";

const TOP_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/security", label: "Security" },
  { href: "/help", label: "Help Center" },
  { href: "/faq", label: "FAQ" }
];

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms of Use" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/cookies", label: "Cookie Policy" },
  { href: "/data-processing", label: "Data Processing" },
  { href: "/creator-terms", label: "Creator Terms" }
];

export function PublicBrand() {
  return (
    <Link href="/" className={styles.brand} aria-label="GRAM — home">
      <span className={styles.brandMark}>G</span>
      <span>GRAM</span>
    </Link>
  );
}

export function PublicInfoShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.site}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <PublicBrand />
          <nav className={styles.nav} aria-label="Help and policy sections">
            {TOP_LINKS.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className={styles.headerActions}>
            <Link href="/login" className={styles.loginLink}>
              Log in
            </Link>
            <Link href="/register" className={styles.openLink}>
              Create account
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
        <nav className={styles.mobileNav} aria-label="Mobile navigation">
          {TOP_LINKS.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className={styles.main}>{children}</main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerIntro}>
            <PublicBrand />
            <p>
              A social messenger for conversations, communities, creators, and digital collections.
            </p>
          </div>
          <div className={styles.footerColumn}>
            <strong>About GRAM</strong>
            <Link href="/about">About the service</Link>
            <Link href="/features">Features</Link>
            <Link href="/security">Security</Link>
            <Link href="/glossary">Glossary</Link>
          </div>
          <div className={styles.footerColumn}>
            <strong>Help</strong>
            <Link href="/help">Help Center</Link>
            <Link href="/faq">FAQ</Link>
            <Link href="/report">Report or request</Link>
            <Link href="/community-guidelines">Community Guidelines</Link>
          </div>
          <div className={styles.footerColumn}>
            <strong>For rights holders</strong>
            <Link href="/report?type=copyright">DMCA / copyright</Link>
            <Link href="/report?type=trademark">Trademark</Link>
            <Link href="/report?type=privacy">Data request</Link>
            <Link href="/creator-terms">Creator Terms</Link>
          </div>
          <div className={styles.footerColumn}>
            <strong>Documents</strong>
            {LEGAL_LINKS.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <div className={styles.footerBottom}>
          © 2026 GRAM · Documents apply to the service at vexory.xyz
        </div>
      </footer>
    </div>
  );
}
