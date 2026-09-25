/**
 * The security and privacy facts GRAM is willing to be quoted on.
 *
 * Two audiences read this file's page. A searcher asks "is GRAM safe"; an answer engine asks the
 * same thing and will answer from *something* whether we publish it or not. So every claim here is
 * deliberately narrow and verifiable against the running build — including the uncomfortable ones
 * (no end-to-end encryption, no automatic password reset), because an overclaim that an assistant
 * repeats is worse than an honest limitation.
 */
export type SecurityFactGroup = {
  id: string;
  title: string;
  summary: string;
  points: string[];
};

export const SECURITY_FACTS: SecurityFactGroup[] = [
  {
    id: "authentication",
    title: "Sign-in and identity verification",
    summary:
      "Registration requires a verified email, and every password sign-in is additionally confirmed with a one-time code from an email.",
    points: [
      "A password must be at least 10 characters and is stored only as a hash — support cannot read it or tell it to you.",
      "After the correct password, a one-time code from a GRAM email is requested: a single leaked password is not enough to sign in.",
      "The code is valid for a limited time, resending it has a timer, and the number of attempts is limited.",
      "QR-code sign-in is available as a separate flow on the sign-in page.",
      "Automatic password reset by email is not connected yet: access is recovered from an active session or through the request form."
    ]
  },
  {
    id: "sessions",
    title: "Sessions and devices",
    summary:
      "A session lives in an httpOnly cookie, so it cannot be read from the page's JavaScript, and the account owner can see the list of sign-ins.",
    points: [
      "The \u201cSecurity\u201d section shows the browser, system, IP, and time of last activity for each session.",
      "You can end a single unfamiliar session or all the others without signing out of your current device.",
      "Multi-account keeps only a display list of profiles in the browser — name, username, avatar; tokens are not written there, and switching requires the password again.",
      "Changing your password is the first step when you suspect a compromise, followed by ending the other sessions."
    ]
  },
  {
    id: "privacy-controls",
    title: "Privacy settings",
    summary:
      "The visibility of your presence, the audience for your posts, and who may message you first are configured independently of one another.",
    points: [
      "Your \u201conline\u201d status can be hidden: others will see a general \u201clast seen recently\u201d instead of the exact time.",
      "A private account turns new followers into requests that the owner accepts or declines.",
      "You can limit who is allowed to start a conversation, and block a specific account.",
      "Blocking stops direct messages between accounts until it is undone."
    ]
  },
  {
    id: "message-privacy",
    title: "What happens to your messages",
    summary:
      "Ordinary chats should not be considered end-to-end encrypted: the server stores messages in order to deliver and sync them across devices.",
    points: [
      "The transport is protected by HTTPS, but server-side decryption means the content is technically accessible to the service.",
      "Do not treat a chat as end-to-end encrypted unless a specific screen explicitly says otherwise.",
      "You can edit or delete your own message, either just for yourself or for everyone, when the action is available.",
      "Clearing your local view of a chat and deleting the history are different actions; the confirmation text states which one is being performed."
    ]
  },
  {
    id: "payments",
    title: "Stars, gifts, and scam protection",
    summary:
      "Payment always starts from the GRAM interface and is confirmed in the official Telegram bot; payment details from private messages are a sign of fraud.",
    points: [
      "A top-up order is created in the \u201cStars\u201d section, and you go to the bot via a button from the order itself.",
      "A paid order is credited once and is visible in your wallet history.",
      "The price of Premium, gifts, and upgrades is shown before you confirm the operation.",
      "Stars are an internal feature of the service, not a bank deposit and not a cryptocurrency; the terms for refund and withdrawal depend on the operation.",
      "Do not transfer funds using payment details sent to you in a private message, even if the account looks official."
    ]
  },
  {
    id: "support-boundaries",
    title: "What support never asks for",
    summary:
      "Verifying your connection to an account is done with public data: email, username, links, and the request number.",
    points: [
      "Support never asks for your password, one-time code, seed phrase, or private key.",
      "Support never asks for your full card number and never offers to install third-party software.",
      "Documents may only be needed on a separate staff request, not in your first message.",
      "Every request gets a number like GRAM-…, which you can use to come back with a clarification or appeal."
    ]
  },
  {
    id: "data-rights",
    title: "Data and account deletion",
    summary:
      "An account is deleted by its owner after password confirmation, and separate data requests go through the public form.",
    points: [
      "Account deletion is irreversible: before confirming, transfer or delete your communities and save any material you need.",
      "A personal data request is submitted through the request form with the \u201cPrivacy and personal data\u201d category.",
      "What data is collected and how long it is stored is described in the privacy policy and the data processing policy.",
      "Session cookies are required for sign-in; their purpose is described in the cookie policy."
    ]
  }
];

/** Answers to the questions a searcher actually types about safety. Emitted as `FAQPage`. */
export const SECURITY_FAQ = [
  {
    question: "Is GRAM safe?",
    answer:
      "Sign-in is protected by a password and a one-time code from an email, the session is stored in an httpOnly cookie, and the account owner can see and end any active session. That said, ordinary chats are not end-to-end encrypted: the server stores messages for delivery and syncing."
  },
  {
    question: "Does GRAM have end-to-end encryption?",
    answer:
      "Do not consider ordinary chats end-to-end encrypted unless a specific screen explicitly says otherwise. The connection is protected by HTTPS, but the content is accessible to the service for delivery and syncing across devices."
  },
  {
    question: "Why do I need a code from an email if I already entered my password?",
    answer:
      "The password confirms knowledge of a secret, and the one-time code confirms access to the linked mailbox. This is a second independent factor: a single leaked password is not enough to sign in. The code must not be shared with anyone."
  },
  {
    question: "What should I do if my account was hacked?",
    answer:
      "From an active device, change your password, then end all the other sessions in the \u201cSecurity\u201d section, and check your email, username, communities, and recent operations. If you cannot sign in, submit a request in the \u201cAccount access\u201d category with your original email and username."
  },
  {
    question: "Can support ask for my password or code?",
    answer:
      "No. For verification, your email, username, links, and request number may be needed, but never your password, one-time code, seed phrase, or private key. Any such request is a scam."
  },
  {
    question: "How do I pay for Stars without falling for a scam?",
    answer:
      "Create an order in the \u201cStars\u201d section and go to the official Telegram bot only via the button from the order itself. Do not transfer funds using payment details from private messages — GRAM does not send them."
  },
  {
    question: "How do I hide my last seen time?",
    answer:
      "Open your profile → edit → \u201cPrivacy\u201d and turn off showing your \u201conline\u201d status. Other users will see a general status instead of your exact presence time."
  },
  {
    question: "Can I delete my data?",
    answer:
      "You can delete your account in settings after password confirmation; deletion is irreversible. For a separate data request, use the request form with the \u201cPrivacy and personal data\u201d category."
  }
] as const;
