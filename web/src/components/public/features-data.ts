/**
 * The feature catalogue, written for somebody deciding whether to sign up — and for the answer engine
 * they will ask first.
 *
 * `SITE_FEATURES` in `lib/seo.ts` is the one-line-per-capability version used in metadata. This is the
 * expanded form: what each area actually does, in prose a machine can quote without inventing detail.
 * Both are hand-checked against the running build; nothing here describes a screen that does not exist.
 */
export type FeatureGroup = {
  id: string;
  title: string;
  lead: string;
  bullets: string[];
  /** Where a reader continues — a how-to article, a policy, or the sign-up. */
  link?: { href: string; label: string };
};

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "chats",
    title: "Chats and messages",
    lead:
      "Direct and group conversations with attachments, replies, reactions, and forwarding. The conversation list is organized with folders, pinning, and an archive, while your history stays right where it is.",
    bullets: [
      "Attachments: images, video, documents, and voice messages with a caption, all in a single send.",
      "Reply, edit, delete for yourself or for everyone, forward, and start a discussion thread — all from the message menu.",
      "Reactions and live conversation updates with no page reload.",
      "Folders, pinning, an archive, and muting notifications for an individual chat.",
      "Chat appearance is customizable, and a message can be reported straight from its own menu."
    ],
    link: { href: "/help", label: "How to start a chat or create a group" }
  },
  {
    id: "feed",
    title: "Feed and posts",
    lead:
      "A post can include text, a gallery, video, a file, music, and a poll. Comments and reactions arrive live, so there is no need to reload the page.",
    bullets: [
      "Drafts are saved on the server, so a post you have started is not lost when you switch devices.",
      "Polls, music, and attached documents are available from the post composer menu.",
      "Reposting brings content into your own feed while keeping the original attribution.",
      "The author marks sensitive material (18+) themselves before posting.",
      "Bookmarks gather your saved posts in a separate section."
    ],
    link: { href: "/help", label: "How to create a post" }
  },
  {
    id: "communities",
    title: "Communities and channels",
    lead:
      "The core object is called a community. A public community with posts works like a channel, while a private one works like an invite-only or subscription space.",
    bullets: [
      "The name, address, description, cover, category, and website are set by the owner.",
      "Access can be public, invite-only, or paid by subscription.",
      "The invite link can be refreshed if it has spread more widely than intended.",
      "The owner can see members and manage roles; before deleting the account, communities must be transferred or removed.",
      "The “Explore” section helps you discover new communities and people."
    ],
    link: { href: "/help", label: "How to create a channel or community" }
  },
  {
    id: "stories",
    title: "Stories",
    lead:
      "Short posts with an image or video, available for a limited time. The audience is determined by the account's privacy settings.",
    bullets: [
      "A story is added from your profile and shown to followers according to how private the account is.",
      "You can reply to a story with a message.",
      "Potentially shocking or adult material must be marked as sensitive."
    ]
  },
  {
    id: "gifts",
    title: "Gifts, collections, and usernames",
    lead:
      "A collectible gift can be bought, sent, upgraded, and displayed on your profile. An available username can be reserved and listed on the market.",
    bullets: [
      "The gift catalog shows available designs and the price before you confirm.",
      "A gift is sent to a specific person with a message; the sender can stay anonymous.",
      "Upgrading is a separate action: afterward the model, backdrop, and symbol of the item are locked in.",
      "The username market grants no rights to anyone else's trademark or name."
    ],
    link: { href: "/help", label: "How to buy and upgrade a gift" }
  },
  {
    id: "stars",
    title: "Stars and Premium",
    lead:
      "Stars are an in-app balance for gifts, supporting creators, and some premium features. The core features of your account, chats, feed, and communities work without a subscription.",
    bullets: [
      "A top-up starts in the “Stars” section and is confirmed in the official Telegram bot via the button in your order.",
      "A paid order is credited once and appears in your wallet history.",
      "Refunds and withdrawals are available for individual transactions; the amount, rate, and status are shown before you confirm.",
      "Stars are not a bank deposit, money, or a cryptocurrency.",
      "GRAM Premium unlocks advanced features, and Studio provides creator tools and statistics."
    ],
    link: { href: "/help", label: "How to top up Stars" }
  },
  {
    id: "account",
    title: "Account, sign-in, and privacy",
    lead:
      "Registration requires a verified email, and every password sign-in is confirmed with a one-time code from an email. Privacy is configured separately from security.",
    bullets: [
      "Multi-account keeps several profiles in one browser; switching requires your password again.",
      "The active sessions list shows the browser, operating system, IP, and time of last activity.",
      "You can hide your “online” status, make your account private, and restrict who may message you first.",
      "QR-code sign-in is available as a separate flow on the login page."
    ],
    link: { href: "/security", label: "Security and privacy" }
  },
  {
    id: "moderation",
    title: "Moderation and reports",
    lead:
      "The community guidelines describe what content is allowed. A report is submitted from the content menu, while rights holders and people without an account can use a public form.",
    bullets: [
      "A quick report of a post, profile, message, or community — right from the content's own menu.",
      "The public form covers copyright (DMCA), trademarks, privacy, illegal content, impersonation, harassment, and fraud.",
      "Each report is assigned a reference like GRAM-…, which you can use to follow up with a clarification or an appeal.",
      "A personal-data request is submitted through the same form under the “Privacy” category."
    ],
    link: { href: "/report", label: "Submit a report" }
  }
];
