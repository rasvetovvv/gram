export type ProfileBadge = {
  id: string;
  slug: string;
  title: string;
  image_url: string | null;
  description: string;
  qualification: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  points: number;
  issued_at?: string;
  issuer?: string;
  visible_in_profile?: boolean;
};

export type User = {
  id: string;
  username: string;
  display_name: string;
  email?: string;
  avatar_url: string | null;
  cover_url?: string | null;
  bio: string;
  location?: string | null;
  joined_at: string;
  is_verified?: boolean;
  verified: boolean;
  /** Staff. Drawn as the V badge before the name; granted by GRAM and not claimable. */
  is_admin?: boolean;
  verification_tier?: "signal" | "creator" | "founder" | "official" | null;
  is_online: boolean;
  last_seen_at?: string | null;
  followers_count: number;
  following_count: number;
  posts_count?: number;
  related_usernames?: string[];
  badges?: ProfileBadge[];
  note?: string | null;
  can_edit_note?: boolean;
  is_me?: boolean;
  is_following?: boolean;
  is_subscribed?: boolean;
  /** Whether I have blocked them, so the menu can offer to undo it. */
  is_blocked?: boolean;
  /** The other direction: they blocked me, which is why their content is closed. */
  blocked_me?: boolean;
  interests?: string[];
  onboarding_complete?: boolean;
  featured_gift?: GiftSummary | null;
  name_gift?: GiftSummary | null;
  /** Up to four gifts over the cover, in slot order: the first is free, the rest are Premium. */
  cover_gifts?: GiftSummary[];
  stars_balance?: number;
  subscription_price_stars?: number | null;
  paid_subscription_enabled?: boolean;
  is_premium?: boolean;
  website_url?: string | null;
  birthday?: string | null;
  github_url?: string | null;
  telegram_url?: string | null;
  profile_song_title?: string | null;
  profile_song_artist?: string | null;
  profile_song_url?: string | null;
  featured_community_slug?: string | null;
  /** Up to three of the owner's own communities, in the order they chose. */
  featured_community_slugs?: string[];
  role_title?: string | null;
  profile_color?: string;
  streak_days?: number;
  is_official?: boolean;
  /** Presence the owner allows others to see; when hidden the UI says "недавно". */
  presence_hidden?: boolean;
  status_emoji?: string | null;
  status_text?: string | null;
  /** A closed account: the profile is readable, the content tabs are not. */
  is_private?: boolean;
  can_view_content?: boolean;
  /** I asked to follow a closed account and am waiting; pressing again withdraws the request. */
  follow_requested?: boolean;
  /** Only on my own profile: how many people are waiting for an answer. */
  follow_requests_count?: number;
};


export type PremiumBenefit = {
  slug: string;
  title: string;
  description: string;
  icon: string;
  soon: boolean;
};

export type PremiumLimit = {
  slug: string;
  title: string;
  free: number;
  premium: number;
};

export type PremiumPaymentMethod = {
  slug: string;
  title: string;
  subtitle: string;
  kind: "stars" | "card" | "crypto";
  available: boolean;
  badges: string[];
};

export type PremiumPlan = {
  plan: string;
  period_days: number;
  price_stars: number;
  price_fiat: number;
  fiat_currency: string;
  benefits: PremiumBenefit[];
  limits: PremiumLimit[];
  payment_methods: PremiumPaymentMethod[];
  entitlement: PremiumEntitlement | null;
  stars_balance: number;
};

export type PremiumEntitlement = {
  id: string;
  plan: "monthly";
  price_stars: number;
  active: boolean;
  started_at: string;
  expires_at: string;
  cancelled_at: string | null;
  /** Set when somebody else paid for it, so the sheet can name them. */
  gifted_by?: User | null;
};
/** One answer in a poll and how many people chose it. */
export type PollOption = { index: number; text: string; votes: number };

