export type StarsWallet = {
  balance: number;
  currency: "STARS";
  updated_at: string;
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
  | "username_sale";

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
  is_paid: boolean;
  monthly_price: number;
  owner?: CommunityPerson | null;
  members?: CommunityPerson[];
  category?: string | null;
  location?: string | null;
  website_url?: string | null;
  created_at: string;
};

export type CommunityPost = {
  id: string;
  community_id: string;
  author: CommunityPerson;
  content: string;
  image_url?: string | null;
  created_at: string;
};

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
