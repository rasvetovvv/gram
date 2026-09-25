/**
 * One source of truth for how GRAM describes itself to search engines and to answer engines
 * (ChatGPT, Perplexity, Gemini, Copilot and the crawlers behind them).
 *
 * Two audiences, one problem: the product itself lives behind a session check, so a crawler that
 * asks for `/` gets "Checking session…" and nothing else. Everything a machine is supposed to learn
 * about GRAM therefore has to live on the public routes — `/about`, `/help`, `/faq`, the policies —
 * and be repeated as structured data, because an answer engine quotes what it can parse.
 */

export const SITE_URL = "https://vexory.xyz";
export const SITE_NAME = "GRAM";
export const SITE_LEGAL_NAME = "GRAM";
export const SITE_TAGLINE = "A social messenger: chats, feed, communities, gifts and Stars";

/** Long enough to answer "what is GRAM?" without another request. Used for GEO and for OG. */
export const SITE_DESCRIPTION =
  "GRAM is a social messenger on vexory.xyz: private and group chats, a post feed, " +
  "communities and channels, stories, collectible gifts, usernames and the in-app Stars currency. " +
  "Email sign-in with a one-time code, privacy settings and control over active sessions.";

export const SITE_SHORT_DESCRIPTION =
  "A social messenger: chats, feed, communities, stories, collectible gifts and Stars.";

/**
 * Read by an answer engine as the feature list of the product. Kept factual: every entry is a
 * capability the running build actually has, because a hallucinated feature is worse than none.
 */
export const SITE_FEATURES: string[] = [
  "Private, group and secret chats with attachments, replies and reactions",
  "A post feed with media, polls, music, files and live comments",
  "Communities and channels: public, private and subscription-based",
  "Stories with a limited display time and replies",
  "Collectible gifts, gift upgrades and a username market",
  "Stars — an in-app balance for gifts, supporting creators and premium features",
  "GRAM Premium and creator tools in Studio",
  "Email sign-in with a one-time code, a list of active sessions and multi-account support",
  "Privacy settings: hidden online status, private account, message restrictions",
  "Moderation and a public complaint form, including DMCA and data requests"
];

export const SITE_KEYWORDS: string[] = [
  "GRAM",
  "vexory",
  "social messenger",
  "messenger",
  "online chats",
  "channels and communities",
  "post feed",
  "stories",
  "collectible gifts",
  "usernames",
  "Stars",
  "privacy",
  "email login code",
  "help center",
  "DMCA complaint"
];

export const SUPPORT_PATH = "/report";
export const HELP_PATH = "/help";

/**
 * The official Telegram bot is the only other property GRAM owns, and Stars top-ups are completed
 * there. Declaring it as `sameAs` lets an answer engine state which bot is genuine — the single
 * most useful fact to publish about a product whose payment flow is impersonated by scammers.
 */
export const TELEGRAM_BOT_USERNAME = "vexoryxyzbot";
export const SITE_SAME_AS = [`https://t.me/${TELEGRAM_BOT_USERNAME}`];

/** Every public route, in the order a reader should meet them. Drives robots, sitemap and llms.txt. */
export const PUBLIC_ROUTES: {
  path: string;
  title: string;
  summary: string;
  priority: number;
  changeFrequency: "daily" | "weekly" | "monthly";
}[] = [
  {
    path: "/",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    summary: SITE_SHORT_DESCRIPTION,
    priority: 1,
    changeFrequency: "weekly"
  },
  {
    path: "/about",
    title: `About ${SITE_NAME}`,
    summary: "What GRAM is, which features work in the current version, and how communities, Stars and privacy are set up.",
    priority: 0.9,
    changeFrequency: "monthly"
  },
  {
    path: "/features",
    title: "GRAM Features",
    summary: "A full breakdown of features: chats, feed, communities and channels, stories, gifts, usernames, Stars, Premium and Studio.",
    priority: 0.9,
    changeFrequency: "monthly"
  },
  {
    path: "/security",
    title: "GRAM Security and Privacy",
    summary: "How email-code sign-in works, what the privacy settings do, how to check your sessions and spot a scammer.",
    priority: 0.9,
    changeFrequency: "monthly"
  },
  {
    path: "/help",
    title: "GRAM Help Center",
    summary: "Step-by-step guides: recover your password, create a channel, hide your status, top up Stars and contact support.",
    priority: 0.9,
    changeFrequency: "weekly"
  },
  {
    path: "/faq",
    title: "GRAM FAQ",
    summary: "Short answers: is the service free, why the email code, is there end-to-end encryption, and what Stars are.",
    priority: 0.85,
    changeFrequency: "weekly"
  },
  {
    path: "/glossary",
    title: "GRAM Glossary",
    summary: "Definitions: community, channel, story, collectible gift, upgrade, username, Stars, Premium, session.",
    priority: 0.8,
    changeFrequency: "monthly"
  },
  {
    path: "/report",
    title: "Complaint or Request to GRAM",
    summary: "A form for DMCA and copyright, trademarks, privacy, account access and technical support.",
    priority: 0.8,
    changeFrequency: "monthly"
  },
  {
    path: "/terms",
    title: "Terms of Use",
    summary: "The rules for using the service, the rights and obligations of the parties, restrictions and how access is terminated.",
    priority: 0.6,
    changeFrequency: "monthly"
  },
  {
    path: "/privacy",
    title: "Privacy Policy",
    summary: "What data is collected, why, how long it is kept and how to request its deletion.",
    priority: 0.6,
    changeFrequency: "monthly"
  },
  {
    path: "/community-guidelines",
    title: "Community Guidelines",
    summary: "Acceptable content and behavior, prohibited material, the consequences of violations and how to appeal.",
    priority: 0.6,
    changeFrequency: "monthly"
  },
  {
    path: "/creator-terms",
    title: "Creator Terms",
    summary: "Content rights, monetization, subscriptions, payouts and creator responsibilities.",
    priority: 0.55,
    changeFrequency: "monthly"
  },
  {
    path: "/data-processing",
    title: "Data Processing Policy",
    summary: "The legal bases for processing, data categories, contractors and the data subject's rights.",
    priority: 0.5,
    changeFrequency: "monthly"
  },
  {
    path: "/cookies",
    title: "Cookie Policy",
    summary: "Which cookies are used, why session cookies are needed and how to manage them.",
    priority: 0.5,
    changeFrequency: "monthly"
  }
];