/** A poll as a reader sees it; `my_choice` is what decides buttons versus results. */
export type PostPoll = {
  options: PollOption[];
  total_votes: number;
  my_choice?: number | null;
};

/** A resolved music link, shaped like the card that draws it. */
export type PostMusic = {
  title: string;
  artist?: string | null;
  cover_url?: string | null;
  provider: "soundcloud";
  external_url: string;
  external_id?: string | null;
};

export type Post = {
  id: string;
  author: User;
  content: string;
  media_url?: string | null;
  /** Up to four pictures, in the order the author arranged them. */
  image_urls?: string[];
  /** One clip, played by our own player rather than the browser's default controls. */
  video_url?: string | null;
  /** The question this post asks, if it asks one. */
  poll?: PostPoll | null;
  /** An outbound link the author attached; opening it asks for confirmation first. */
  link_url?: string | null;
  link_title?: string | null;
  created_at: string;
  likes_count: number;
  comments_count: number;
  reposts_count: number;
  views_count?: number;
  /** Readers, as opposed to reads: the same person twice counts once here. */
  unique_views_count?: number;
  viewed_by_me?: boolean;
  music?: PostMusic | null;
  is_liked: boolean;
  liked_by_me?: boolean;
  like_count?: number;
  is_bookmarked?: boolean;
  is_reposted?: boolean;
  /** Set once the author has rewritten it, which is what draws «ред.» after the date. */
  edited_at?: string | null;
  /** The one post an author keeps at the top of their profile. */
  is_pinned?: boolean;
  /** Whether I switched off notifications about this post. */
  is_muted?: boolean;
  /** Stars this post earned, and whether I am among the people who sent them. */
  stars_count?: number;
  starred_by_me?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
  /** Set when the post was published into a community: the card is then the channel's. */
  community_slug?: string | null;
  community_title?: string | null;
  community_avatar_url?: string | null;
  community_verified?: boolean;
};

export type ChatKind = "direct" | "group" | "secret" | "saved";

export type Chat = {
  id: string;
  participant: User;
  peer?: User | null;
  title?: string | null;
  is_group?: boolean;
  kind?: ChatKind;
  avatar_url?: string | null;
  members_count?: number;
  last_message: string;
  last_message_detail?: Message | null;
  updated_at: string;
  unread_count: number;
  is_typing?: boolean;
  pinned?: boolean;
  archived?: boolean;
  marked_unread?: boolean;
  muted?: boolean;
  /** Seconds after which a message removes itself; 0 is off. */
  autodelete_seconds?: number;
  /** I blocked them: the composer becomes an "unblock" bar. */
  peer_blocked?: boolean;
  /** They blocked me: writing is refused, and the chat says so instead of failing silently. */
  blocked_by_peer?: boolean;
};

export type ChatMemberEntry = {
  user: User;
  joined_at: string;
  is_owner: boolean;
};

export type ChatLink = {
  url: string;
  message_id: string;
  sender_name: string;
  created_at: string;
};

export type ChatInfo = {
  chat: Chat;
  members: ChatMemberEntry[];
  links: ChatLink[];
  gifts: GiftSummary[];
  messages_count: number;
};

export type ChatFolder = {
  id: string;
  title: string;
  position: number;
  chat_ids: string[];
  chats_count: number;
  unread_count: number;
};

export type MessageQuote = {
  id: string;
  sender_name: string;
  content: string;
};

export type MessageReaction = {
  emoji: string;
  count: number;
  mine: boolean;
  users: User[];
};

export type Message = {
  id: string;
  chat_id: string;
  sender_id: string;
  /** The author, so a group preview can name who spoke. */
  sender: User;
  content: string;
  /** An attached picture; `content` reads as its caption. */
  media_url?: string | null;
  created_at: string;
  is_mine: boolean;
  /** Two ticks: everyone else in the chat has read past this message of mine. */
  read?: boolean;
  status?: "sent" | "delivered" | "read";
  edited_at?: string | null;
  pinned?: boolean;
  /** A pin and similar events arrive as messages and render as a centred notice. */
  service?: boolean;
  reactions?: MessageReaction[];
  /** Present when the message announces a gift; rendered as a card. */
  gift?: GiftSummary | null;
  /** A gift dropped into a group waits for the first member who presses the button. */
  gift_claimable?: boolean;
  gift_claimed_by?: User | null;
  reply_to?: MessageQuote | null;
  /** Set on a forwarded copy: whose words these originally were. */
  forwarded_from?: User | null;
};

