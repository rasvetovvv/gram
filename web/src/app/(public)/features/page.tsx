import type { Metadata } from "next";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import { FEATURE_GROUPS } from "@/components/public/features-data";
import styles from "@/components/public/public-info.module.css";
import { JsonLd } from "@/components/seo/json-ld";
import {
  SITE_NAME,
  absolute,
  breadcrumbSchema,
  itemListSchema,
  webPageSchema
} from "@/lib/seo";

const DESCRIPTION =
  "A full breakdown of what GRAM can do: direct and group chats with attachments, a post feed with polls and music, " +
  "communities and channels, stories, collectible gifts and upgrades, a username market, Stars, GRAM Premium, " +
  "the Creator Studio, privacy settings and moderation.";

export const metadata: Metadata = {
  title: "Features",
  description: DESCRIPTION,
  alternates: { canonical: "/features" },
  openGraph: {
    type: "website",
    url: "/features",
    title: `${SITE_NAME} features`,
    description: DESCRIPTION
  }
};

const FEATURE_LIST_ID = `${absolute("/features")}#catalogue`;

/**
 * `/about` answers "what GRAM is" in a paragraph. This page answers "what GRAM can do" in detail —
 * the question a comparison query actually asks, and the one an answer engine otherwise fills from a
 * competitor's feature list.
 *
 * Server-rendered plain text with an `ItemList` of every capability, so the catalogue is machine
 * readable without executing a line of client JavaScript.
 */
export default function FeaturesPage() {
  const page = webPageSchema({
    path: "/features",
    name: `${SITE_NAME} features`,
    description: DESCRIPTION,
    type: "CollectionPage",
    extra: { mainEntity: { "@id": FEATURE_LIST_ID } }
  });

  const catalogue = itemListSchema({
    id: FEATURE_LIST_ID,
    name: `${SITE_NAME} features`,
    items: FEATURE_GROUPS.map((group) => ({
      name: group.title,
      description: group.lead,
      url: `${absolute("/features")}#${group.id}`
    }))
  });

  return (
    <>
      <JsonLd
        nodes={[
          page,
          catalogue,
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Features", path: "/features" }
          ])
        ]}
      />

      <header className={styles.hero}>
        <p className={styles.eyebrow}>
          <Sparkles size={13} aria-hidden />
          Features
        </p>
        <h1>What {SITE_NAME} can do</h1>
        <p className={styles.heroLead}>{DESCRIPTION}</p>
      </header>

      <div className={styles.docGrid}>
        <nav className={styles.toc} aria-label="Page contents">
          <p className={styles.tocTitle}>Sections</p>
          {FEATURE_GROUPS.map((group) => (
            <a key={group.id} href={`#${group.id}`}>
              {group.title}
            </a>
          ))}
        </nav>

        <article className={styles.article}>
          {FEATURE_GROUPS.map((group) => (
            <section key={group.id} id={group.id} className={styles.section}>
              <h2>{group.title}</h2>
              <p>{group.lead}</p>
              <ul>
                {group.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
              {group.link ? (
                <Link href={group.link.href} className={styles.inlineLink}>
                  {group.link.label} →
                </Link>
              ) : null}
            </section>
          ))}

          <aside className={`${styles.callout} mt-8`}>
            <strong>What to know before signing up</strong>
            <p>
              Core features are free, and paid ones show their price before you confirm. Ordinary
              chats should not be considered end-to-end encrypted — details in the{" "}
              <Link href="/security">security</Link> section.
            </p>
            <Link href="/register" className={`${styles.secondaryLink} mt-4`}>
              Create an account
              <ArrowRight size={15} />
            </Link>
          </aside>

          <section className={styles.relatedDocs} aria-label="Related sections">
            <p className={styles.tocTitle}>Next</p>
            <div className={styles.relatedRow}>
              <Link href="/about" className={styles.relatedLink}>
                About
              </Link>
              <Link href="/security" className={styles.relatedLink}>
                <ShieldCheck size={14} />
                Security
              </Link>
              <Link href="/glossary" className={styles.relatedLink}>
                Glossary
              </Link>
              <Link href="/help" className={styles.relatedLink}>
                Help center
              </Link>
              <Link href="/faq" className={styles.relatedLink}>
                FAQ
              </Link>
            </div>
          </section>
        </article>
      </div>
    </>
  );
}
