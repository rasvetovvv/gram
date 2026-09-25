import type {
  AccountSettings,
  AccountSlot,
  AdminAction,
  AdminCommunity,
  AdminDesign,
  AdminInventory,
  AdminLedgerEntry,
  AdminOverview,
  AdminPayout,
  AdminRefund,
  AdminStarOrder,
  AnonymousNumber,
  NumberCheck,
  NumberHistoryEvent,
  AdminUser,
  ApiErrorShape,
  AuthSession,
  AuthStart,
  AuthSessionInfo,
  EmailAuthChallenge,
  Chat,
  ChatFolder,
  ChatInfo,
  Comment,
  Community,
  CommunityCreateInput,
  CommunityPost,
  CreatorAnalytics,
  CreatorSettings,
  FollowRequestEntry,
  FollowResult,
  Gift,
  GiftCategory,
  GiftDesign,
  GiftMarketItem,
  GiftModel,
  GiftPurchaseResult,
  GiftOffer,
  GroupInvitePreview,
  GiftProvenanceEvent,
  LegalReport,
  LegalReportInput,
  LegalReportReceipt,
  LoginInput,
  Message,
  MyBadges,
  Notification,
  Post,
  PostDraft,
  PostDraftInput,
  ProfileBadge,
  ProfileReply,
  ProfileStory,
  ProfileStoryCreate,
  ProfileUpdateInput,
  RegisterInput,
  Report,
  SearchResults,
  StarTransaction,
  StarOrder,
  StarPackage,
  StarPayout,
  StarTransferReceipt,
  StarWallet,
  StoryFeedEntry,
  StoryViewer,
  Subscription,
  PremiumEntitlement,
  PremiumPlan,
  ToggleResult,
  Trend,
  User,
  UsernameAsset,
  UsernameHistoryEvent,
  UsernameOffer,
  VerificationTier
} from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://vexory.xyz";

/** The reference's own three orders over one thread. */
export type CommentSort = "new" | "old" | "top";

/** Where a gift can be put on display: four places on the cover, and beside the name. */
export type ShowcaseSlot = "featured" | "cover2" | "cover3" | "cover4" | "name";

/** The reference's own list of reasons a post can be reported for. */
export type PostReportReason = "spam" | "abuse" | "adult" | "fraud" | "violence" | "other";

export type GiftCatalogScope = "all" | "market" | "limited" | "available" | "resale";
export type AdminUserScope = "all" | "banned" | "admins" | "verified" | "reported";
export type ReportAction = "dismiss" | "note" | "hide" | "ban";
export type AdminUserPatch = {
  display_name?: string;
  bio?: string;
  location?: string | null;
  role_title?: string | null;
  profile_color?: string;
  is_verified?: boolean;
  verification_tier?: VerificationTier | null;
  is_admin?: boolean;
  reason?: string;
};
export type AdminCommunityPatch = {
  title?: string;
  description?: string;
  category?: string;
  location?: string;
  reason?: string;
};
export type AdminGiftPatch = {
  model?: string;
  backdrop?: string;
  symbol?: string;
  upgraded?: boolean;
  reason?: string;
};
export type AdminDesignPatch = {
  edition_size?: number;
  price_stars?: number;
  available?: boolean;
  on_market?: boolean;
  limited?: boolean;
  reason?: string;
};
export type AdminAccountDeleteInput = {
  confirm_username: string;
  reason: string;
  communities?: "transfer" | "delete";
};export type GiftCatalogSort = "position" | "price-asc" | "price-desc" | "rarity" | "supply";
export type GiftMarketSort = "recent" | "price-asc" | "price-desc";

/**
 * Artwork lives behind our own API, not on the source CDN.
 *
 * The proxy caches each asset on first use, so the catalogue keeps rendering when
 * api.changes.tg is slow or gone — one of the reference product's asset URLs went 404 within
 * two days. `.tgs` comes back as gzip-encoded Lottie JSON, which the browser inflates itself.
 */
export type GiftArtFormat = "tgs" | "png";
export type GiftArtSize = 64 | 128 | 256 | 512;

/** Mirrors the server's slug rule, so `Witch's Secret` resolves to `witchs-secret`. */
export function giftArtSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function artUrl(path: string, format: GiftArtFormat, size?: GiftArtSize) {
  const params = new URLSearchParams({ ext: format });
  if (format === "png" && size) params.set("size", String(size));
  return `${API_URL}/api/gifts/art/${path}?${params}`;
}

/**
 * The sticker for an item or a design: the rolled model when there is one, otherwise the
 * design's own artwork, which is what a storefront tile shows.
 */
export function giftStickerUrl(
  design: string,
  model: string | null | undefined,
  format: GiftArtFormat,
  size?: GiftArtSize
) {
  const slug = giftArtSlug(design);
  if (!slug) return null;
  return model
    ? artUrl(`model/${slug}/${giftArtSlug(model)}`, format, size)
    : artUrl(`original/${slug}`, format, size);
}

/** One symbol, tiled behind the object as the pattern layer. */
export function giftSymbolUrl(design: string, symbol: string | null | undefined, size: GiftArtSize = 64) {
  const slug = giftArtSlug(design);
  if (!slug || !symbol) return null;
  return artUrl(`symbol/${slug}/${giftArtSlug(symbol)}`, "png", size);
}

export type GiftCatalogQuery = {
  scope?: GiftCatalogScope;
  category?: string;
  q?: string;
  sort?: GiftCatalogSort;
};

/** Usernames arrive from routes, links and pasted text, so `@` and casing are normalized here. */
export function normalizeUsername(value: string) {
  return decodeURIComponent(value).trim().replace(/^@+/, "").toLowerCase();
}

function userPath(username: string) {
  return encodeURIComponent(normalizeUsername(username));
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public payload?: ApiErrorShape
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function errorMessage(body: ApiErrorShape): string {
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail)) {
    const messages = body.detail
      .map((item) => (typeof item === "object" && item && "msg" in item ? String(item.msg) : ""))
      .filter(Boolean);
    if (messages.length) return messages.join(". ");
  }
  return body.message ?? "Couldn't reach GRAM. Check your connection and try again.";
}

/**
 * A timestamp with no zone, which the API means as UTC.
 *
 * `new Date("2026-08-19T21:49:16")` is read as *local* time by every browser, so a post
 * published a second ago appeared three hours old to anyone east of Greenwich. Postgres returns
 * the offset and this never matches; SQLite drops it, and the whole product was wrong by the
 * reader's own offset.
 */
const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;

function normalizePayload(value: unknown): unknown {
  if (typeof value === "string" && NAIVE_TIMESTAMP.test(value)) return `${value}Z`;
  return withAbsoluteMedia(value);
}