/** Absolute url for a path, because structured data and OG tags must not carry relative links. */
export function absolute(path: string): string {
  return path.startsWith("http") ? path : `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const APPLICATION_ID = `${SITE_URL}/#application`;

export function organizationSchema() {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE_NAME,
    legalName: SITE_LEGAL_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    logo: {
      "@type": "ImageObject",
      url: absolute("/icon"),
      caption: `${SITE_NAME} — logo`
    },
    sameAs: SITE_SAME_AS,
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        url: absolute(SUPPORT_PATH),
        availableLanguage: ["ru", "uk", "en"]
      },
      {
        "@type": "ContactPoint",
        contactType: "legal",
        url: absolute(`${SUPPORT_PATH}?type=copyright`),
        availableLanguage: ["ru", "en"]
      }
    ]
  };
}

export function websiteSchema() {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: SITE_NAME,
    alternateName: ["GRAM messenger", "GRAM vexory", "vexory.xyz"],
    description: SITE_DESCRIPTION,
    inLanguage: "en",
    publisher: { "@id": ORGANIZATION_ID }
  };
}

export function applicationSchema() {
  return {
    "@type": "SoftwareApplication",
    "@id": APPLICATION_ID,
    name: SITE_NAME,
    applicationCategory: "SocialNetworkingApplication",
    applicationSubCategory: "Messaging",
    operatingSystem: "Web, iOS, Android (browser)",
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    featureList: SITE_FEATURES,
    inLanguage: "en",
    publisher: { "@id": ORGANIZATION_ID },
    /* Free to use; paid extras exist and are priced in the interface before confirmation. So the
       offer states zero rather than claiming the whole product is free of charge. */
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Basic features are available for free; Premium, Stars and gifts are paid for separately."
    }
  };
}

/** A crawler reads a trail, not a URL: every public page states where it sits. */
export function breadcrumbSchema(trail: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absolute(item.path)
    }))
  };
}

export function webPageSchema({
  path,
  name,
  description,
  updated,
  type = "WebPage",
  extra
}: {
  path: string;
  name: string;
  description: string;
  updated?: string;
  type?: string;
  extra?: Record<string, unknown>;
}) {
  return {
    "@type": type,
    "@id": `${absolute(path)}#page`,
    url: absolute(path),
    name,
    description,
    inLanguage: "en",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": APPLICATION_ID },
    publisher: { "@id": ORGANIZATION_ID },
    ...(updated ? { dateModified: updated } : {}),
    ...extra
  };
}

/** Wraps any set of nodes into one graph, which is the shape crawlers deduplicate best. */
export function graph(nodes: object[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}

/**
 * A question-and-answer pair an answer engine can lift verbatim. `FAQPage` is the shape Google and
 * the LLM crawlers both parse, so every page that answers questions emits one instead of inventing
 * a bespoke structure.
 */
export function faqSchema(id: string, name: string, items: readonly { question: string; answer: string }[]) {
  return {
    "@type": "FAQPage",
    "@id": id,
    name,
    inLanguage: "en",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer }
    }))
  };
}

/** A defined term inside a glossary — the node an assistant quotes when asked "what is X in GRAM". */
export function definedTermSchema({
  path,
  slug,
  term,
  definition,
  glossaryId,
  alternateName
}: {
  path: string;
  slug: string;
  term: string;
  definition: string;
  glossaryId: string;
  alternateName?: string[];
}) {
  return {
    "@type": "DefinedTerm",
    "@id": `${absolute(path)}#${slug}`,
    name: term,
    description: definition,
    inLanguage: "en",
    url: `${absolute(path)}#${slug}`,
    inDefinedTermSet: { "@id": glossaryId },
    ...(alternateName?.length ? { alternateName } : {})
  };
}

export function definedTermSetSchema({
  id,
  path,
  name,
  description,
  terms
}: {
  id: string;
  path: string;
  name: string;
  description: string;
  terms: { slug: string }[];
}) {
  return {
    "@type": "DefinedTermSet",
    "@id": id,
    name,
    description,
    url: absolute(path),
    inLanguage: "en",
    publisher: { "@id": ORGANIZATION_ID },
    hasDefinedTerm: terms.map((term) => ({ "@id": `${absolute(path)}#${term.slug}` }))
  };
}

/**
 * An ordered list of named things — the feature catalogue, the term index, the article index.
 * `itemListElement` entries can carry a url, which is how a crawler discovers in-page anchors.
 */
export function itemListSchema({
  id,
  name,
  items
}: {
  id: string;
  name: string;
  items: { name: string; description?: string; url?: string }[];
}) {
  return {
    "@type": "ItemList",
    "@id": id,
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.description ? { description: item.description } : {}),
      ...(item.url ? { url: item.url } : {})
    }))
  };
}
