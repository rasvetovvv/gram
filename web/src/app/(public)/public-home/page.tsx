import type { Metadata } from "next";
import {
  ArrowRight,
  BookOpen,
  Gift,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Users
} from "lucide-react";
import Link from "next/link";

import { FEATURE_GROUPS } from "@/components/public/features-data";
import styles from "@/components/public/public-info.module.css";
import { JsonLd } from "@/components/seo/json-ld";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  absolute,
  faqSchema,
  itemListSchema,
  webPageSchema
} from "@/lib/seo";

/**
 * The root URL is the signed-in feed for a person with an auth cookie. `proxy.ts` rewrites an
 * anonymous GET for `/` here, preserving https://vexory.xyz in the address bar. That gives a crawler
 * a real server-rendered landing page instead of "Checking session…", while an existing session still
 * opens the product exactly as before.
 *
 * `/public-home` itself is not linked or placed in the sitemap. Its canonical is `/`, so even if a
 * crawler discovers the internal rewrite target it consolidates signals into the real homepage.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} — ${SITE_TAGLINE}` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION
  }
};

const HOME_FAQ = [
  {
    question: "What is GRAM?",
    answer:
      "GRAM is a social messenger at vexory.xyz: private and group chats, a post feed, communities and channels, stories, collectible gifts, usernames and an internal Stars balance in a single web app."
  },
  {
    question: "Do I need to install the GRAM app?",
    answer:
      "No. GRAM works in the browser on your phone and computer; there is no separate app to install."
  },
  {
    question: "Is GRAM free?",
    answer:
      "The core account, feed, chat and community features are available without a mandatory subscription. Premium, Stars, gifts and paid communities show the price before you confirm."
  },
  {
    question: "How is signing in to GRAM protected?",
    answer:
      "Registration requires a confirmed email, and every password sign-in is additionally confirmed with a one-time code from an email. The owner can see active sessions and end any of them."
  },
  {
    question: "Does GRAM have end-to-end encryption?",
    answer:
      "Don't assume regular chats are end-to-end encrypted unless a specific screen explicitly says otherwise. Messages are stored by the server for delivery and synchronization across devices."
  }
] as const;

const CARD_FEATURES = [
  {
    icon: MessageCircle,
    title: "Chats",
    text: "Private and group conversations, attachments, replies, reactions, forwarding, folders and archive.",
    href: "/features#chats"
  },
  {
    icon: Sparkles,
    title: "Feed and stories",
    text: "Posts with galleries, video, files, music and polls; live comments without reloading.",
    href: "/features#feed"
  },
  {
    icon: Users,
    title: "Communities and channels",
    text: "Public, private and paid spaces with members, roles and invitations.",
    href: "/features#communities"
  },
  {
    icon: Gift,
    title: "Gifts and usernames",
    text: "Collectible gifts, upgrades, a profile collection and a market of public addresses.",
    href: "/features#gifts"
  },
  {
    icon: LockKeyhole,
    title: "Privacy",
    text: "Hidden online status, a private account, message limits, blocks and session control.",
    href: "/security"
  },
  {
    icon: BookOpen,
    title: "Clear support",
    text: "A step-by-step knowledge base, FAQ and a public form for support, privacy and DMCA.",
    href: "/help"
  }
];

const FEATURE_LIST_ID = `${absolute("/")}#features`;
const FAQ_ID = `${absolute("/")}#faq`;

export default function PublicHomePage() {
  return (
    <>
      <JsonLd
        nodes={[
          webPageSchema({
            path: "/",
            name: `${SITE_NAME} — ${SITE_TAGLINE}`,
            description: SITE_DESCRIPTION,
            type: "WebPage",
            extra: {
              mainEntity: [{ "@id": FEATURE_LIST_ID }, { "@id": FAQ_ID }],
              significantLink: [
                absolute("/features"),
                absolute("/security"),
                absolute("/help"),
                absolute("/faq")
              ]
            }
          }),
          itemListSchema({
            id: FEATURE_LIST_ID,
            name: `${SITE_NAME} features`,
            items: FEATURE_GROUPS.map((group) => ({
              name: group.title,
              description: group.lead,
              url: `${absolute("/features")}#${group.id}`
            }))
          }),
          faqSchema(FAQ_ID, `Key questions about ${SITE_NAME}`, HOME_FAQ)
        ]}
      />

      <header className={styles.hero}>
        <p className={styles.eyebrow}>Social messenger</p>
        <h1>Messaging, posts and a digital collection — all in one GRAM</h1>
        <p className={styles.heroLead}>{SITE_DESCRIPTION}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/register" className={styles.primaryLink}>
            Create account
            <ArrowRight size={16} />
          </Link>
          <Link href="/login" className={styles.secondaryLink}>
            Sign in
          </Link>
          <Link href="/features" className={styles.secondaryLink}>
            All features
          </Link>
        </div>
      </header>

      <section aria-labelledby="home-features">
        <p className={styles.eyebrow}>What&apos;s inside</p>
        <h2 id="home-features" className="mb-6 text-3xl font-extrabold tracking-[-0.035em]">
          Everything that already works
        </h2>
        <div className={styles.indexGrid}>
          {CARD_FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <Link key={feature.title} href={feature.href} className={styles.indexCard}>
                <span className={styles.cardIcon}>
                  <Icon size={20} aria-hidden />
                </span>
                <span>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </span>
                <span className={styles.cardArrow}>Learn more →</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mt-20" aria-labelledby="home-trust">
        <p className={styles.eyebrow}>Security without marketing promises</p>
        <h2 id="home-trust" className="mb-5 text-3xl font-extrabold tracking-[-0.035em]">
          Straight talk on sign-in, data and messages
        </h2>
        <div className={styles.notice}>
          <strong className="flex items-center gap-2">
            <ShieldCheck size={18} />
            What protects your account
          </strong>
          <p>
            Every password sign-in is confirmed with a one-time code from an email, the session is stored in
            an httpOnly cookie, and the owner controls the list of active devices. Regular chats,
            meanwhile, should not be considered end-to-end encrypted: the server stores messages for
            delivery and synchronization.
          </p>
          <Link href="/security" className={`${styles.secondaryLink} mt-4`}>
            Security and privacy
            <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      <section id="faq" className="mt-20 scroll-mt-24" aria-labelledby="home-faq-title">
        <p className={styles.eyebrow}>Short answers</p>
        <h2 id="home-faq-title" className="mb-6 text-3xl font-extrabold tracking-[-0.035em]">
          The essentials about {SITE_NAME}
        </h2>
        <div className={styles.faqList}>
          {HOME_FAQ.map((item) => (
            <details key={item.question} className={styles.faqItem}>
              <summary>{item.question}</summary>
              <div className={styles.helpAnswer}>
                <p>{item.answer}</p>
              </div>
            </details>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/faq" className={styles.secondaryLink}>
            All frequent questions
          </Link>
          <Link href="/help" className={styles.secondaryLink}>
            Help center
          </Link>
          <Link href="/glossary" className={styles.secondaryLink}>
            Glossary
          </Link>
        </div>
      </section>

      <aside className={`${styles.callout} mt-20`}>
        <strong>GRAM opens right in your browser</strong>
        <p>
          Confirm your email, pick a username and start chatting. There is no separate app to
          install.
        </p>
        <Link href="/register" className={`${styles.primaryLink} mt-4`}>
          Get started
          <ArrowRight size={16} />
        </Link>
      </aside>
    </>
  );
}