export type UsernameAsset = {
  id: string;
  username: string;
  owner_username: string;
  owner?: User | null;
  status: "available" | "owned" | "reserved" | "listed";
  rarity: "standard" | "rare" | "unique" | "founder" | "common" | "legendary";
  price?: number | null;
  acquired_at: string;
  offers_count?: number;
  last_action?: string | null;
  last_action_at?: string | null;
  is_primary_handle?: boolean;
  is_owned_by_me?: boolean;
  /** The owner is keeping this handle and refuses offers on it. */
  offers_disabled?: boolean;
};

export type Gift = {
  id: string;
  name: string;
  slug: string;
  rarity: "rare" | "epic" | "legendary" | "mythic";
  serial_number: number;
  supply: number;
  image_url: string;
  owner_username: string;
  creator: string;
  acquired_at: string;
  edition_size?: number;
  description?: string;
  accent?: string;
  received_at?: string;
  is_owned_by_me?: boolean;
  model?: string;
  symbol?: string;
  background?: string;
  model_rarity_percent?: number;
  symbol_rarity_percent?: number;
  background_rarity_percent?: number;
  value_stars?: number;
  provenance_hash?: string;
  owner?: User;
  backdrop?: string;
  traits?: Record<string, string | number>;
  showcased_as?: "featured" | "name" | null;
  provenance?: GiftProvenanceEvent[];
  /** Drawing keys: the object, the pattern behind it, and the outer backdrop colour. */
  art?: string;
  pattern?: string;
  backdrop_edge?: string;
  design_slug?: string | null;
  category?: string | null;
  /** Who sent it, withheld when the buyer chose to stay anonymous. */
  sender?: User | null;
  sender_hidden?: boolean;
  message?: string | null;
  /** A plain gift carries no model yet; upgrading it for stars rolls model, backdrop and symbol. */
  upgraded_at?: string | null;
  upgraded?: boolean;
  upgrade_price_stars?: number;
  /** The rolled model's own name, denormalised so a compact embed can build an artwork URL. */
  model_name?: string;
  pattern_color?: string;
  /** Set while the owner is selling outright, which is what makes a one-tap buy possible. */
  sale_price_stars?: number | null;
  listed_at?: string | null;
  is_listed?: boolean;
  /** Owners curate their profile; a hidden item stays theirs but leaves the public grid. */
  hidden_in_profile?: boolean;
  /** Pinned items lead the collection, newest pin first. */
  is_pinned?: boolean;
  /** The owner said the item is not for sale, so offers on it are refused. */
  offers_disabled?: boolean;
  /** I am the one who gave it: opening it says so, even if I hid my name from the owner. */
  sent_by_me?: boolean;
};

export type GiftModel = {
  id: string;
  slug: string;
  name: string;
  description: string;
  image_url: string | null;
  accent: string;
  rarity: "rare" | "epic" | "legendary";
  price_stars: number;
  edition_size: number;
  minted: number;
  remaining: number;
  limited: boolean;
  on_market: boolean;
  sold_out: boolean;
  art?: string;
  pattern?: string;
  backdrop_edge?: string;
  category?: string;
  category_label?: string;
  models_count?: number;
  backdrops_count?: number;
  symbols_count?: number;
  resale_count?: number;
  resale_floor_stars?: number | null;
};

export type GiftVariant = { name: string; rarity_percent: number };

/** One purchase can mint a run of serials, so the result is always a list. */
export type GiftPurchaseResult = { gifts: Gift[]; spent_stars: number };

