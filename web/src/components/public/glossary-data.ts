/**
 * The vocabulary GRAM uses for itself.
 *
 * An answer engine asked "what is a community in GRAM" has to either find a definition or guess, and
 * a guess borrows meaning from a different product — which is exactly how "channel" ends up described
 * with Telegram's semantics instead of ours. Every entry here is emitted as a `DefinedTerm`, so the
 * definition is quotable rather than inferred.
 *
 * `alternateName` carries the words a person actually types (stories, copyright, DMCA), which is what
 * turns a definition into a search match.
 */
export type GlossaryTerm = {
  slug: string;
  term: string;
  definition: string;
  alternateName?: string[];
  /** Where the reader goes to act on the term. */
  readMore?: { href: string; label: string };
};

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    slug: "gram",
    term: "GRAM",
    definition:
      "A social messenger at vexory.xyz: private and group chats, a feed of posts, communities and channels, stories, collectible gifts, a username market, and an internal Stars balance in a single web app.",
    alternateName: ["GRAM", "GRAM messenger", "vexory.xyz"],
    readMore: { href: "/about", label: "About the service" }
  },
  {
    slug: "community",
    term: "Community",
    definition:
      "The basic building block for a group space in GRAM. It can be public or private, with posts or without; the owner manages members, roles, access rules, and the subscription price.",
    alternateName: ["community", "group space"],
    readMore: { href: "/help", label: "How to create a community" }
  },
  {
    slug: "channel",
    term: "Channel",
    definition:
      "Not a separate object type, but a way of using a community: a public community with posts and subscribers works like a channel. In the interface, such a space is still called a community.",
    alternateName: ["channel"],
    readMore: { href: "/faq", label: "How a channel differs from a community" }
  },
  {
    slug: "story",
    term: "Story",
    definition:
      "A short post with an image or video, available for a limited time. A story's audience is set by the account's privacy settings; sensitive material has to be marked.",
    alternateName: ["stories", "story"]
  },
  {
    slug: "collectible-gift",
    term: "Collectible gift",
    definition:
      "A digital item you can buy, send to another person, upgrade, and display on your profile. After an upgrade, the model, backdrop, and symbol of a specific copy are locked in.",
    alternateName: ["gift", "collectible"],
    readMore: { href: "/help", label: "How to send and upgrade a gift" }
  },
  {
    slug: "upgrade",
    term: "Gift upgrade",
    definition:
      "A separate paid operation the owner starts after the purchase: it turns an ordinary gift into a collectible copy with a fixed model, backdrop, and symbol.",
    alternateName: ["upgrade"]
  },
  {
    slug: "username",
    term: "Username",
    definition:
      "The public address of an account or community. A free username can be reserved and put up on the market; doing so grants no rights to someone else's trademark or name.",
    alternateName: ["username", "handle", "@name"],
    readMore: { href: "/creator-terms", label: "Creator terms" }
  },
  {
    slug: "stars",
    term: "Stars",
    definition:
      "GRAM's internal balance for gifts, supporting creators, and some premium features. Stars are not a bank deposit, money, or cryptocurrency; the terms for purchase, refund, and withdrawal are shown in the interface of each specific operation.",
    alternateName: ["stars", "internal currency"],
    readMore: { href: "/help", label: "How to top up Stars" }
  },
  {
    slug: "premium",
    term: "GRAM Premium",
    definition:
      "A paid subscription with extended features. The basic account, chat, feed, and community features work without it; the price is always shown before you confirm.",
    alternateName: ["premium", "subscription"]
  },
  {
    slug: "studio",
    term: "Studio",
    definition:
      "The creator tools section: managing posts and communities, statistics, and monetization settings.",
    alternateName: ["studio", "creator dashboard"]
  },
  {
    slug: "session",
    term: "Active session",
    definition:
      "A sign-in to your account from a specific device and browser. The session list shows the browser, system, IP, and time of last activity; any session can be ended individually, or all the others at once.",
    alternateName: ["devices", "session", "device sign-in"],
    readMore: { href: "/security", label: "How to check your sessions" }
  },
  {
    slug: "email-code",
    term: "Email code",
    definition:
      "A one-time code from a GRAM email that confirms password sign-in and registration. The code confirms access to the linked mailbox and is never shared with anyone, including support.",
    alternateName: ["OTP", "one-time code", "code from email"],
    readMore: { href: "/security", label: "How sign-in works" }
  },
  {
    slug: "private-account",
    term: "Private account",
    definition:
      "A privacy mode in which new followers send a request and content is limited to confirmed followers. The basic profile card stays accessible.",
    alternateName: ["private profile", "follow requests"]
  },
  {
    slug: "report",
    term: "Request",
    definition:
      "A submission sent through the public form: a content complaint, a rights holder request, a personal data question, an account access problem, or a technical bug. Every request gets a number like GRAM-…",
    alternateName: ["complaint", "ticket", "request"],
    readMore: { href: "/report", label: "Submit a request" }
  },
  {
    slug: "dmca",
    term: "DMCA complaint",
    definition:
      "A rights holder's report of copyright infringement. It requires direct links to the material, a description of the original work, a good-faith statement, and an electronic signature.",
    alternateName: ["copyright", "authors' rights", "copyright"],
    readMore: { href: "/report?type=copyright", label: "Rights holder form" }
  },
  {
    slug: "sensitive-content",
    term: "Sensitive content",
    definition:
      "Material an author marks as potentially shocking or adult (18+) before publishing. The mark hides the material behind a warning; it does not override community rules.",
    alternateName: ["18+", "NSFW", "sensitivity mark"],
    readMore: { href: "/community-guidelines", label: "Community guidelines" }
  }
];
