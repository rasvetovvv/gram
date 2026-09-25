import type { Metadata } from "next";
import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { SECURITY_FACTS, SECURITY_FAQ } from "@/components/public/security-data";
import styles from "@/components/public/public-info.module.css";
import { JsonLd } from "@/components/seo/json-ld";
import {
  SITE_NAME,
  absolute,
  breadcrumbSchema,
  faqSchema,
  webPageSchema
} from "@/lib/seo";

const DESCRIPTION =
  "How GRAM security works: password login with a one-time email code, httpOnly sessions and a list of active " +
  "devices, privacy settings and status hiding, what happens to your messages, protection for Stars payments, " +
  "the limits of support, and data deletion.";

export const metadata: Metadata = {
  title: "Security and privacy",
  description: DESCRIPTION,
  alternates: { canonical: "/security" },
  openGraph: {
    type: "website",
    url: "/security",
    title: `${SITE_NAME} security and privacy`,
    description: DESCRIPTION
  }
};

const FAQ_ID = `${absolute("/security")}#faq`;

/**
 * "Is GRAM safe" is the question a cautious person asks before signing up and the one an answer
 * engine will answer regardless of whether we publish anything. So this page states the guarantees and
 * the limits in the same breath — including no end-to-end encryption and no automatic password reset,
 * because an assistant repeating an overclaim is a worse outcome than an honest caveat.
 */
export default function SecurityPage() {
  const page = webPageSchema({
    path: "/security",
    name: `${SITE_NAME} security and privacy`,
    description: DESCRIPTION,
    extra: { mainEntity: { "@id": FAQ_ID } }
  });

  return (
    <>
      <JsonLd
        nodes={[
          page,
          faqSchema(FAQ_ID, `${SITE_NAME} security questions`, SECURITY_FAQ),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Security", path: "/security" }
          ])
        ]}
      />

      <header className={styles.hero}>
        <p className={styles.eyebrow}>
          <ShieldCheck size={13} aria-hidden />
          Security
        </p>
        <h1>Security and privacy</h1>
        <p className={styles.heroLead}>{DESCRIPTION}</p>
      </header>

      <aside className={styles.notice} aria-label="The essentials">
        <strong>The essentials</strong>
        <p>
          Login is protected by a password and a one-time code from an email, the session is stored in an httpOnly cookie, and
          you can end any active session yourself. At the same time, regular chats are not
          end-to-end encrypted: the server stores messages in order to deliver and sync them.
        </p>
      </aside>

      <div className={styles.docGrid}>
        <nav className={styles.toc} aria-label="Page contents">
          <p className={styles.tocTitle}>Sections</p>
          {SECURITY_FACTS.map((group) => (
            <a key={group.id} href={`#${group.id}`}>
              {group.title}
            </a>
          ))}
          <a href="#faq">Frequently asked questions</a>
        </nav>

        <article className={styles.article}>
          {SECURITY_FACTS.map((group) => (
            <section key={group.id} id={group.id} className={styles.section}>
              <h2>{group.title}</h2>
              <p>{group.summary}</p>
              <ul>
                {group.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </section>
          ))}

          <section id="faq" className={styles.section}>
            <h2>Frequently asked security questions</h2>
            <div className={styles.faqList}>
              {SECURITY_FAQ.map((item) => (
                <details key={item.question} className={styles.faqItem}>
                  <summary>{item.question}</summary>
                  <div className={styles.helpAnswer}>
                    <p>{item.answer}</p>
                  </div>
                </details>
              ))}
            </div>
          </section>

          <aside className={`${styles.callout} mt-8`}>
            <strong>Suspect an unauthorized login or fraud?</strong>
            <p>
              Change your password, end the other sessions, then describe the situation via the{" "}
              <Link href="/report">report form</Link>. Don&apos;t send your password or one-time code —
              they aren&apos;t needed for verification.
            </p>
            <Link href="/report?type=account_access" className={`${styles.secondaryLink} mt-4`}>
              Report an account access issue
              <ArrowRight size={15} />
            </Link>
          </aside>

          <section className={styles.relatedDocs} aria-label="Related documents">
            <p className={styles.tocTitle}>Next</p>
            <div className={styles.relatedRow}>
              <Link href="/privacy" className={styles.relatedLink}>
                Privacy Policy
              </Link>
              <Link href="/data-processing" className={styles.relatedLink}>
                Data processing
              </Link>
              <Link href="/cookies" className={styles.relatedLink}>
                Cookie Policy
              </Link>
              <Link href="/help" className={styles.relatedLink}>
                Help Center
              </Link>
              <Link href="/glossary" className={styles.relatedLink}>
                Glossary
              </Link>
            </div>
          </section>
        </article>
      </div>
    </>
  );
}