/** One minted copy its owner has put up for sale at a fixed price. */
export type GiftMarketItem = {
  gift_id: string;
  slug: string;
  design_slug: string;
  name: string;
  serial_number: number;
  edition_size: number;
  rarity: Gift["rarity"];
  accent: string;
  backdrop_edge: string;
  art: string;
  pattern: string;
  image_url: string | null;
  model: string | null;
  backdrop: string | null;
  symbol: string | null;
  price_stars: number;
  value_stars: number;
  owner: User;
  listed_at: string | null;
  is_mine: boolean;
};

export type GiftDesign = GiftModel & {
  models: GiftVariant[];
  backdrops: GiftVariant[];
  symbols: GiftVariant[];
  resale: GiftMarketItem[];
};

export type GiftCategory = { key: string; label: string; count: number };

export type GiftSummary = Pick<
  Gift,
  | "id"
  | "name"
  | "slug"
  | "rarity"
  | "serial_number"
  | "image_url"
  | "accent"
  | "art"
  | "pattern"
  | "backdrop_edge"
  | "upgraded"
  | "message"
>;

/** The account's own switches: who may see it, and what may interrupt it. */
/** Who may open a direct chat with me. Enforced by the server, not merely hidden in the UI. */
export type MessagePrivacy = "everyone" | "following" | "nobody";

export type FollowRequestEntry = { id: string; user: User; created_at: string };

export type AccountSettings = {
  show_online: boolean;
  private_account: boolean;
  who_can_message: MessagePrivacy;
  status_emoji: string | null;
  status_text: string | null;
  notify_likes: boolean;
  notify_comments: boolean;
  notify_follows: boolean;
  notify_gifts: boolean;
  notify_messages: boolean;
  notify_stars: boolean;
};

export type AuthSessionInfo = {
  id: string;
  created_at: string;
  expires_at: string;
  user_agent?: string | null;
  ip_address?: string | null;
  current: boolean;
};

/** An account this browser can switch into without signing in again. */
export type AccountSlot = {
  user: User;
  active: boolean;
  expires_at: string;
};

export type AuthSession = {
  user: User;
  access_expires_at: string;
};

export type RegisterInput = {
  email: string;
  password: string;
  username?: string;
  display_name?: string;
};

export type LoginInput = {
  identifier: string;
  password: string;
};

export type ProfileUpdateInput = {
  username?: string;
  display_name?: string;
  bio?: string;
  location?: string | null;
  avatar_url?: string | null;
  cover_url?: string | null;
  interests?: string[];
  onboarding_complete?: boolean;
  related_usernames?: string[];
  website_url?: string | null;
  birthday?: string | null;
  github_url?: string | null;
  telegram_url?: string | null;
  profile_song_title?: string | null;
  profile_song_artist?: string | null;
  profile_song_url?: string | null;
  featured_community_slug?: string | null;
  /** Up to three of the owner's own communities, in the order they chose. */
  featured_community_slugs?: string[];
  role_title?: string | null;
  profile_color?: string | null;
  streak_days?: number;
};

export type Trend = {
  tag: string;
  posts_count: number;
};

export type CommunityCompact = {
  slug: string;
  title: string;
  avatar_url: string | null;
  members_count: number;
  owner_verified: boolean;
};

export type SearchResults = {
  query: string;
  people: User[];
  communities: CommunityCompact[];
  tags: Trend[];
};

export type ProfileStory = {
  id: string;
  author: User;
  title: string;
  media_url: string;
  created_at: string;
  expires_at?: string | null;
  highlight: boolean;
};

export type ProfileStoryCreate = {
  title: string;
  media_url: string;
  highlight?: boolean;
  expires_at?: string | null;
};

export type ProfileReply = {
  id: string;
  post_id: string;
  author: User;
  content: string;
  created_at: string;
  parent_post: {
    id: string;
    author: User;
    content: string;
    image_url?: string | null;
    created_at: string;
  };
};

