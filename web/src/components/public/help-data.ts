export type HelpCategory =
  | "account"
  | "privacy"
  | "chats"
  | "communities"
  | "content"
  | "stars"
  | "support";

export type HelpArticle = {
  slug: string;
  category: HelpCategory;
  title: string;
  summary: string;
  steps: string[];
  notes?: string[];
  keywords: string[];
};

export const HELP_CATEGORIES: { id: "all" | HelpCategory; label: string }[] = [
  { id: "all", label: "All topics" },
  { id: "account", label: "Account" },
  { id: "privacy", label: "Privacy" },
  { id: "chats", label: "Chats" },
  { id: "communities", label: "Communities" },
  { id: "content", label: "Posts" },
  { id: "stars", label: "Stars & gifts" },
  { id: "support", label: "Support" }
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "create-account",
    category: "account",
    title: "How to create an account",
    summary: "Sign up with your email and confirm with a one-time code.",
    steps: [
      "Open the \"Sign up\" page and enter a valid email address.",
      "Choose a password of at least 10 characters and submit the form.",
      "Enter the one-time code from the GRAM email. Never forward this code to anyone.",
      "Once confirmed, choose a username and name, then finish setting up your profile."
    ],
    notes: ["If the email doesn't arrive, check your \"Spam\" folder and wait for the timer to finish before requesting another one."],
    keywords: ["sign up", "email", "code", "otp", "account"]
  },
  {
    slug: "recover-password",
    category: "account",
    title: "How to recover your password",
    summary: "What to do when you still have an active session, and when you've lost access entirely.",
    steps: [
      "If GRAM is open on another device, go to your profile → edit → \"Security\" and change your password.",
      "Review the list of active sessions and end any unfamiliar devices.",
      "If there are no active sessions, open the support form, select \"Account access\" and provide your email and username.",
      "Wait while your connection to the account is verified. Don't send your old password, one-time codes or documents unless staff specifically request them."
    ],
    notes: ["Automatic password reset by email isn't enabled yet; support cannot tell you your existing password, because it is stored only as a hash."],
    keywords: ["forgot password", "recovery", "no access", "reset"]
  },
  {
    slug: "sessions-security",
    category: "account",
    title: "How to review and end active sessions",
    summary: "Devices, suspicious logins and keeping your account secure.",
    steps: [
      "Open your profile → edit → the \"Security\" tab.",
      "Review the browser, system, IP and last-active time of each session.",
      "End a single unfamiliar session, or all other sessions at once.",
      "Change your password if you don't recognize a login, and don't confirm unexpected email codes."
    ],
    keywords: ["sessions", "devices", "hacked", "security", "sign out"]
  },
  {
    slug: "multiple-accounts",
    category: "account",
    title: "How to switch between accounts",
    summary: "Several secure sessions in a single browser.",
    steps: [
      "Open the account switcher in your profile or on the login screen.",
      "Add a second account and sign in as usual with an email code.",
      "Pick a saved profile in the switcher; GRAM activates the matching server-side session.",
      "To remove an account from this device only, delete it from the switcher without deleting the profile itself."
    ],
    notes: ["Only the displayed account list is kept in localStorage — passwords and tokens are never stored there."],
    keywords: ["multiple accounts", "switching", "second profile"]
  },
  {
    slug: "hide-online-status",
    category: "privacy",
    title: "How to hide your \"online\" status",
    summary: "Turning off the online dot and your exact presence time.",
    steps: [
      "Open your profile and tap \"Edit\".",
      "Go to the \"Privacy\" tab.",
      "Turn off \"Show when I'm online\".",
      "Other users will see a general \"last seen recently\" status instead of your exact presence."
    ],
    keywords: ["hide status", "online", "privacy", "last seen recently"]
  },
  {
    slug: "private-account",
    category: "privacy",
    title: "How to make your account private",
    summary: "Controlling who sees your posts and stories.",
    steps: [
      "Open your profile → \"Edit\" → \"Privacy\".",
      "Turn on \"Private account\".",
      "New followers will send a request that you can accept or decline in your notifications.",
      "Review your older posts and profile details: your basic profile card stays visible, while your content is limited to followers."
    ],
    keywords: ["private account", "private profile", "requests", "followers"]
  },
  {
    slug: "message-privacy-block",
    category: "privacy",
    title: "Who can message you and how to block a user",
    summary: "Limiting new messages and blocking individual people.",
    steps: [
      "In the \"Privacy\" section, choose who can start a conversation with you.",
      "For a specific account, open its profile or the chat menu.",
      "Choose block and confirm the action.",
      "Once blocked, direct messages between the accounts are unavailable until you undo it."
    ],
    keywords: ["who can message", "block", "blocklist", "messages"]
  },
  {
    slug: "start-chat-group",
    category: "chats",
    title: "How to start a chat or create a group",
    summary: "Direct conversations, members and invite links.",
    steps: [
      "Open \"Chats\" and tap the new chat button.",
      "For a direct conversation, find a user by name or username.",
      "For a group, choose create group, add members and set a name.",
      "In the group info, configure visibility, invites and member permissions."
    ],
    keywords: ["chat", "group", "new conversation", "members", "invite"]
  },
  {
    slug: "manage-messages",
    category: "chats",
    title: "Replying to, editing, deleting and reporting a message",
    summary: "Actions in an individual message's menu.",
    steps: [
      "Open the message menu with a long press or the actions button.",
      "Choose to reply, react, copy, forward or open a discussion thread.",
      "You can edit your own messages, or delete them just for you or for everyone, when the action is available.",
      "For a violation, choose \"Report\" and briefly state the reason; for a complex legal case, use the separate support form."
    ],
    keywords: ["reply", "edit", "delete message", "report", "forward"]
  },
  {
    slug: "chat-folders-notifications",
    category: "chats",
    title: "Folders, archive and chat notifications",
    summary: "Organizing your conversation list without deleting history.",
    steps: [
      "Create a folder in the chats section and add the conversations you want.",
      "Pin an important chat, or move an inactive one to the archive.",
      "Mute notifications from the chat menu — unread messages will stay in the list.",
      "Clearing your local view and deleting history are different actions; read the confirmation carefully."
    ],
    keywords: ["folders", "archive", "pin", "notifications", "mute"]
  },
  {
    slug: "create-community",
    category: "communities",
    title: "How to create a channel or community",
    summary: "Name, address, description and access rules.",
    steps: [
      "Open the \"Communities\" section.",
      "Tap \"Create\" and enter a name and an available address.",
      "Choose public or private access and, if needed, set a subscription price.",
      "Once created, open \"Manage\" to add a description, cover, rules and a link."
    ],
    notes: ["In the interface, the general type of space is called a \"community\"; a public space with posts can be used as a channel."],
    keywords: ["create channel", "community", "public", "private", "address"]
  },
  {
    slug: "community-management",
    category: "communities",
    title: "How to manage a community",
    summary: "Posts, members, invites and transferring ownership.",
    steps: [
      "Open your community and the \"Manage\" section.",
      "Change the name, description, category, website and access settings.",
      "Review members and refresh the invite link if it has become public when you didn't want it to.",
      "Before deleting your account, transfer or delete the communities you own."
    ],
    keywords: ["channel management", "members", "invite", "owner"]
  },
  {
    slug: "publish-post",
    category: "content",
    title: "How to create a post",
    summary: "Text, images, video, a poll, music and scheduling.",
    steps: [
      "Open your feed, profile or community and tap create post.",
      "Add text and, if you like, images, a single video, a poll or a music link.",
      "Mark sensitive material before publishing.",
      "Publish right away, save a draft, or set a time if scheduling is available."
    ],
    keywords: ["post", "publication", "video", "poll", "draft", "schedule"]
  },
  {
    slug: "stories-sensitive-content",
    category: "content",
    title: "Stories and sensitive content",
    summary: "Short-form media, audience and content warnings.",
    steps: [
      "Add a story from your profile and choose an image or a supported video.",
      "Check who will be able to see it based on your account settings.",
      "For potentially shocking or adult material, use the sensitive content flag.",
      "Don't post intimate material of another person without their consent."
    ],
    keywords: ["story", "stories", "18+", "sensitive content"]
  },
  {
    slug: "report-content",
    category: "support",
    title: "How to report content or a profile",
    summary: "A quick built-in report and an extended legal form.",
    steps: [
      "For an ordinary violation, open the menu of the post, message, profile or community and choose \"Report\".",
      "Pick the closest reason and add a short explanation.",
      "For copyright, trademark, privacy or illegal content, open the public support form.",
      "Attach direct links, describe the right or harm involved, and keep your case number."
    ],
    keywords: ["report", "violation", "copyright", "dmca", "moderation"]
  },
  {
    slug: "stars-top-up",
    category: "stars",
    title: "How to top up Stars",
    summary: "Packages, the Telegram bot and confirming the transaction.",
    steps: [
      "Open \"Stars\" and choose a package.",
      "Check the number of in-app Stars and the price in the transaction's external currency.",
      "Go to the official bot from the order you created and confirm the payment.",
      "Return to your wallet: the paid order will appear in your history and be credited once."
    ],
    notes: ["Don't send money to payment details shared in a direct message. Use only the button created by the GRAM interface itself."],
    keywords: ["stars", "top up", "telegram", "payment", "wallet"]
  },
  {
    slug: "send-upgrade-gift",
    category: "stars",
    title: "How to buy, send and upgrade a gift",
    summary: "Design, recipient, anonymity and collectible traits.",
    steps: [
      "Open the gift catalog and choose an available design.",
      "Buy one for yourself, or choose a recipient and add a message.",
      "A new gift may be a plain one; the owner separately triggers an upgrade for the stated price.",
      "After the upgrade, the model, backdrop and symbol are locked in for that particular item."
    ],
    keywords: ["gift", "send", "upgrade", "model", "collection"]
  },
  {
    slug: "refund-payout",
    category: "stars",
    title: "Refunding or withdrawing Stars",
    summary: "When requests are available and why a review is required.",
    steps: [
      "Open your wallet history and find the related transaction.",
      "Use the available refund or withdrawal button and read the amount, rate and status.",
      "Enter accurate details; a wrong address or account can make the transaction irreversible.",
      "Track the status in your wallet. To dispute it, send a support request with the transaction number, without sharing any payment secrets."
    ],
    keywords: ["refund", "withdrawal", "payout", "transaction", "wallet"]
  },
  {
    slug: "contact-support",
    category: "support",
    title: "How to contact support",
    summary: "A technical question, account access, privacy or a legal complaint.",
    steps: [
      "Open the \"Report or contact\" form at the bottom of the site.",
      "Pick the exact category and provide a contact email.",
      "Describe the expected result, the actual behavior and the steps to reproduce it.",
      "Add direct links if the issue concerns content, and keep your GRAM-… number after submitting."
    ],
    notes: ["Never send your password, email code, full card number, seed phrase or private key."],
    keywords: ["support", "help", "request", "technical issue", "number"]
  },
  {
    slug: "compromised-account",
    category: "support",
    title: "What to do if your account is hacked",
    summary: "Urgent steps that don't involve sharing secrets with support.",
    steps: [
      "From a device that's still signed in, change your password immediately.",
      "End all other sessions in the \"Security\" section.",
      "Check your email, username, profile, communities and recent transactions.",
      "If you can't sign in, submit an \"Account access\" request with your original email and username."
    ],
    keywords: ["hack", "stolen account", "compromise", "suspicious login"]
  }
];