function withAbsoluteMedia(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("/media/")) return `${API_URL}${value}`;
  if (Array.isArray(value)) return value.map(normalizePayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizePayload(item)
      ])
    );
  }
  return value;
}

const AUTH_PATHS = ["/api/auth/login", "/api/auth/register", "/api/auth/refresh", "/api/auth/logout"];
let refreshInFlight: Promise<boolean> | null = null;
/** When the last refresh settled, so a straggler does not start a second one immediately. */
let refreshedAt = 0;
/** Long enough to absorb requests that were already in flight when the rotation happened. */
const REFRESH_COOLDOWN_MS = 3_000;

/**
 * One shared refresh, and no second one for a moment afterwards.
 *
 * Every screen holds several queries, and when the access cookie expires they all get a 401 within
 * the same few hundred milliseconds. Sharing the in-flight promise covers the ones that arrive
 * together; the cooldown covers the ones whose 401 was already on the wire when the rotation
 * completed — those used to fire a second refresh carrying the token just spent, which the server
 * reads as a reused credential. It answers `true` because the cookie is, in fact, fresh.
 */
async function refreshAccess(): Promise<boolean> {
  if (!refreshInFlight && Date.now() - refreshedAt < REFRESH_COOLDOWN_MS) return true;
  refreshInFlight ??= fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    credentials: "include"
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshedAt = Date.now();
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await send(path, init);

  // The access cookie is short-lived, so an expired session is refreshed once and retried
  // instead of surfacing a raw 401 in the middle of an action.
  if (response.status === 401 && !AUTH_PATHS.includes(path) && (await refreshAccess())) {
    response = await send(path, init);
  }

  const raw = response.status === 204 ? "" : await response.text();
  let body: unknown = undefined;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = undefined;
    }
  }

  if (!response.ok) {
    const errorBody = (body && typeof body === "object" ? body : {}) as ApiErrorShape;
    throw new ApiError(response.status, errorMessage(errorBody), errorBody);
  }

  return normalizePayload(body) as T;
}

async function restoreSession(): Promise<User> {
  try {
    return await request<User>("/api/auth/me");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    /* `request` has already tried a refresh and retried once by the time a 401 gets here, so a
       second explicit refresh would send the token that attempt just spent — the reuse the server
       is right to be suspicious of. The session really is over. */
    throw error;
  }
}

export function isEmailAuthChallenge(value: AuthStart): value is EmailAuthChallenge {
  return "requires_email_code" in value && value.requires_email_code === true;
}

