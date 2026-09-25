import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import Link from "next/link";

import { GLOSSARY_TERMS } from "@/components/public/glossary-data";
import styles from "@/components/public/public-info.module.css";
import { JsonLd } from "@/components/seo/json-ld";
import {
  SITE_NAME,
  absolute,
  breadcrumbSchema,
  definedTermSchema,
  definedTermSetSchema,
  webPageSchema
} from "@/lib/seo";

const DESCRIPTION =
  "The GRAM glossary: what a community is and how it differs from a channel, what a story, collectible gift, " +
  "upgrade, username, Stars, Premium, Studio, active session, email code, private account, contact request, and DMCA complaint mean.";

export const metadata: Metadata = {
  title: "Glossary",
  description: DESCRIPTION,
  alternates: { canonical: "/glossary" },
  openGraph: {
    type: "website",
    url: "/glossary",
    title: `${SITE_NAME} glossary`,
    description: DESCRIPTION
  }
};

const GLOSSARY_ID = `${absolute("/glossary")}#terms`;

/**
 * A definition an answer engine can quote is the difference between "a channel on GRAM" being described with
 * our semantics or with a competitor's. `DefinedTermSet` + one `DefinedTerm` per entry is the schema
 * built for exactly that, and each term gets its own anchor so a citation can point at the definition
 * rather than the page.
 */
export default function GlossaryPage() {
  const page = webPageSchema({
    path: "/glossary",
    name: `${SITE_NAME} glossary`,
    description: DESCRIPTION,
    extra: { mainEntity: { "@id": GLOSSARY_ID } }
  });

  const termSet = definedTermSetSchema({
    id: GLOSSARY_ID,
    path: "/glossary",
    name: `${SITE_NAME} glossary`,
    description: DESCRIPTION,
    terms: GLOSSARY_TERMS
  });

  const terms = GLOSSARY_TERMS.map((term) =>
    definedTermSchema({
      path: "/glossary",
      slug: term.slug,
      term: term.term,
      definition: term.definition,
      glossaryId: GLOSSARY_ID,
      alternateName: term.alternateName
    })
  );

  return (
    <>
      <JsonLd
        nodes={[
          page,
          termSet,
          ...terms,
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Glossary", path: "/glossary" }
          ])
        ]}
      />

      <header className={styles.hero}>
        <p className={styles.eyebrow}>
          <BookOpen size={13} aria-hidden />
          Glossary
        </p>
        <h1>{SITE_NAME} glossary</h1>
        <p className={styles.heroLead}>{DESCRIPTION}</p>
      </header>

      <div className={styles.docGrid}>
        <nav className={styles.toc} aria-label="Terms">
          <p className={styles.tocTitle}>Terms</p>
          {GLOSSARY_TERMS.map((term) => (
            <a key={term.slug} href={`#${term.slug}`}>
              {term.term}
            </a>
          ))}
        </nav>

        <article className={styles.article}>
          {GLOSSARY_TERMS.map((term) => (
            <section key={term.slug} id={term.slug} className={styles.section}>
              <h2>{term.term}</h2>
              {term.alternateName?.length ? (
                <p className={styles.helpMeta}>Also: {term.alternateName.join(", ")}</p>
              ) : null}
              <p>{term.definition}</p>
              {term.readMore ? (
                <Link href={term.readMore.href} className={styles.inlineLink}>
                  {term.readMore.label} →
                </Link>
              ) : null}
            </section>
          ))}

          <section className={styles.relatedDocs} aria-label="Related sections">
            <p className={styles.tocTitle}>Next</p>
            <div className={styles.relatedRow}>
              <Link href="/about" className={styles.relatedLink}>
                About
              </Link>
              <Link href="/features" className={styles.relatedLink}>
                Features
              </Link>
              <Link href="/security" className={styles.relatedLink}>
                Security
              </Link>
              <Link href="/help" className={styles.relatedLink}>
                Help Center
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
