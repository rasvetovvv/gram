export type StarsWallet = {
  balance: number;
  currency: "STARS";
  updated_at: string;
  /**
   * Whether stars may be taken out right now.
   *
   * The Telegram half of a payout is settled by a person, so the way out can be closed. Absent on
   * older responses, which is read as open.
   */
  payouts_enabled?: boolean;
};

export type SocialUserCompact = {
  id?: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  verified?: boolean;
};

export type StarTransactionKind =
  | "credit"
  | "spend"
  | "refund"
  | "subscription"
  | "gift"
  | "transfer"
  | "welcome"
  | "top_up"
  | "transfer_sent"
  | "transfer_received"
  | "subscription_income"
  | "gift_sale"
  | "username_sale"
  // Purchases and their reversals, all of them Telegram Stars payments through GRAM's own bot.
  | "stars_telegram"
  | "stars_refund"
  | "stars_refund_reversed"
  | "username_purchase"
  | "username_offer_hold"
  | "username_offer_refund"
  | "gift_purchase"
  | "premium_purchase";

export type StarTransaction = {
  id: string;
  amount: number;
  balance_after: number;
  kind: StarTransactionKind;
  description: string;
  counterparty?: SocialUserCompact | null;
  entity_type?: string | null;
  entity_id?: string | null;
  correlation_id?: string | null;
  created_at: string;
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

export type CreatorTopPost = {
  id: string;
  content: string;
  views_count: number;
  likes_count: number;
  comments_count?: number;
  created_at?: string;
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
  top_posts: CreatorTopPost[];
};

export type CommunityMemberRole = "owner" | "admin" | "member" | "subscriber";

export type CommunityPerson = SocialUserCompact & {
  role?: CommunityMemberRole;
};

export type Community = {
  id: string;
  slug: string;
  name: string;
  title?: string;
  description: string;
  avatar_url?: string | null;
  cover_url?: string | null;
  members_count: number;
  posts_count: number;
  is_member: boolean;
  is_owner: boolean;
  /** Staff-granted, like a person's tick: a channel cannot claim or buy it. */
  is_verified?: boolean;
  is_paid: boolean;
  monthly_price: number;
  owner?: CommunityPerson | null;
  members?: CommunityPerson[];
  category?: string | null;
  location?: string | null;
  website_url?: string | null;
  created_at: string;
  /** Every handle that opens this channel, its own address first. */
  usernames?: string[];
};

/**
 * A channel post is a post.
 *
 * It used to be its own thin shape with no likes, comments or views, which meant a channel's
 * readers could not answer anything it said. Re-exported under the old name so call sites read
 * the same, and typed as the real thing so they get the whole card.
 */
export type { Post as CommunityPost } from "./types";

export type CreateCommunityInput = {
  title: string;
  slug: string;
  description: string;
  is_paid: boolean;
  monthly_price: number;
};

/** One story published by a channel; the shape the API's ProfileStoryOut returns. */
export type CommunityStory = {
  id: string;
  title: string;
  media_url: string;
  created_at: string;
  expires_at?: string | null;
  highlight: boolean;
};
