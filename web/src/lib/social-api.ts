import type {
  Community,
  CommunityPost,
  CommunityStory,
  CreateCommunityInput,
  CreatorAnalytics,
  CreatorSettings,
  StarTransaction,
  StarsWallet
} from "./social-types";

const SOCIAL_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type ApiErrorBody = { detail?: string; message?: string };

export type StarTransferReceipt = {
  transfer_id: string;
  amount: number;
  balance: number;
  recipient: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string | null;
  };
};

export class SocialApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SOCIAL_API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new SocialApiError(
      response.status,
      body.detail ?? body.message ?? "Не удалось выполнить действие. Попробуйте ещё раз."
    );
  }

  if (response.status === 204) return undefined as T;
  // The same normalization the main client does: a timestamp with no offset is UTC, and read
  // as local time it would be wrong by the reader's own offset.
  return normalizeTimestamps(await response.json()) as T;
}

const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;

function normalizeTimestamps(value: unknown): unknown {
  if (typeof value === "string") return NAIVE_TIMESTAMP.test(value) ? `${value}Z` : value;
  if (Array.isArray(value)) return value.map(normalizeTimestamps);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizeTimestamps(item)
      ])
    );
  }
  return value;
}

export const socialApi = {
  starsWallet: () => request<StarsWallet>("/api/stars/wallet"),
  starTransactions: () => request<StarTransaction[]>("/api/stars/transactions"),
  topUpStars: (amount: number) =>
    request<StarsWallet>("/api/stars/top-up", {
      method: "POST",
      body: JSON.stringify({ amount })
    }),
  sendStars: (toUsername: string, amount: number, message?: string) =>
    request<StarTransferReceipt>("/api/stars/send", {
      method: "POST",
      body: JSON.stringify({
        to_username: toUsername.replace(/^@/, ""),
        amount,
        message: message?.trim() || null
      })
    }),

  creatorSettings: () => request<CreatorSettings>("/api/creator/settings"),
  updateCreatorSettings: (settings: CreatorSettings) =>
    request<CreatorSettings>("/api/creator/settings", {
      method: "PATCH",
      body: JSON.stringify(settings)
    }),
  creatorAnalytics: () => request<CreatorAnalytics>("/api/creator/analytics"),

  communities: (query = "") => {
    const search = query.trim() ? `?search=${encodeURIComponent(query.trim())}` : "";
    return request<Community[]>(`/api/communities${search}`);
  },
  community: (slug: string) => request<Community>(`/api/communities/${encodeURIComponent(slug)}`),
  createCommunity: (input: CreateCommunityInput) =>
    request<Community>("/api/communities", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  joinCommunity: (slug: string) =>
    request<Community>(`/api/communities/${encodeURIComponent(slug)}/join`, { method: "POST" }),
  leaveCommunity: (slug: string) =>
    request<Community>(`/api/communities/${encodeURIComponent(slug)}/leave`, { method: "DELETE" }),
  communityPosts: (slug: string) =>
    request<CommunityPost[]>(`/api/communities/${encodeURIComponent(slug)}/posts`),
  /** The owner's own settings for their channel; the slug is fixed and not among them. */
  updateCommunity: (
    slug: string,
    patch: Partial<{
      title: string;
      description: string;
      category: string;
      location: string;
      website_url: string;
    }>
  ) =>
    request<Community>(`/api/communities/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  /** A story published into a channel the caller owns. */
  createCommunityStory: (slug: string, title: string, mediaUrl: string) =>
    request<CommunityStory>("/api/users/me/stories", {
      method: "POST",
      body: JSON.stringify({ title, media_url: mediaUrl, community_slug: slug })
    }),
  /** Stories the channel itself published, as opposed to its owner's own. */
  communityStories: (slug: string) =>
    request<CommunityStory[]>(`/api/communities/${encodeURIComponent(slug)}/stories`),
  /** Publishing into a channel takes the same payload as a personal post. */
  createCommunityPost: (
    slug: string,
    content: string,
    extra?: {
      imageUrls?: string[];
      videoUrl?: string | null;
      pollOptions?: string[] | null;
      link?: { url?: string; title?: string };
    }
  ) =>
    request<CommunityPost>(`/api/communities/${encodeURIComponent(slug)}/posts`, {
      method: "POST",
      body: JSON.stringify({
        content,
        image_url: extra?.imageUrls?.[0],
        image_urls: extra?.imageUrls?.length ? extra.imageUrls : undefined,
        video_url: extra?.videoUrl || undefined,
        poll_options: extra?.pollOptions?.length ? extra.pollOptions : undefined,
        link_url: extra?.link?.url || undefined,
        link_title: extra?.link?.title || undefined
      })
    })
};
