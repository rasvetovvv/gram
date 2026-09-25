import type { Metadata } from "next";
import { CircleHelp, LifeBuoy } from "lucide-react";
import Link from "next/link";

import { FAQ_ITEMS } from "@/components/public/help-data";
import styles from "@/components/public/public-info.module.css";
import { JsonLd } from "@/components/seo/json-ld";
import { absolute, breadcrumbSchema, webPageSchema } from "@/lib/seo";

export const metadata: Metadata = {
  title: "FAQ — frequently asked questions",
  description:
    "Frequently asked questions about GRAM: is the service free, why the email code at sign-in, is there end-to-end encryption, " +
    "how to hide your last-seen time, how a channel differs from a community, what Stars are, how to report and delete your data.",
  alternates: { canonical: "/faq" },
  openGraph: {
    type: "website",
    url: "/faq",
    title: "GRAM FAQ — frequently asked questions",
    description: "Short answers about security, privacy, communities, Stars and support."
  }
};

export default function FaqPage() {
  const faqPage = {
    "@type": "FAQPage",
    "@id": `${absolute("/faq")}#faq`,
    name: "Frequently asked questions about GRAM",
    inLanguage: "en",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer }
    }))
  };

  return (
    <>
      <JsonLd
        nodes={[
          faqPage,
          webPageSchema({
            path: "/faq",
            name: "FAQ GRAM",
            description: metadata.description as string,
            extra: { mainEntity: { "@id": `${absolute("/faq")}#faq` } }
          }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "FAQ", path: "/faq" }
          ])
        ]}
      />
      <header className={styles.hero}>
        <p className={styles.eyebrow}>FAQ</p>
        <h1>Frequently asked questions</h1>
        <p className={styles.heroLead}>
          Short answers about security, privacy, communities, digital features and support.
        </p>
      </header>

      <div className={styles.faqList}>
        {FAQ_ITEMS.map((item) => (
          <details key={item.question} className={styles.faqItem}>
            <summary>{item.question}</summary>
            <div className={styles.helpAnswer}>
              <p>{item.answer}</p>
            </div>
          </details>
        ))}
      </div>

      <div className={`${styles.indexGrid} mt-8`}>
        <Link href="/help" className={styles.indexCard}>
          <span className={styles.cardIcon}><CircleHelp size={20} /></span>
          <span>
            <h2>Need a step-by-step guide?</h2>
            <p>Open the full knowledge base with search and categories.</p>
          </span>
          <span className={styles.cardArrow}>Help center →</span>
        </Link>
        <Link href="/report" className={styles.indexCard}>
          <span className={styles.cardIcon}><LifeBuoy size={20} /></span>
          <span>
            <h2>Need help from staff?</h2>
            <p>Send a technical, legal or account-access request.</p>
          </span>
          <span className={styles.cardArrow}>Submit a request →</span>
        </Link>
      </div>
    </>
  );
}