export type Comment = {
  id: string;
  post_id: string;
  author: User;
  content: string;
  created_at: string;
  edited_at?: string | null;
  /** Set on a reply: the comment it answers. */
  parent_id?: string | null;
  replies_count?: number;
  likes_count?: number;
  liked_by_me?: boolean;
  is_liked?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
};

export type FollowResult = {
  username: string;
  is_following: boolean;
  followers_count: number;
  following_count: number;
  /** A closed account turned the follow into a request that is now waiting for an answer. */
  requested?: boolean;
};

export type Subscription = {
  id: string;
  subscriber: User;
  creator: User;
  price_stars: number;
  active: boolean;
  started_at: string;
  current_period_ends: string;
  cancelled_at?: string | null;
};

export type GiftProvenanceEvent = {
  id: string | null;
  event: string;
  from_user?: User | null;
  to_user?: User | null;
  note?: string | null;
  occurred_at: string;
  provenance_hash?: string | null;
};

export type GiftOffer = {
  id: string;
  gift_id: string;
  buyer: User;
  seller: User;
  amount_stars: number;
  status: "pending" | "accepted" | "declined" | "cancelled";
  created_at: string;
  resolved_at?: string | null;
};

export type UsernameHistoryEvent = {
  id: string;
  action: string;
  from_user?: User | null;
  to_user?: User | null;
  price_stars?: number | null;
  created_at: string;
};

export type ToggleResult = { active: boolean; count: number };

export type StarWallet = {
  balance: number;
  currency: "STARS";
  updated_at: string;
};

export type StarTransaction = {
  id: string;
  amount: number;
  balance_after: number;
  kind: string;
  description: string;
  counterparty?: User | null;
  entity_type?: string | null;
  entity_id?: string | null;
  correlation_id: string;
  created_at: string;
};

export type StarTransferReceipt = {
  transfer_id: string;
  amount: number;
  balance: number;
  recipient: User;
};

export type CreatorSettings = {
  paid_subscription_enabled: boolean;
  monthly_price: number;
};

export type CreatorSeriesPoint = {
  date: string;
  views: number;
  followers: number;
  stars: number;
};

export type CreatorAnalytics = {
  period_days: number;
  balance: number;
  views: number;
  followers: number;
  earned: number;
  engagement: number;
  posts: number;
  sponsors: number;
  series: CreatorSeriesPoint[];
  top_posts: Post[];
};

export type Community = {
  id: string;
  slug: string;
  title: string;
  name: string;
  description: string;
  avatar_url?: string | null;
  cover_url?: string | null;
  owner: User;
  category?: string | null;
  location?: string | null;
  website_url?: string | null;
  is_private: boolean;
  members_count: number;
  is_member: boolean;
  is_owner: boolean;
  role?: "owner" | "admin" | "member" | "subscriber" | null;
  posts_count: number;
  is_paid: boolean;
  monthly_price: number;
  created_at: string;
};

export type CommunityCreateInput = {
  slug: string;
  title: string;
  description?: string;
  category?: string | null;
  location?: string | null;
  website_url?: string | null;
  is_private?: boolean;
};

export type CommunityPost = {
  id: string;
  community_id: string;
  author: User;
  content: string;
  image_url?: string | null;
  created_at: string;
};

export type Notification = {
  id: string;
  kind:
    | "message"
    | "follow"
    | "follow_request"
    | "like"
    | "comment"
    | "gift"
    | "username"
    | "subscription"
    | "community"
    | "stars"
    | "system";
  text: string;
  created_at: string;
  read: boolean;
  is_read?: boolean;
  actor?: User | null;
  entity_id?: string | null;
};

export type ApiValidationIssue = { msg?: string; loc?: Array<string | number>; type?: string };
export type ApiErrorShape = {
  detail?: string | ApiValidationIssue[];
  message?: string;
  code?: string;
};
