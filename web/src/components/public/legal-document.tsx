import Link from "next/link";

import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbSchema, webPageSchema } from "@/lib/seo";
import styles from "./public-info.module.css";

export const LEGAL_UPDATED = "August 27, 2026";

/** The same date a machine can parse, for `dateModified` and the sitemap. */
export const LEGAL_UPDATED_ISO = "2026-08-27T00:00:00.000Z";

export const LEGAL_DOCS: { href: string; label: string }[] = [
  { href: "/terms", label: "Terms of Use" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/cookies", label: "Cookie Policy" },
  { href: "/community-guidelines", label: "Community Guidelines" },
  { href: "/data-processing", label: "Data Processing Policy" },
  { href: "/creator-terms", label: "Creator Terms" }
];

export type LegalBlock = {
  title?: string;
  paragraphs?: string[];
  bullets?: string[];
  numbered?: string[];
};

export type LegalSection = {
  id: string;
  title: string;
  blocks: LegalBlock[];
};

export function LegalDocument({
  eyebrow,
  title,
  description,
  sections,
  important,
  current
}: {
  eyebrow: string;
  title: string;
  description: string;
  sections: LegalSection[];
  important?: string;
  current?: string;
}) {
  const related = LEGAL_DOCS.filter((item) => item.href !== current);
  const label = LEGAL_DOCS.find((item) => item.href === current)?.label ?? title;
  return (
    <>
      {current ? (
        <JsonLd
          nodes={[
            webPageSchema({
              path: current,
              name: title,
              description,
              updated: LEGAL_UPDATED_ISO,
              /* A policy is a terms/privacy document, and Google has distinct types for exactly
                 these two — the rest stay generic WebPage rather than being mislabelled. */
              type:
                current === "/terms"
                  ? "TermsOfService"
                  : current === "/privacy"
                    ? "PrivacyPolicy"
                    : "WebPage"
            }),
            breadcrumbSchema([
              { name: "Home", path: "/" },
              { name: "Documents", path: "/terms" },
              { name: label, path: current }
            ])
          ]}
        />
      ) : null}

      <header className={styles.hero}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.heroLead}>{description}</p>
        <span className={styles.updated}>Last updated: {LEGAL_UPDATED}</span>
      </header>

      {important ? (
        <aside className={styles.notice} aria-label="Important information">
          <strong>The gist</strong>
          <p>{important}</p>
        </aside>
      ) : null}

      <div className={styles.docGrid}>
        <nav className={styles.toc} aria-label="Document contents">
          <p className={styles.tocTitle}>Contents</p>
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>

        <article className={styles.article}>
          {sections.map((section) => (
            <section key={section.id} id={section.id} className={styles.section}>
              <h2>{section.title}</h2>
              {section.blocks.map((block, index) => (
                <div key={`${section.id}-${index}`}>
                  {block.title ? <h3>{block.title}</h3> : null}
                  {block.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  {block.bullets?.length ? (
                    <ul>
                      {block.bullets.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : null}
                  {block.numbered?.length ? (
                    <ol>
                      {block.numbered.map((item) => <li key={item}>{item}</li>)}
                    </ol>
                  ) : null}
                </div>
              ))}
            </section>
          ))}
          <aside className={styles.callout}>
            <strong>A question, data request, or complaint?</strong>
            <p>
              Use the secure <Link href="/report">contact form</Link>. Include links and
              only the personal data needed for the review.
            </p>
          </aside>
          <section className={styles.relatedDocs} aria-label="Related documents">
            <p className={styles.tocTitle}>Related documents</p>
            <div className={styles.relatedRow}>
              {related.map((item) => (
                <Link key={item.href} href={item.href} className={styles.relatedLink}>
                  {item.label}
                </Link>
              ))}
              <Link href="/help" className={styles.relatedLink}>
                Help Center
              </Link>
            </div>
          </section>
        </article>
      </div>
    </>
  );
}
