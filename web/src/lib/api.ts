import type {
  AccountSettings,
  AccountSlot,
  ApiErrorShape,
  AuthSession,
  AuthSessionInfo,
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
  GiftProvenanceEvent,
  LoginInput,
  Message,
  Notification,
  Post,
  ProfileBadge,
  ProfileReply,
  ProfileStory,
  ProfileStoryCreate,
  ProfileUpdateInput,
  RegisterInput,
  SearchResults,
  StarTransaction,
  StarTransferReceipt,
  StarWallet,
  Subscription,
  PremiumEntitlement,
  PremiumPlan,
  ToggleResult,
  Trend,
  User,
  UsernameAsset,
  UsernameHistoryEvent
} from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** The reference's own three orders over one thread. */
export type CommentSort = "new" | "old" | "top";

/** Where a gift can be put on display: four places on the cover, and beside the name. */
export type ShowcaseSlot = "featured" | "cover2" | "cover3" | "cover4" | "name";

/** The reference's own list of reasons a post can be reported for. */
export type PostReportReason = "spam" | "abuse" | "adult" | "fraud" | "violence" | "other";

export type GiftCatalogScope = "all" | "market" | "limited" | "available" | "resale";
export type GiftCatalogSort = "position" | "price-asc" | "price-desc" | "rarity" | "supply";
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
  return body.message ?? "Не удалось связаться с GRAM. Проверьте соединение и попробуйте ещё раз.";
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

/** One shared refresh so a burst of expired requests does not rotate the token repeatedly. */
async function refreshAccess(): Promise<boolean> {
  refreshInFlight ??= fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    credentials: "include"
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
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
    const session = await request<AuthSession>("/api/auth/refresh", { method: "POST" });
    return session.user;
  }
}

export const api = {
  register: (payload: RegisterInput) =>
    request<AuthSession>("/api/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  login: (payload: LoginInput) =>
    request<AuthSession>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),
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
    link?: { url: string; title?: string } | null
  ) =>
    request<Post>("/api/feed", {
      method: "POST",
      body: JSON.stringify({
        content,
        image_url: imageUrls?.[0],
        image_urls: imageUrls?.length ? imageUrls : undefined,
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
  deletePost: (id: string) => request<{ detail: string }>(`/api/feed/${id}`, { method: "DELETE" }),
  /** Rewrites one's own post; the server re-reads the text for a music link and marks «ред.». */
  editPost: (id: string, content: string, link?: { url?: string; title?: string }) =>
    request<Post>(`/api/feed/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        content,
        link_url: link?.url || undefined,
        link_title: link?.title || undefined
      })
    }),
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
  createGroupChat: (title: string, members: string[]) =>
    request<Chat>("/api/chats/groups", {
      method: "POST",
      body: JSON.stringify({ title, members })
    }),
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
  purchaseUsername: (id: string) =>
    request<UsernameAsset>(`/api/usernames/${id}/purchase`, { method: "POST" }),

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
    request<Notification>(`/api/notifications/${id}/read`, { method: "POST" })
};