export const FAQ_ITEMS = [
  {
    question: "Is GRAM free?",
    answer: "The core account, feed, chat and community features are available without any required subscription. Individual Premium features, Stars, gifts or paid communities show their price before you confirm."
  },
  {
    question: "Why is every login confirmed with an email code?",
    answer: "Your password proves you know a secret, while the one-time code proves you have access to the linked mailbox. This reduces the risk of a login after a single password leak. The code must never be shared with anyone."
  },
  {
    question: "Do chats have end-to-end encryption?",
    answer: "Don't assume ordinary chats are end-to-end encrypted unless a specific screen explicitly says otherwise. Messages are stored by the server for delivery and syncing."
  },
  {
    question: "Can I hide my last-seen time?",
    answer: "Yes. Open your profile → edit → \"Privacy\" and turn off showing your online status. Others will see a general status."
  },
  {
    question: "What's the difference between a channel and a community?",
    answer: "In the GRAM interface, the base object is called a community. A public community with posts can be used as a channel, and a private one as an invite-only or subscription space."
  },
  {
    question: "Can a deleted account be restored?",
    answer: "No. Deleting an account is irreversible. Before confirming, transfer or delete your communities and save any material you need."
  },
  {
    question: "Are Stars money or cryptocurrency?",
    answer: "Stars are an in-app GRAM feature. Whether you can buy, refund or withdraw them depends on the specific transaction and the terms shown in the interface; they are not a bank deposit."
  },
  {
    question: "How do I report a copyright violation?",
    answer: "Open the support form, select \"Copyright\", and add direct links, a description of the original work, good-faith statements and an electronic signature. After submitting, keep your case number."
  },
  {
    question: "Will support ever ask for my password or code?",
    answer: "No. Verification may require your email, username, links and case number, but never your password, one-time code, seed phrase or private key."
  },
  {
    question: "How do I delete my data?",
    answer: "You can delete your account in settings after confirming with your password. For a separate data request, use the support form with the \"Privacy and personal data\" category."
  }
] as const;
