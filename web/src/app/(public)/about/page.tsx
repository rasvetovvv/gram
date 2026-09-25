import type { Metadata } from "next";
import { ArrowRight, CircleHelp, LifeBuoy, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { JsonLd } from "@/components/seo/json-ld";
import styles from "@/components/public/public-info.module.css";
import { LEGAL_DOCS } from "@/components/public/legal-document";
import {
  SITE_DESCRIPTION,
  SITE_FEATURES,
  SITE_NAME,
  SITE_TAGLINE,
  breadcrumbSchema,
  webPageSchema
} from "@/lib/seo";

export const metadata: Metadata = {
  title: `About ${SITE_NAME}`,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: {
    type: "website",
    url: "/about",
    title: `About ${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION
  }
};

/**
 * The product itself sits behind a session check, so a crawler that asks for `/` only ever sees
 * "Checking session…". This page is the answer to "what is GRAM?" in prose a machine can quote:
 * plain server-rendered text, no client state, no auth.
 */
const SECTIONS: { id: string; title: string; paragraphs: string[]; bullets?: string[] }[] = [
  {
    id: "what-is-gram",
    title: "What is GRAM",
    paragraphs: [
      "GRAM is a social messenger on vexory.xyz. A single space brings together private and group chats, a post feed, communities and channels, stories, collectible gifts, a username market, and an internal Stars balance.",
      "The service runs in the browser on both phone and computer — no separate app to install. The interface is in English with a dark theme."
    ]
  },
  {
    id: "features",
    title: "Features",
    paragraphs: [
      "Below is what already works in the current version. Features that cost money always show the price before you confirm."
    ],
    bullets: SITE_FEATURES
  },
  {
    id: "communication",
    title: "Messaging and posts",
    paragraphs: [
      "Chats support attachments, replies, editing, reactions, forwarding, folders, and an archive. Group chats and communities are managed by the owner and the roles they assign.",
      "A feed post can contain text, a gallery, video, a file, music, a poll, and an 18+ tag. Comments and reactions update without reloading the page, and stories are shown for a limited time."
    ]
  },
  {
    id: "communities",
    title: "Communities and channels",
    paragraphs: [
      "The core object in GRAM is called a community. A public community with posts works as a channel, while a private one works as an invite- or subscription-based space. The owner sees statistics and manages members and access rules."
    ]
  },
  {
    id: "stars-gifts",
    title: "Stars, gifts, and usernames",
    paragraphs: [
      "Stars are GRAM's internal balance. They pay for gifts, creator support, and some premium features. Stars are not a bank deposit or a cryptocurrency; refund and withdrawal terms are shown in the interface of each specific operation.",
      "A collectible gift can be bought, sent, upgraded, and placed on your profile. A username can be reserved and listed on the market; doing so grants no rights to anyone else's trademark or name."
    ]
  },
  {
    id: "privacy",
    title: "Privacy and security",
    paragraphs: [
      "Registration requires a verified email, and every password login is additionally confirmed with a one-time code from an email. Support never asks for your password, code, seed phrase, or private key.",
      "In settings you can hide your “online” status, close your account, restrict who can message you, block a user, and end any active session. Regular chats should not be considered end-to-end encrypted unless a specific screen says otherwise."
    ]
  },
  {
    id: "moderation",
    title: "Moderation and reports",
    paragraphs: [
      "The community rules describe allowed content and behavior. You can report a post, profile, message, or community from that item's own menu, and rights holders and people without an account have a separate public form — covering DMCA, trademarks, privacy, and data requests.",
      "Each report gets a number you can use to come back with a clarification or an appeal."
    ]
  }
];

const FEATURE_LIST_ID = "https://vexory.xyz/about#features";

export default function AboutPage() {
  const breadcrumbs = breadcrumbSchema([
    { name: "Home", path: "/" },
    { name: `About ${SITE_NAME}`, path: "/about" }
  ]);

  const page = webPageSchema({
    path: "/about",
    name: `About ${SITE_NAME}`,
    description: SITE_DESCRIPTION,
    type: "AboutPage",
    extra: {
      significantLink: [
        "https://vexory.xyz/help",
        "https://vexory.xyz/faq",
        "https://vexory.xyz/terms",
        "https://vexory.xyz/privacy"
      ],
      mainEntity: { "@id": FEATURE_LIST_ID }
    }
  });

  const featureList = {
    "@type": "ItemList",
    "@id": FEATURE_LIST_ID,
    name: `${SITE_NAME} features`,
    itemListElement: SITE_FEATURES.map((feature, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: feature
    }))
  };

  return (
    <>
      <JsonLd nodes={[page, breadcrumbs, featureList]} />

      <header className={styles.hero}>
        <p className={styles.eyebrow}>About / The service</p>
        <h1>About {SITE_NAME}</h1>
        <p className={styles.heroLead}>{SITE_DESCRIPTION}</p>
      </header>

      <div className={styles.docGrid}>
        <nav className={styles.toc} aria-label="Page contents">
          <p className={styles.tocTitle}>Contents</p>
          {SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>

        <article className={styles.article}>
          {SECTIONS.map((section) => (
            <section key={section.id} id={section.id} className={styles.section}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets?.length ? (
                <ul>
                  {section.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          <div className={`${styles.indexGrid} mt-8`}>
            <Link href="/help" className={styles.indexCard}>
              <span className={styles.cardIcon}>
                <CircleHelp size={20} />
              </span>
              <span>
                <h2>Help Center</h2>
                <p>Step-by-step guides for your account, privacy, chats, and Stars.</p>
              </span>
              <span className={styles.cardArrow}>Open →</span>
            </Link>
            <Link href="/faq" className={styles.indexCard}>
              <span className={styles.cardIcon}>
                <ShieldCheck size={20} />
              </span>
              <span>
                <h2>Frequently asked questions</h2>
                <p>Short answers about security, privacy, and digital features.</p>
              </span>
              <span className={styles.cardArrow}>Open →</span>
            </Link>
            <Link href="/report" className={styles.indexCard}>
              <span className={styles.cardIcon}>
                <LifeBuoy size={20} />
              </span>
              <span>
                <h2>Report or request</h2>
                <p>DMCA, privacy, account access, and technical support.</p>
              </span>
              <span className={styles.cardArrow}>Open →</span>
            </Link>
          </div>

          <section className={styles.relatedDocs} aria-label="Service documents">
            <p className={styles.tocTitle}>Service documents</p>
            <div className={styles.relatedRow}>
              {LEGAL_DOCS.map((item) => (
                <Link key={item.href} href={item.href} className={styles.relatedLink}>
                  {item.label}
                </Link>
              ))}
            </div>
          </section>

          <aside className={`${styles.callout} mt-8`}>
            <strong>Ready to start?</strong>
            <p>
              Registration takes a minute and requires a verified email.{" "}
              <Link href="/register">Create an account</Link> or{" "}
              <Link href="/login">sign in to an existing one</Link>.
            </p>
            <Link href="/register" className={`${styles.secondaryLink} mt-4`}>
              Create an account
              <ArrowRight size={15} />
            </Link>
          </aside>
        </article>
      </div>
    </>
  );
}