export const api = {
  submitLegalReport: (payload: LegalReportInput) =>
    request<LegalReportReceipt>("/api/legal/reports", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  register: (payload: RegisterInput) =>
    request<AuthStart>("/api/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  login: (payload: LoginInput) =>
    request<AuthStart>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  verifyEmailCode: (challengeId: string, code: string) =>
    request<AuthSession>("/api/auth/email/verify", {
      method: "POST",
      body: JSON.stringify({ challenge_id: challengeId, code })
    }),
  resendEmailCode: (challengeId: string) =>
    request<EmailAuthChallenge>("/api/auth/email/resend", {
      method: "POST",
      body: JSON.stringify({ challenge_id: challengeId })
    }),
  refreshSession: () => request<AuthSession>("/api/auth/refresh", { method: "POST" }),
  authMe: () => request<User>("/api/auth/me"),
  restoreSession,
  logout: () => request<{ detail: string }>("/api/auth/logout", { method: "POST" }),
  authSessions: () => request<AuthSessionInfo[]>("/api/auth/sessions"),
  authAccounts: () => request<AccountSlot[]>("/api/auth/accounts"),
  activateAccount: (userId: string) =>
    request<AuthSession>(`/api/auth/accounts/${encodeURIComponent(userId)}/activate`, {
      method: "POST"
    }),
  removeAccount: (userId: string) =>
    request<{ detail: string }>(`/api/auth/accounts/${encodeURIComponent(userId)}`, {
      method: "DELETE"
    }),
  revokeOtherSessions: () =>
    request<{ detail: string }>("/api/auth/sessions", { method: "DELETE" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ detail: string }>("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
    }),
  deleteAccount: (password: string) =>
    request<{ detail: string }>("/api/users/me", {
      method: "DELETE",
      body: JSON.stringify({ password })
    }),

  currentUser: () => request<User>("/api/users/me"),
  updateCurrentUser: (payload: ProfileUpdateInput) =>
    request<User>("/api/users/me", { method: "PATCH", body: JSON.stringify(payload) }),
  uploadAvatar: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<User>("/api/users/me/avatar", { method: "POST", body });
  },
  uploadCover: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<User>("/api/users/me/cover", { method: "POST", body });
  },
  profile: (username: string) => request<User>(`/api/users/${userPath(username)}`),
  badges: () => request<ProfileBadge[]>("/api/badges"),
  badge: (slug: string) => request<ProfileBadge>(`/api/badges/${encodeURIComponent(slug)}`),
  userBadges: (username: string) => request<ProfileBadge[]>(`/api/users/${userPath(username)}/badges`),
  /** The whole shelf: every badge, whether it is earned, and how many fit at once. */
  myBadges: () => request<MyBadges>("/api/users/me/badges"),
  chooseBadges: (slugs: string[]) =>
    request<User>("/api/users/me/badges", { method: "PUT", body: JSON.stringify({ slugs }) }),

  recommendedUsers: () => request<User[]>("/api/users/recommended"),
  trends: (limit = 8) => request<Trend[]>(`/api/trends?limit=${limit}`),
  search: (query: string) => request<SearchResults>(`/api/search?q=${encodeURIComponent(query)}`),
  follow: (username: string) =>
    request<FollowResult>(`/api/users/${userPath(username)}/follow`, { method: "POST" }),
  unfollow: (username: string) =>
    request<FollowResult>(`/api/users/${userPath(username)}/follow`, { method: "DELETE" }),
  mySettings: () => request<AccountSettings>("/api/users/me/settings"),
  /** Who is waiting to be let into a closed account. */
  followRequests: () => request<FollowRequestEntry[]>("/api/users/me/follow-requests"),
  acceptFollowRequest: (id: string) =>
    request<FollowResult>(`/api/users/me/follow-requests/${id}`, { method: "POST" }),
  declineFollowRequest: (id: string) =>
    request<{ detail: string }>(`/api/users/me/follow-requests/${id}`, { method: "DELETE" }),
  updateMySettings: (patch: Partial<AccountSettings>) =>
    request<AccountSettings>("/api/users/me/settings", {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  blockUser: (username: string) =>
    request<{ detail: string }>(`/api/users/${userPath(username)}/block`, { method: "POST" }),
  unblockUser: (username: string) =>
    request<{ detail: string }>(`/api/users/${userPath(username)}/block`, { method: "DELETE" }),
  followers: (username: string) =>
    request<User[]>(`/api/users/${userPath(username)}/followers`),
  following: (username: string) =>
    request<User[]>(`/api/users/${userPath(username)}/following`),
  profileStories: (username: string) =>
    request<ProfileStory[]>(`/api/users/${userPath(username)}/stories`),
  createProfileStory: (payload: ProfileStoryCreate) =>
    request<ProfileStory>("/api/users/me/stories", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  deleteProfileStory: (storyId: string) =>
    request<{ detail: string }>(`/api/users/me/stories/${encodeURIComponent(storyId)}`, {
      method: "DELETE"
    }),
  /** One picture or clip for a story being composed; the server decides which from the bytes. */
  uploadStoryMedia: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ url: string }>("/api/users/me/stories/media", { method: "POST", body });
  },
  /** Live stories from the people the reader follows, grouped by author. */
  storiesFeed: () => request<StoryFeedEntry[]>("/api/stories/feed"),
  markStorySeen: (storyId: string) =>
    request<{ detail: string }>(`/api/stories/${encodeURIComponent(storyId)}/view`, {
      method: "POST"
    }),
  storyViewers: (storyId: string) =>
    request<StoryViewer[]>(`/api/stories/${encodeURIComponent(storyId)}/viewers`),
  /** Send a story — anyone's — into conversations, with an optional line of one's own. */
  shareStory: (storyId: string, chatIds: string[], text = "") =>
    request<{ detail: string }>(`/api/stories/${encodeURIComponent(storyId)}/share`, {
      method: "POST",
      body: JSON.stringify({ chat_ids: chatIds, text })
    }),
  profileReplies: (username: string) =>
    request<ProfileReply[]>(`/api/users/${userPath(username)}/replies`),
  subscribe: (username: string, priceStars = 50) =>
    request<Subscription>(`/api/users/${userPath(username)}/subscribe`, {
      method: "POST",
      body: JSON.stringify({ price_stars: priceStars })
    }),
  unsubscribe: (username: string) =>
    request<Subscription>(`/api/users/${userPath(username)}/subscribe`, {
      method: "DELETE"
    }),
  updateShowcase: (payload: { featured_gift_id?: string | null; name_gift_id?: string | null }) =>
    request<User>("/api/users/me/showcase", { method: "PATCH", body: JSON.stringify(payload) }),
  saveProfileNote: (content: string) =>
    request<{ content: string | null; updated_at: string }>("/api/users/me/note", {
      method: "PUT",
      body: JSON.stringify({ content })
    }),

  feed: (options: { mode?: "for_you" | "following"; author?: string; hashtag?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (options.mode) search.set("mode", options.mode);
    if (options.author) search.set("author", options.author);
    if (options.hashtag) search.set("hashtag", options.hashtag);
    if (options.limit) search.set("limit", String(options.limit));
    const query = search.toString();
    return request<Post[]>(`/api/feed${query ? `?${query}` : ""}`);
  },
  bookmarkedPosts: () => request<Post[]>("/api/feed/bookmarks"),
  createPost: (
    content: string,
    imageUrls?: string[],
    link?: { url: string; title?: string } | null,
    videoUrl?: string | null,
    pollOptions?: string[] | null,
    sensitive?: boolean,
    file?: { url: string; name: string; size: number } | null,
    /* Anything that is not part of what a post *is*. `publishAt` queues it: an ISO moment in the
       future keeps the post to its author until then, and Premium is what may set one. */
    options?: { publishAt?: string | null }
  ) =>
    request<Post>("/api/feed", {
      method: "POST",
      body: JSON.stringify({
        content,
        publish_at: options?.publishAt || undefined,
        image_url: imageUrls?.[0],
        image_urls: imageUrls?.length ? imageUrls : undefined,
        video_url: videoUrl || undefined,
        poll_options: pollOptions?.length ? pollOptions : undefined,
        sensitive: sensitive || undefined,
        file_url: file?.url,
        file_name: file?.name,
        file_size: file?.size,
        link_url: link?.url || undefined,
        link_title: link?.title || undefined
      })
    }),
  /** Stores one picture for a post being written and returns where it landed. */
  uploadPostMedia: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ url: string }>("/api/feed/media", { method: "POST", body });
  },
  /** The same for one clip; the container is checked from its own bytes, not its name. */
  uploadPostVideo: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ url: string }>("/api/feed/video", { method: "POST", body });
  },
  /** One document. PDF, ZIP and plain text only, and always served back as a download. */
  uploadPostFile: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ url: string; name: string; size: number; kind: string }>("/api/feed/file", {
      method: "POST",
      body
    });
  },
  deletePost: (id: string) => request<{ detail: string }>(`/api/feed/${id}`, { method: "DELETE" }),
  /** Rewrites one's own post; the server re-reads the text for a music link and marks «edited». */
  editPost: (
    id: string,
    content: string,
    link?: { url?: string; title?: string },
    sensitive?: boolean
  ) =>
    request<Post>(`/api/feed/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        content,
        link_url: link?.url || undefined,
        link_title: link?.title || undefined,
        sensitive
      })
    }),
  /** One's own unfinished posts, most recently touched first. */
  postDrafts: () => request<PostDraft[]>("/api/feed/drafts"),
  /** My own queue: written, waiting for its moment, invisible to everybody else. */
  scheduledPosts: () => request<Post[]>("/api/feed/scheduled"),
  /** Move a queued post to another moment, or send it out now by passing null. */
  reschedulePost: (id: string, publishAt: string | null) =>
    request<Post>(`/api/feed/${id}/schedule`, {
      method: "PATCH",
      body: JSON.stringify({ publish_at: publishAt })
    }),
  savePostDraft: (payload: PostDraftInput) =>
    request<PostDraft>("/api/feed/drafts", { method: "POST", body: JSON.stringify(payload) }),
  updatePostDraft: (id: string, payload: PostDraftInput) =>
    request<PostDraft>(`/api/feed/drafts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deletePostDraft: (id: string) =>
    request<{ detail: string }>(`/api/feed/drafts/${id}`, { method: "DELETE" }),
  /** Answers a poll. One vote per person, and the server refuses the second. */
  voteInPoll: (id: string, optionIndex: number) =>
    request<Post>(`/api/feed/${id}/poll/${optionIndex}`, { method: "POST" }),
  pinPost: (id: string, pinned: boolean) =>
    request<Post>(`/api/feed/${id}/pin`, { method: pinned ? "POST" : "DELETE" }),
  /** Switches notifications about one post on or off, without leaving the conversation. */
  mutePost: (id: string, muted: boolean) =>
    request<{ detail: string }>(`/api/feed/${id}/mute`, { method: muted ? "POST" : "DELETE" }),
  reportPost: (id: string, reason: PostReportReason, comment?: string) =>
    request<{ detail: string }>(`/api/feed/${id}/report`, {
      method: "POST",
      body: JSON.stringify({ reason, comment: comment?.trim() || undefined })
    }),
  /** A complaint about an account, on the same terms as one about a post. */
  /** A complaint about a conversation, one message in it, or a community. */
  reportChat: (chatId: string, reason: PostReportReason, comment?: string) =>
    request<{ detail: string }>(`/api/chats/${chatId}/report`, {
      method: "POST",
      body: JSON.stringify({ reason, comment: comment?.trim() || undefined })
    }),
  reportMessage: (
    chatId: string,
    messageId: string,
    reason: PostReportReason,
    comment?: string
  ) =>
    request<{ detail: string }>(`/api/chats/${chatId}/messages/${messageId}/report`, {
      method: "POST",
      body: JSON.stringify({ reason, comment: comment?.trim() || undefined })
    }),
  reportCommunity: (slug: string, reason: PostReportReason, comment?: string) =>
    request<{ detail: string }>(`/api/communities/${encodeURIComponent(slug)}/report`, {
      method: "POST",
      body: JSON.stringify({ reason, comment: comment?.trim() || undefined })
    }),
  reportUser: (username: string, reason: PostReportReason, comment?: string) =>
    request<{ detail: string }>(`/api/users/${encodeURIComponent(username)}/report`, {
      method: "POST",
      body: JSON.stringify({ reason, comment: comment?.trim() || undefined })
    }),
  likePost: (id: string) => request<Post>(`/api/feed/${id}/like`, { method: "POST" }),
  comments: (postId: string, sort: CommentSort = "new") =>
    request<Comment[]>(`/api/feed/${postId}/comments?sort=${sort}`),
  createComment: (postId: string, content: string, parentId?: string | null) =>
    request<Comment>(`/api/feed/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content, parent_id: parentId ?? null })
    }),
  editComment: (postId: string, commentId: string, content: string) =>
    request<Comment>(`/api/feed/${postId}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ content })
    }),
  deleteComment: (postId: string, commentId: string) =>
    request<{ detail: string }>(`/api/feed/${postId}/comments/${commentId}`, {
      method: "DELETE"
    }),
  likeComment: (postId: string, commentId: string) =>
    request<Comment>(`/api/feed/${postId}/comments/${commentId}/like`, { method: "POST" }),
  post: (postId: string) => request<Post>(`/api/feed/${postId}`),
  /** Reports that a post was actually on screen; returns the counters it moved. */
  recordPostView: (postId: string) =>
    request<{ recorded: boolean; views_count: number; unique_views_count: number }>(
      `/api/feed/${postId}/view`,
      { method: "POST" }
    ),
  bookmarkPost: (postId: string) =>
    request<ToggleResult>(`/api/feed/${postId}/bookmark`, { method: "POST" }),
  removePostBookmark: (postId: string) =>
    request<ToggleResult>(`/api/feed/${postId}/bookmark`, { method: "POST" }),
  repost: (postId: string) => request<ToggleResult>(`/api/feed/${postId}/repost`, { method: "POST" }),

  chats: () => request<Chat[]>("/api/chats"),
  chatFolders: () => request<ChatFolder[]>("/api/chats/folders"),
  createChatFolder: (title: string) =>
    request<ChatFolder>("/api/chats/folders", { method: "POST", body: JSON.stringify({ title }) }),
  deleteChatFolder: (id: string) =>
    request<{ detail: string }>(`/api/chats/folders/${id}`, { method: "DELETE" }),
  addChatToFolder: (folderId: string, chatId: string) =>
    request<ChatFolder>(`/api/chats/folders/${folderId}/chats/${chatId}`, { method: "PUT" }),
  removeChatFromFolder: (folderId: string, chatId: string) =>
    request<ChatFolder>(`/api/chats/folders/${folderId}/chats/${chatId}`, { method: "DELETE" }),
  directChat: (username: string) =>
    request<Chat>(`/api/chats/direct/${userPath(username)}`, { method: "POST" }),
  secretChat: (username: string) =>
    request<Chat>(`/api/chats/secret/${userPath(username)}`, { method: "POST" }),
  savedChat: () => request<Chat>("/api/chats/saved", { method: "POST" }),
  createGroupChat: (title: string, members: string[], isPublic = false) =>
    request<Chat>("/api/chats/groups", {
      method: "POST",
      body: JSON.stringify({ title, members, is_public: isPublic })
    }),
  /** Open a group to its link, or close it — the link dies with the group's privacy. */
  updateGroupAccess: (chatId: string, isPublic: boolean) =>
    request<Chat>(`/api/chats/${chatId}/access`, {
      method: "PATCH",
      body: JSON.stringify({ is_public: isPublic })
    }),
  /** A fresh link; the previous one stops working. */
  rotateGroupInvite: (chatId: string) =>
    request<Chat>(`/api/chats/${chatId}/invite`, { method: "POST" }),
  groupInvite: (code: string) =>
    request<GroupInvitePreview>(`/api/chats/join/${encodeURIComponent(code)}`),
  joinGroupByInvite: (code: string) =>
    request<Chat>(`/api/chats/join/${encodeURIComponent(code)}`, { method: "POST" }),
  updateGroupChat: (chatId: string, patch: { title?: string; avatar_url?: string | null }) =>
    request<Chat>(`/api/chats/${chatId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  addGroupMembers: (chatId: string, members: string[]) =>
    request<Chat>(`/api/chats/${chatId}/members`, {
      method: "POST",
      body: JSON.stringify({ members })
    }),
  removeGroupMember: (chatId: string, username: string) =>
    request<{ detail: string }>(`/api/chats/${chatId}/members/${userPath(username)}`, {
      method: "DELETE"
    }),
  chatInfo: (chatId: string) => request<ChatInfo>(`/api/chats/${chatId}/info`),
  updateChatState: (
    chatId: string,
    patch: { pinned?: boolean; archived?: boolean; marked_unread?: boolean; muted?: boolean }
  ) => request<Chat>(`/api/chats/${chatId}/state`, { method: "PATCH", body: JSON.stringify(patch) }),
  setChatAutodelete: (chatId: string, seconds: 0 | 86400 | 604800 | 2592000) =>
    request<Chat>(`/api/chats/${chatId}/autodelete`, {
      method: "PATCH",
      body: JSON.stringify({ seconds })
    }),
  deleteChat: (chatId: string) =>
    request<{ detail: string }>(`/api/chats/${chatId}`, { method: "DELETE" }),
  readAllChats: () => request<{ detail: string }>("/api/chats/read-all", { method: "POST" }),
  /**
   * Say this conversation has been read up to now.
   *
   * Opening the thread already does it; this is for a message that arrives *while* it is open,
   * which reaches the browser over the socket and never touches the endpoint that fetches it.
   * The socket carries the same signal — this is the fallback for a dropped connection.
   */
  markChatRead: (chatId: string) =>
    request<{ detail: string }>(`/api/chats/${chatId}/read`, { method: "POST" }),
  messages: (chatId: string) => request<Message[]>(`/api/chats/${chatId}/messages`),
  sendMessage: (chatId: string, content: string, replyToId?: string | null) =>
    request<Message>(`/api/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, reply_to_id: replyToId ?? null })
    }),
  /** A picture with the text beside it as its caption; `FormData` sets its own content type. */
  sendMessageMedia: (chatId: string, file: File, caption: string, replyToId?: string | null) => {
    const body = new FormData();
    body.append("file", file);
    body.append("caption", caption);
    if (replyToId) body.append("reply_to_id", replyToId);
    return request<Message>(`/api/chats/${chatId}/messages/media`, { method: "POST", body });
  },
  editMessage: (chatId: string, messageId: string, content: string) =>
    request<Message>(`/api/chats/${chatId}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content })
    }),
  deleteMessage: (chatId: string, messageId: string, scope: "me" | "all") =>
    request<{ detail: string }>(`/api/chats/${chatId}/messages/${messageId}?scope=${scope}`, {
      method: "DELETE"
    }),
  forwardMessages: (chatId: string, messageIds: string[], chatIds: string[]) =>
    request<{ detail: string }>(`/api/chats/${chatId}/messages/forward`, {
      method: "POST",
      body: JSON.stringify({ message_ids: messageIds, chat_ids: chatIds })
    }),
  toggleReaction: (chatId: string, messageId: string, emoji: string) =>
    request<Message>(`/api/chats/${chatId}/messages/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji })
    }),
  pinMessage: (chatId: string, messageId: string) =>
    request<Message>(`/api/chats/${chatId}/messages/${messageId}/pin`, { method: "POST" }),
  sendChatGift: (
    chatId: string,
    payload: {
      slug: string;
      to_username?: string | null;
      claimable?: boolean;
      message?: string | null;
      hide_my_name?: boolean;
    }
  ) =>
    request<Message>(`/api/chats/${chatId}/gifts`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  claimChatGift: (chatId: string, messageId: string) =>
    request<Message>(`/api/chats/${chatId}/messages/${messageId}/claim-gift`, { method: "POST" }),

  starsWallet: () => request<StarWallet>("/api/stars/wallet"),
  starTransactions: (limit = 100) =>
    request<StarTransaction[]>(`/api/stars/transactions?limit=${encodeURIComponent(limit)}`),
  topUpStars: (amount: number) =>
    request<StarWallet>("/api/stars/top-up", {
      method: "POST",
      body: JSON.stringify({ amount })
    }),
  /** What a top-up costs in Telegram Stars: our prices, Telegram's charge. */
  starPackages: () => request<StarPackage[]>("/api/stars/packages"),
  /** Open an order and get the deep link that pays for it inside the bot. */
  createStarOrder: (packageSlug: string) =>
    request<StarOrder>("/api/stars/orders", {
      method: "POST",
      body: JSON.stringify({ package: packageSlug })
    }),
  starOrder: (id: string) => request<StarOrder>(`/api/stars/orders/${id}`),
  starOrders: (limit = 10) => request<StarOrder[]>(`/api/stars/orders?limit=${limit}`),
  cancelStarOrder: (id: string) =>
    request<{ detail: string }>(`/api/stars/orders/${id}`, { method: "DELETE" }),
  /** Ask for a payment back. Nothing moves until an admin answers in Telegram. */
  requestStarRefund: (id: string, reason: string) =>
    request<StarOrder>(`/api/stars/orders/${id}/refund`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  /* Taking stars out, at the same rate they came in. The stars are held the moment the request
     is made and an admin confirms the Telegram half — see `payout-sheet.tsx`. */
  starPayouts: () => request<StarPayout[]>("/api/stars/payouts"),
  requestStarPayout: (stars: number, telegramUsername?: string) =>
    request<StarPayout>("/api/stars/payouts", {
      method: "POST",
      body: JSON.stringify({
        stars,
        telegram_username: telegramUsername?.trim() ? telegramUsername.trim() : null
      })
    }),
  cancelStarPayout: (id: string) =>
    request<StarPayout>(`/api/stars/payouts/${id}`, { method: "DELETE" }),
  sendStars: (toUsername: string, amount: number, message?: string, postId?: string) =>
    request<StarTransferReceipt>("/api/stars/send", {
      method: "POST",
      body: JSON.stringify({ to_username: toUsername, amount, message, post_id: postId })
    }),
  subscriptions: () => request<Subscription[]>("/api/subscriptions"),
  premium: () => request<PremiumEntitlement | null>("/api/premium"),
  premiumPlan: () => request<PremiumPlan>("/api/premium/plan"),
  purchasePremium: () => request<PremiumEntitlement>("/api/premium/purchase", { method: "POST", body: JSON.stringify({ plan: "monthly" }) }),
  giftPremium: (username: string) =>
    request<PremiumEntitlement>("/api/premium/gift", {
      method: "POST",
      body: JSON.stringify({ username, plan: "monthly" })
    }),
  creatorSettings: () => request<CreatorSettings>("/api/creator/settings"),
  updateCreatorSettings: (payload: Partial<CreatorSettings>) =>
    request<CreatorSettings>("/api/creator/settings", {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  creatorAnalytics: (periodDays = 30) =>
    request<CreatorAnalytics>(`/api/creator/analytics?period_days=${encodeURIComponent(periodDays)}`),

  communities: () => request<Community[]>("/api/communities"),
  /** Only the communities this account owns — what the profile may put on its page. */
  myCommunities: () => request<Community[]>("/api/communities?mine=true"),
  createCommunity: (payload: CommunityCreateInput) =>
    request<Community>("/api/communities", { method: "POST", body: JSON.stringify(payload) }),
  community: (slug: string) => request<Community>(`/api/communities/${encodeURIComponent(slug)}`),
  joinCommunity: (slug: string) =>
    request<Community>(`/api/communities/${encodeURIComponent(slug)}/join`, { method: "POST" }),
  leaveCommunity: (slug: string) =>
    request<Community>(`/api/communities/${encodeURIComponent(slug)}/leave`, { method: "DELETE" }),
  communityPosts: (slug: string) =>
    request<CommunityPost[]>(`/api/communities/${encodeURIComponent(slug)}/posts`),
  createCommunityPost: (slug: string, content: string, imageUrl?: string) =>
    request<CommunityPost>(`/api/communities/${encodeURIComponent(slug)}/posts`, {
      method: "POST",
      body: JSON.stringify({ content, image_url: imageUrl })
    }),

  usernames: () => request<UsernameAsset[]>("/api/usernames"),
  usernameLookup: (username: string) =>
    request<UsernameAsset>(`/api/usernames/lookup?username=${userPath(username)}`),
  activateUsername: (id: string) =>
    request<User>(`/api/usernames/${id}/activate`, { method: "POST" }),
  reserveUsername: (username: string) =>
    request<UsernameAsset>("/api/usernames/reserve", {
      method: "POST",
      body: JSON.stringify({ username })
    }),
  updateListing: (id: string, forSale: boolean, price?: number) =>
    request<UsernameAsset>(`/api/usernames/${id}/listing`, {
      method: "PATCH",
      body: JSON.stringify({ for_sale: forSale, price })
    }),
  usernameHistory: (id: string) =>
    request<UsernameHistoryEvent[]>(`/api/usernames/${id}/history`),
  // Anonymous +888 numbers: a market that mirrors usernames.
  numbers: () => request<AnonymousNumber[]>("/api/numbers"),
  checkNumber: (number: string) =>
    request<NumberCheck>(`/api/numbers/check?number=${encodeURIComponent(number)}`),
  buyNumber: (number: string) =>
    request<AnonymousNumber>("/api/numbers/buy", {
      method: "POST",
      body: JSON.stringify({ number })
    }),
  buyListedNumber: (id: string) =>
    request<AnonymousNumber>(`/api/numbers/${id}/buy-listed`, { method: "POST" }),
  updateNumberListing: (id: string, forSale: boolean, price?: number) =>
    request<AnonymousNumber>(`/api/numbers/${id}/listing`, {
      method: "PATCH",
      body: JSON.stringify({ for_sale: forSale, price })
    }),
  releaseNumber: (id: string) =>
    request<AnonymousNumber>(`/api/numbers/${id}`, { method: "DELETE" }),
  numberHistory: (id: string) =>
    request<NumberHistoryEvent[]>(`/api/numbers/${id}/history`),
  purchaseUsername: (id: string) =>
    request<UsernameAsset>(`/api/usernames/${id}/purchase`, { method: "POST" }),
  /** Say once that a handle is not for sale — and refuse the bids already standing on it. */
  updateUsernameOffersPolicy: (id: string, offersDisabled: boolean) =>
    request<UsernameAsset>(`/api/usernames/${id}/offers`, {
      method: "PATCH",
      body: JSON.stringify({ offers_disabled: offersDisabled })
    }),
  /** Bid on somebody's handle. The stars are held until they answer. */
  offerForUsername: (id: string, amount: number) =>
    request<UsernameOffer>(`/api/usernames/${id}/offers`, {
      method: "POST",
      body: JSON.stringify({ amount })
    }),
  usernameOffers: (id: string) => request<UsernameOffer[]>(`/api/usernames/${id}/offers`),
  myUsernameOffers: () => request<UsernameOffer[]>("/api/usernames/me/offers"),
  acceptUsernameOffer: (offerId: string) =>
    request<UsernameAsset>(`/api/usernames/offers/${offerId}/accept`, { method: "POST" }),
  declineUsernameOffer: (offerId: string) =>
    request<UsernameOffer>(`/api/usernames/offers/${offerId}/decline`, { method: "POST" }),
  withdrawUsernameOffer: (offerId: string) =>
    request<{ detail: string }>(`/api/usernames/offers/${offerId}`, { method: "DELETE" }),
  /** Hand a handle over without a price. */
  transferUsername: (id: string, toUsername: string) =>
    request<UsernameAsset>(`/api/usernames/${id}/transfer`, {
      method: "POST",
      body: JSON.stringify({ to_username: toUsername })
    }),
  /**
   * Give a handle up. It goes back on the shelf for anyone to register, and the collection gets its
   * place back — the only way out that does not need a buyer or a willing recipient.
   */
  releaseUsername: (id: string) =>
    request<UsernameAsset>(`/api/usernames/${id}`, { method: "DELETE" }),
  /** Point one of my handles at one of my channels, and back again. */
  attachCommunityUsername: (slug: string, username: string) =>
    request<Community>(`/api/communities/${encodeURIComponent(slug)}/usernames`, {
      method: "POST",
      body: JSON.stringify({ username })
    }),
  detachCommunityUsername: (slug: string, assetId: string) =>
    request<Community>(`/api/communities/${encodeURIComponent(slug)}/usernames/${assetId}`, {
      method: "DELETE"
    }),
  setCommunityPrimaryUsername: (slug: string, assetId: string) =>
    request<Community>(
      `/api/communities/${encodeURIComponent(slug)}/usernames/${assetId}/primary`,
      { method: "POST" }
    ),

  gifts: (owner?: string) => request<Gift[]>(`/api/gifts${owner ? `?owner=${userPath(owner)}` : ""}`),
  giftCatalog: (query: GiftCatalogQuery = {}) => {
    const params = new URLSearchParams({ scope: query.scope ?? "all" });
    if (query.category) params.set("category", query.category);
    if (query.q?.trim()) params.set("q", query.q.trim());
    if (query.sort) params.set("sort", query.sort);
    return request<GiftModel[]>(`/api/gifts/catalog?${params}`);
  },
  giftCategories: () => request<GiftCategory[]>("/api/gifts/categories"),
  giftDesign: (slug: string) => request<GiftDesign>(`/api/gifts/catalog/${encodeURIComponent(slug)}`),
  giftMarket: (query: { design?: string; sort?: GiftMarketSort } = {}) => {
    const params = new URLSearchParams({ sort: query.sort ?? "recent" });
    if (query.design) params.set("design", query.design);
    return request<GiftMarketItem[]>(`/api/gifts/market?${params}`);
  },
  purchaseGift: (
    slug: string,
    options: {
      toUsername?: string;
      message?: string;
      hideMyName?: boolean;
      quantity?: number;
    } = {}
  ) =>
    request<GiftPurchaseResult>("/api/gifts/purchase", {
      method: "POST",
      body: JSON.stringify({
        slug,
        to_username: options.toUsername ? normalizeUsername(options.toUsername) : null,
        message: options.message?.trim() || null,
        hide_my_name: Boolean(options.hideMyName),
        quantity: Math.min(10, Math.max(1, options.quantity ?? 1))
      })
    }),
  setGiftVisibility: (id: string, hidden: boolean) =>
    request<Gift>(`/api/gifts/${id}/visibility`, {
      method: "PATCH",
      body: JSON.stringify({ hidden })
    }),
  /** Keeps an owned item at the head of the collection, or lets it fall back into order. */
  pinGift: (id: string, pinned: boolean) =>
    request<Gift>(`/api/gifts/${id}/pin`, { method: pinned ? "POST" : "DELETE" }),
  gift: (id: string) => request<Gift>(`/api/gifts/${id}`),
  upgradeGift: (id: string) => request<Gift>(`/api/gifts/${id}/upgrade`, { method: "POST" }),
  setGiftListing: (id: string, priceStars: number | null) =>
    request<Gift>(`/api/gifts/${id}/listing`, {
      method: "PUT",
      body: JSON.stringify({ price_stars: priceStars })
    }),
  buyGift: (id: string) => request<Gift>(`/api/gifts/${id}/buy`, { method: "POST" }),
  transferGift: (id: string, toUsername: string) =>
    request<Gift>(`/api/gifts/${id}/transfer`, {
      method: "POST",
      body: JSON.stringify({ to_username: toUsername })
    }),
  giftProvenance: (id: string) =>
    request<GiftProvenanceEvent[]>(`/api/gifts/${id}/provenance`),
  giftOffers: (id: string) => request<GiftOffer[]>(`/api/gifts/${id}/offers`),
  incomingGiftOffers: () => request<GiftOffer[]>("/api/gifts/offers/incoming"),
  outgoingGiftOffers: () => request<GiftOffer[]>("/api/gifts/offers/outgoing"),
  makeGiftOffer: (id: string, starsAmount: number) =>
    request<GiftOffer>(`/api/gifts/${id}/offers`, {
      method: "POST",
      body: JSON.stringify({ amount_stars: starsAmount })
    }),
  acceptGiftOffer: (offerId: string) =>
    request<Gift>(`/api/gifts/offers/${offerId}/accept`, { method: "POST" }),
  declineGiftOffer: (offerId: string) =>
    request<GiftOffer>(`/api/gifts/offers/${offerId}/decline`, { method: "POST" }),
  cancelGiftOffer: (offerId: string) =>
    request<GiftOffer>(`/api/gifts/offers/${offerId}/cancel`, { method: "POST" }),
  setGiftShowcase: (id: string, slot: ShowcaseSlot) =>
    request<User>(`/api/gifts/${id}/showcase`, {
      method: "PUT",
      body: JSON.stringify({ slot })
    }),
  /** Empties one showcase slot without touching the others; never gated by Premium. */
  clearShowcaseSlot: (slot: ShowcaseSlot) =>
    request<User>(`/api/users/me/showcase/${slot}`, { method: "DELETE" }),
  /** Says once that an item is not for sale, so its owner stops being asked a price. */
  setGiftOffersDisabled: (id: string, offersDisabled: boolean) =>
    request<Gift>(`/api/gifts/${id}/offers`, {
      method: "PATCH",
      body: JSON.stringify({ offers_disabled: offersDisabled })
    }),
  setUsernameOffersDisabled: (id: string, offersDisabled: boolean) =>
    request<UsernameAsset>(`/api/usernames/${id}/offers`, {
      method: "PATCH",
      body: JSON.stringify({ offers_disabled: offersDisabled })
    }),

  notifications: () => request<Notification[]>("/api/notifications"),
  readAllNotifications: () =>
    request<{ detail: string }>("/api/notifications/read-all", { method: "POST" }),
  readNotification: (id: string) =>
    request<Notification>(`/api/notifications/${id}/read`, { method: "POST" }),
  /** Removes one notice for good; reading it only greys it out. */
  deleteNotification: (id: string) =>
    request<{ detail: string }>(`/api/notifications/${id}`, { method: "DELETE" }),
  /** `read` clears the settled noise and keeps anything still waiting for attention. */
  clearNotifications: (scope: "all" | "read" = "read") =>
    request<{ detail: string }>(`/api/notifications?scope=${scope}`, { method: "DELETE" }),

  // Staff tools. Every one of these is refused with 403 unless the caller holds `is_admin`,
  // and every write is recorded in the audit log the panel reads back.
  adminOverview: () => request<AdminOverview>("/api/admin/overview"),
  adminUsers: (params: { q?: string; scope?: AdminUserScope } = {}) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.scope && params.scope !== "all") query.set("scope", params.scope);
    const suffix = query.size ? `?${query}` : "";
    return request<AdminUser[]>(`/api/admin/users${suffix}`);
  },
  adminUser: (username: string) => request<AdminUser>(`/api/admin/users/${userPath(username)}`),
  adminUpdateUser: (username: string, patch: AdminUserPatch) =>
    request<AdminUser>(`/api/admin/users/${userPath(username)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  adminBanUser: (username: string, reason: string) =>
    request<AdminUser>(`/api/admin/users/${userPath(username)}/ban`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  adminUnbanUser: (username: string) =>
    request<AdminUser>(`/api/admin/users/${userPath(username)}/ban`, { method: "DELETE" }),
  adminGrantStars: (username: string, amount: number, reason?: string) =>
    request<AdminUser>(`/api/admin/users/${userPath(username)}/stars`, {
      method: "POST",
      body: JSON.stringify({ amount, reason })
    }),
  adminGrantGift: (
    username: string,
    slug: string,
    upgraded = false,
    reason?: string,
    model?: string
  ) =>
    request<Gift>(`/api/admin/users/${userPath(username)}/gifts`, {
      method: "POST",
      body: JSON.stringify({ slug, upgraded, reason, model })
    }),
  adminRevokeGift: (giftId: string, reason?: string) =>
    request<{ detail: string }>(
      `/api/admin/gifts/${giftId}${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`,
      { method: "DELETE" }
    ),
  adminGrantUsername: (username: string, handle: string, reason?: string) =>
    request<AdminUser>(`/api/admin/users/${userPath(username)}/usernames`, {
      method: "POST",
      body: JSON.stringify({ username: handle, reason })
    }),
  adminRevokeUsername: (username: string, handle: string) =>
    request<AdminUser>(
      `/api/admin/users/${userPath(username)}/usernames/${encodeURIComponent(handle)}`,
      { method: "DELETE" }
    ),
  adminReports: (params: { status?: "open" | "resolved" | "all"; kind?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.kind) query.set("kind", params.kind);
    const suffix = query.size ? `?${query}` : "";
    return request<Report[]>(`/api/admin/reports${suffix}`);
  },
  adminResolveReport: (id: string, action: ReportAction, resolution?: string) =>
    request<Report>(`/api/admin/reports/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action, resolution })
    }),
  adminLegalReports: (status: "open" | "resolved" | "all" = "open") =>
    request<LegalReport[]>(`/api/admin/legal-reports?status=${status}`),
  adminResolveLegalReport: (
    id: string,
    action: "resolve" | "dismiss",
    resolution: string
  ) =>
    request<LegalReport>(`/api/admin/legal-reports/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action, resolution })
    }),
  adminHidePost: (postId: string, reason: string) =>
    request<{ detail: string }>(`/api/admin/posts/${postId}/hide`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  adminRestorePost: (postId: string) =>
    request<{ detail: string }>(`/api/admin/posts/${postId}/hide`, { method: "DELETE" }),
  adminHideComment: (commentId: string, reason: string) =>
    request<{ detail: string }>(
      `/api/admin/comments/${commentId}?reason=${encodeURIComponent(reason)}`,
      { method: "DELETE" }
    ),
  adminCommunities: (q?: string) =>
    request<AdminCommunity[]>(`/api/admin/communities${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  adminUpdateCommunity: (slug: string, patch: AdminCommunityPatch) =>
    request<AdminCommunity>(`/api/admin/communities/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  adminDeleteCommunity: (slug: string, reason: string) =>
    request<{ detail: string }>(
      `/api/admin/communities/${encodeURIComponent(slug)}?reason=${encodeURIComponent(reason)}`,
      { method: "DELETE" }
    ),
  adminActions: (
    params: {
      action?: string;
      actor?: string;
      target_type?: string;
      q?: string;
      hours?: number;
      limit?: number;
    } = {}
  ) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") search.set(key, String(value));
    }
    const query = search.toString();
    return request<AdminAction[]>(`/api/admin/actions${query ? `?${query}` : ""}`);
  },

  // The money half of the panel: two queues that wait for a person, and the logs behind them.
  adminPayouts: (status: "pending" | "open" | "paid" | "declined" | "failed" | "all" = "pending") =>
    request<AdminPayout[]>(`/api/admin/payouts?status=${status}`),
  adminDecidePayout: (id: string, approved: boolean, note?: string) =>
    request<AdminPayout>(`/api/admin/payouts/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ approved, note: note ?? "" })
    }),
  adminPayoutPaid: (id: string, note?: string) =>
    request<AdminPayout>(`/api/admin/payouts/${id}/paid`, {
      method: "POST",
      body: JSON.stringify({ note: note ?? "" })
    }),
  adminPayoutFailed: (id: string, note?: string) =>
    request<AdminPayout>(`/api/admin/payouts/${id}/failed`, {
      method: "POST",
      body: JSON.stringify({ note: note ?? "" })
    }),
  adminRefunds: (status: "pending" | "approved" | "declined" | "failed" | "all" = "pending") =>
    request<AdminRefund[]>(`/api/admin/refunds?status=${status}`),
  adminDecideRefund: (id: string, approved: boolean, note?: string) =>
    request<{ detail: string }>(`/api/admin/refunds/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ approved, note: note ?? "" })
    }),
  adminStarOrders: (params: { status?: string; q?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.status) search.set("status", params.status);
    if (params.q?.trim()) search.set("q", params.q.trim());
    return request<AdminStarOrder[]>(`/api/admin/star-orders?${search.toString()}`);
  },
  adminLedger: (params: { username?: string; kind?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.username?.trim()) search.set("username", params.username.trim());
    if (params.kind?.trim()) search.set("kind", params.kind.trim());
    if (params.limit) search.set("limit", String(params.limit));
    const query = search.toString();
    return request<AdminLedgerEntry[]>(`/api/admin/ledger${query ? `?${query}` : ""}`);
  },
  adminBroadcast: (text: string, scope: "all" | "premium" | "admins" | "active" = "all") =>
    request<{ detail: string }>("/api/admin/broadcast", {
      method: "POST",
      body: JSON.stringify({ text, scope })
    }),

  // The inventory half of the panel: what an account holds, and what staff may do to it.
  adminInventory: (username: string) =>
    request<AdminInventory>(`/api/admin/users/${userPath(username)}/inventory`),
  adminDeleteAccount: (username: string, body: AdminAccountDeleteInput) =>
    request<{ detail: string }>(`/api/admin/users/${userPath(username)}`, {
      method: "DELETE",
      body: JSON.stringify(body)
    }),
  adminUpdateGift: (giftId: string, patch: AdminGiftPatch) =>
    request<Gift>(`/api/admin/gifts/${giftId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  adminTransferGift: (giftId: string, username: string, reason?: string) =>
    request<Gift>(`/api/admin/gifts/${giftId}/transfer`, {
      method: "POST",
      body: JSON.stringify({ username, reason })
    }),
  adminClearGiftHistory: (giftId: string, reason: string) =>
    request<{ detail: string }>(
      `/api/admin/gifts/${giftId}/history?reason=${encodeURIComponent(reason)}`,
      { method: "DELETE" }
    ),
  adminDesigns: (q?: string) =>
    request<AdminDesign[]>(`/api/admin/gift-designs${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  adminUpdateDesign: (slug: string, patch: AdminDesignPatch) =>
    request<AdminDesign>(`/api/admin/gift-designs/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  adminTransferUsername: (handle: string, username: string, reason?: string) =>
    request<AdminUser>(`/api/admin/usernames/${encodeURIComponent(handle)}/transfer`, {
      method: "POST",
      body: JSON.stringify({ username, reason })
    }),
  adminClearUsernameHistory: (handle: string, reason: string) =>
    request<{ detail: string }>(
      `/api/admin/usernames/${encodeURIComponent(handle)}/history?reason=${encodeURIComponent(reason)}`,
      { method: "DELETE" }
    ),
  adminDeletePost: (postId: string, reason: string) =>
    request<{ detail: string }>(
      `/api/admin/posts/${postId}?reason=${encodeURIComponent(reason)}`,
      { method: "DELETE" }
    ),
  adminTransferCommunity: (slug: string, username: string, reason?: string) =>
    request<AdminCommunity>(`/api/admin/communities/${encodeURIComponent(slug)}/owner`, {
      method: "POST",
      body: JSON.stringify({ username, reason })
    })
};
