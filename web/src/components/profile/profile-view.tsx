"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import * as Tabs from "@radix-ui/react-tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Copy,
  ChevronLeft,
  Edit3,
  ExternalLink,
  Flag,
  Ban,
  Flame,
  Gift as GiftIcon,
  Code2,
  Grid3X3,
  ImageIcon,
  Link2,
  Lock,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Reply,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  UsersRound,
  X
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_URL, ApiError, api } from "@/lib/api";
import type { Community, Post, ProfileReply, User } from "@/lib/types";
import { presenceText, statusLine } from "@/lib/presence";
import { nameStyle, themeGradient } from "@/lib/profile-color";
import { compactNumber, relativeTime } from "@/lib/utils";
import { GiftCard, GiftDetailTrigger, type RichGift } from "../gifts/gift-gallery";
import { GiftImage, giftArtProps } from "../gifts/gift-image";
import { GiftPurchaseSheet } from "../gifts/gift-purchase-sheet";
import { PostCard } from "../feed/post-card";
import { UserAvatar } from "../user-avatar";
import { PremiumMark } from "../premium-mark";
import { VerifiedMark, VerifiedMarkExplained } from "../verified-mark";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { useToast } from "../ui/toast";
import { NoteDialog } from "./note-dialog";
import { BadgeStrip } from "./badge-detail";
import { ProfileEditSheet } from "./profile-edit-sheet";
import { ConnectionsDialog, ProfileQrDialog, ProfileStories } from "./profile-overlays";
import { RelatedUsernames } from "./username-ownership";
import { useUiStore } from "@/store/ui";

type RichProfile = User & {
  featured_gift_id?: string | null;
  name_gift_id?: string | null;
};

type ConnectionTab = "followers" | "following";

/** Secondary profile actions in the reference are outlined circles, not filled chips. */
const OUTLINE_ACTION =
  "inline-grid size-9 flex-none place-items-center rounded-full border border-[#3f3f46] bg-transparent text-[var(--ink)] transition-colors hover:bg-white/5 disabled:opacity-60";

/** Tab ids the URL may name; anything else falls back to the posts tab. */
const PROFILE_TABS = ["posts", "stories", "replies", "media", "gifts"];

export function ProfileView({ username }: { username: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [feedback, setFeedback] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [connectionTab, setConnectionTab] = useState<ConnectionTab>("followers");
  const [storyComposerOpen, setStoryComposerOpen] = useState(false);
  const [songPlaying, setSongPlaying] = useState(false);
  /**
   * The tab can arrive in the URL, so "Мои истории" in the feed menu can land on the right
   * section instead of the visitor hunting for it.
   */
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState(
    requestedTab && PROFILE_TABS.includes(requestedTab) ? requestedTab : "posts"
  );
  const [giftSheetOpen, setGiftSheetOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelSubOpen, setCancelSubOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { notify } = useToast();
  const openPremium = useUiStore((state) => state.openPremium);
  // On phones the reference hides the compact bar until the cover scrolls away and puts
  // navigation on top of the cover instead.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 120);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const profileQuery = useQuery({ queryKey: ["profile", username], queryFn: () => api.profile(username) });
  const meQuery = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const profile = profileQuery.data as RichProfile | undefined;
  const canonicalUsername = profile?.username ?? username;
  // A closed account answers 403 on every content endpoint, so the tabs are not even asked:
  // one lock panel says it once instead of four identical errors saying it four times.
  const contentOpen = profile?.can_view_content !== false;
  const enabled = Boolean(profile) && contentOpen;
  const giftsQuery = useQuery({ queryKey: ["gifts", canonicalUsername], queryFn: () => api.gifts(canonicalUsername), enabled });
  const feedQuery = useQuery({ queryKey: ["feed", canonicalUsername], queryFn: () => api.feed({ author: canonicalUsername, limit: 100 }), enabled });
  const storiesQuery = useQuery({ queryKey: ["profile-stories", canonicalUsername], queryFn: () => api.profileStories(canonicalUsername), enabled });
  const repliesQuery = useQuery({ queryKey: ["profile-replies", canonicalUsername], queryFn: () => api.profileReplies(canonicalUsername), enabled });
  const communityQuery = useQuery({
    queryKey: ["profile-community", profile?.featured_community_slug],
    queryFn: () => api.community(profile!.featured_community_slug!),
    enabled: Boolean(profile?.featured_community_slug)
  });
  const communityPostsQuery = useQuery({
    queryKey: ["profile-community-posts", profile?.featured_community_slug],
    queryFn: () => api.communityPosts(profile!.featured_community_slug!),
    enabled: Boolean(profile?.featured_community_slug)
  });

  const isMe = Boolean(profile && (profile.is_me || meQuery.data?.id === profile.id));
  const gifts = useMemo(() => (giftsQuery.data ?? []) as RichGift[], [giftsQuery.data]);
  const posts = (feedQuery.data ?? []).filter((post) => post.author.username.toLowerCase() === canonicalUsername.toLowerCase());
  const stories = storiesQuery.data ?? [];
  const replies = repliesQuery.data ?? [];
  const featuredGift = gifts.find((gift) => gift.id === profile?.featured_gift_id || gift.id === profile?.featured_gift?.id) ?? (profile?.featured_gift as RichGift | null | undefined);
  const nameGift = gifts.find((gift) => gift.id === profile?.name_gift_id || gift.id === profile?.name_gift?.id) ?? (profile?.name_gift as RichGift | null | undefined);
  /**
   * Owned collectibles surface next to the name even before the owner pins one, which is
   * how the reference behaves — an empty slot would otherwise hide a real collection.
   */
  const rankedGifts = useMemo(() => {
    const order: Record<string, number> = { mythic: 4, legendary: 3, epic: 2, rare: 1 };
    return [...gifts].sort(
      (a, b) =>
        (order[b.rarity] ?? 0) - (order[a.rarity] ?? 0) ||
        (b.value_stars ?? 0) - (a.value_stars ?? 0) ||
        a.serial_number - b.serial_number
    );
  }, [gifts]);
  const identityGift = nameGift ?? featuredGift ?? rankedGifts[0];
  const coverGifts = [
    featuredGift,
    ...rankedGifts.filter((gift) => gift.id !== featuredGift?.id && gift.id !== nameGift?.id)
  ]
    .filter((gift): gift is RichGift => Boolean(gift))
    .slice(0, 3);
  const tabGifts = useMemo(() => {
    const seen = new Set<string>();
    return rankedGifts.filter((gift) => (seen.has(gift.slug) ? false : seen.add(gift.slug))).slice(0, 3);
  }, [rankedGifts]);

  const mediaPosts = useMemo(() => posts.filter((post) => post.media_url), [posts]);
  // Tabs, related handles and the active-tab bar all echo the profile's colour scheme.
  const tabAccent = themeGradient(profile?.profile_color);

  const follow = useMutation({
    mutationFn: () => profile?.is_following ? api.unfollow(canonicalUsername) : api.follow(canonicalUsername),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profile", username] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["profile-connections", canonicalUsername] })
      ]);
      setFeedback(result.is_following ? `Вы подписались на @${canonicalUsername}` : "Подписка отменена");
    }
  });
  const subscription = useMutation({
    mutationFn: () => profile?.is_subscribed
      ? api.unsubscribe(canonicalUsername)
      : api.subscribe(canonicalUsername, profile?.subscription_price_stars ?? 50),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["profile", username] }), queryClient.invalidateQueries({ queryKey: ["me"] })]);
      setFeedback(profile?.is_subscribed ? "Платная подписка отменена" : "Платная подписка оформлена");
    }
  });
  const directChat = useMutation({
    mutationFn: () => api.directChat(canonicalUsername),
    onSuccess: (chat) => router.push(`/chats?chat=${chat.id}`)
  });
  const showcase = useMutation({
    mutationFn: ({ giftId, slot }: { giftId: string; slot: "featured" | "name" }) => api.updateShowcase(slot === "featured" ? { featured_gift_id: giftId } : { name_gift_id: giftId }),
    onSuccess: async (_, variables) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["profile", username] }), queryClient.invalidateQueries({ queryKey: ["me"] })]);
      setFeedback(variables.slot === "featured" ? "Подарок закреплён в шапке" : "Подарок появился рядом с именем");
    }
  });

  if (profileQuery.isLoading) return <ProfileSkeleton />;
  if (!profile) {
    const missing = profileQuery.error instanceof ApiError && profileQuery.error.status === 404;
    return <div className="empty-state"><UsersRound className="mx-auto mb-3 text-[var(--primary-strong)]" /><p className="font-bold text-white">{missing ? "Профиль не найден" : "Не удалось открыть профиль"}</p><p>{missing ? "Возможно, пользователь сменил юзернейм." : profileQuery.error?.message ?? "Проверьте соединение и попробуйте ещё раз."}</p><div className="mt-4 flex justify-center gap-2">{!missing ? <button className="quiet-button" onClick={() => profileQuery.refetch()}><RefreshCw size={17} />Повторить</button> : null}<Link href="/discover" className="quiet-button">К поиску</Link></div></div>;
  }

  function openConnections(tab: ConnectionTab) {
    setConnectionTab(tab);
    setConnectionsOpen(true);
  }

  async function shareProfile() {
    const url = `${window.location.origin}/u/${profile!.username}`;
    try {
      if (navigator.share) await navigator.share({ title: `${profile!.display_name} в GRAM`, url });
      else {
        await navigator.clipboard.writeText(url);
        notify("Ссылка на профиль скопирована");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setFeedback("Не удалось поделиться профилем");
    }
  }

  async function copyUsername() {
    const handle = `@${profile!.username}`;
    try {
      await navigator.clipboard.writeText(handle);
    } catch {
      // Clipboard access can be denied; say so rather than showing a false confirmation.
      notify("Не удалось скопировать юзернейм");
      return;
    }
    notify(`${handle} скопирован`);
    // A toast alone is easy to miss next to the tapped handle, so the control confirms too.
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function toggleSong() {
    const player = audioRef.current;
    if (!player) return;
    try {
      if (player.paused) {
        await player.play();
        setSongPlaying(true);
      } else {
        player.pause();
        setSongPlaying(false);
      }
    } catch {
      setFeedback("Не удалось воспроизвести трек");
    }
  }

  const errorMessage = follow.error?.message || subscription.error?.message || directChat.error?.message || showcase.error?.message;
  const storyViews = stories.map((story) => ({ id: story.id, title: story.title, media_url: story.media_url, created_at: story.created_at }));

  return (
    <div className="pb-8">
      <header
        className={`sticky top-0 z-40 flex min-h-[56px] items-center gap-3 border-b border-[var(--line-structural)] bg-[var(--header)] px-3 backdrop-blur-xl transition duration-200 sm:px-4 max-[899px]:fixed max-[899px]:inset-x-0 ${scrolled ? "" : "max-[899px]:pointer-events-none max-[899px]:-translate-y-full max-[899px]:opacity-0"}`}
      >
        <button onClick={() => router.back()} className="icon-button" aria-label="Назад"><ArrowLeft size={20} /></button>
        <UserAvatar src={profile.avatar_url} name={profile.display_name} size={36} ringColor="transparent" />
        <div className="min-w-0 flex-1">
          {/* Both marks are tappable here too: this header replaces the identity block on
              scroll, and a mark that explains itself in one place but not the other reads
              as broken rather than as a different affordance. */}
          <div className="flex items-center gap-1.5"><strong className="truncate text-[15px] font-black leading-tight" style={nameStyle(profile.profile_color)}>{profile.display_name}</strong>{profile.verified ? <VerifiedMarkExplained name={profile.display_name} label="Личность подтверждена GRAM" /> : null}{profile.is_premium ? <button type="button" onClick={() => openPremium()} className="inline-grid place-items-center border-0 bg-transparent p-0 transition-transform hover:scale-110 active:scale-95" aria-label="Открыть GRAM Premium"><PremiumMark size={14} profileColor={profile.profile_color} /></button> : null}</div>
          <span className="block truncate text-xs text-[var(--dim)]">{compactNumber(profile.posts_count ?? posts.length)} постов</span>
        </div>
        <button onClick={() => setQrOpen(true)} className="icon-button" aria-label="QR-код профиля"><QrCode size={18} /></button>
      </header>

      <section className="relative h-[176px] overflow-hidden bg-[#121216] sm:h-[208px]">
        {profile.cover_url ? (
          <Image src={profile.cover_url} alt={`Обложка профиля ${profile.display_name}`} fill priority unoptimized={profile.cover_url.startsWith(API_URL)} sizes="(max-width: 900px) 100vw, 780px" className="object-cover" />
        ) : (
          <div className="h-full w-full bg-[radial-gradient(circle_at_72%_18%,#1f3a63_0,transparent_28%),radial-gradient(circle_at_22%_110%,#17384d_0,transparent_42%),#0d0d11]" />
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/55 to-transparent px-3 pb-6 pt-[max(0.6rem,env(safe-area-inset-top))] min-[900px]:hidden">
          <button type="button" onClick={() => router.back()} className="pointer-events-auto grid size-9 place-items-center rounded-full border-0 bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65" aria-label="Назад"><ArrowLeft size={20} /></button>
          <button type="button" onClick={() => setQrOpen(true)} className="pointer-events-auto grid size-9 place-items-center rounded-full border-0 bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65" aria-label="QR-код профиля"><QrCode size={18} /></button>
        </div>
        {profile.note || isMe ? <div className="absolute bottom-3 left-[122px] z-10 max-w-[42%] sm:left-[136px] sm:max-w-[50%]"><NoteDialog username={profile.username} note={profile.note} canEdit={Boolean(profile.can_edit_note ?? isMe)} variant="bubble" /></div> : null}
        <CoverGifts gifts={coverGifts} me={meQuery.data?.username} />
      </section>

      <section className="relative px-4 pb-5 sm:px-6">
        <div className="-mt-[54px] flex items-end justify-between gap-3 sm:-mt-[64px]">
          <motion.div initial={{ scale: 0.94 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 24 }} className="rounded-full bg-[var(--canvas)] p-[3px]">
            <UserAvatar src={profile.avatar_url} name={profile.display_name} online={profile.is_online} size={104} ringColor="var(--canvas)" />
          </motion.div>
          <div className="relative z-20 mb-1 flex flex-wrap items-center justify-end gap-2">
            {isMe ? (
              <>
                <ProfileMoreMenu profile={profile} isMe={isMe} shareProfile={shareProfile} setFeedback={setFeedback} />
                <button className="profile-primary-action" onClick={() => setEditOpen(true)}><Edit3 size={16} />Редактировать</button>
              </>
            ) : (
              <>
                <button className={OUTLINE_ACTION} onClick={() => directChat.mutate()} disabled={directChat.isPending} aria-label="Написать"><MessageCircle size={16} /></button>
                <button className={OUTLINE_ACTION} onClick={() => setGiftSheetOpen(true)} aria-label="Отправить подарок"><GiftIcon size={16} /></button>
                <ProfileMoreMenu profile={profile} isMe={isMe} shareProfile={shareProfile} setFeedback={setFeedback} />
                <button className={profile.is_following ? "quiet-button" : "profile-primary-action"} onClick={() => follow.mutate()} disabled={follow.isPending}>{profile.is_following ? <><Check size={16} />Вы подписаны</> : "Читать"}</button>
              </>
            )}
          </div>
        </div>

        <div className="mt-3.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <h1 className="m-0 inline-block min-w-0 break-words text-xl font-extrabold leading-tight" style={nameStyle(profile.profile_color)}>{profile.display_name}</h1>
            {profile.verified ? <VerifiedMarkExplained name={profile.display_name} label="Личность подтверждена GRAM" size={20} /> : null}
            {profile.is_premium ? <button type="button" onClick={() => openPremium()} className="inline-grid place-items-center border-0 bg-transparent p-0 transition-transform hover:scale-110 active:scale-95" aria-label="Открыть GRAM Premium"><PremiumMark size={18} profileColor={profile.profile_color} /></button> : null}
            {identityGift ? <GiftDetailTrigger gift={identityGift} me={meQuery.data?.username} className="inline-grid size-7 place-items-center rounded-full border-0 bg-transparent p-0 transition-transform duration-150 hover:scale-[1.08] active:scale-95"><GiftImage {...giftArtProps(identityGift)} size={26} bare animate="hover" /></GiftDetailTrigger> : null}
            {(profile.streak_days ?? 0) > 0 ? <StreakBadge days={profile.streak_days ?? 0} isMe={isMe} /> : null}
          </div>
          {profile.role_title ? <p className="mb-0 mt-1 text-sm font-semibold text-[var(--muted)]">{profile.role_title}</p> : null}
          <button
            className="mt-1 flex min-h-9 items-center gap-1.5 rounded-md border-0 bg-transparent px-1 text-base text-[var(--dim)] transition-colors active:scale-[0.98]"
            onClick={copyUsername}
            aria-label={`Скопировать @${profile.username}`}
          >
            <span style={copied ? { color: "var(--online)" } : undefined}>@{profile.username}</span>
            <AnimatePresence initial={false} mode="wait">
              {copied ? (
                <motion.span
                  key="done"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  className="grid size-[18px] place-items-center rounded-full bg-[var(--online)] text-black"
                >
                  <Check size={12} strokeWidth={3.4} />
                </motion.span>
              ) : (
                <motion.span
                  key="copy"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="text-[var(--faint)]"
                >
                  <Copy size={14} />
                </motion.span>
              )}
            </AnimatePresence>
          </button>
          <p className={`mb-0 mt-0.5 text-sm ${profile.is_online ? "font-medium text-[var(--online)]" : "text-[var(--dim)]"}`}>{presenceText(profile)}</p>
          {statusLine(profile) ? (
            <p className="mb-0 mt-1 inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-[var(--surface-raised)] px-2.5 py-1 text-[13px] text-[var(--muted)]">
              {statusLine(profile)}
            </p>
          ) : null}
        </div>

        {profile.related_usernames?.length ? <RelatedUsernames handles={profile.related_usernames} profileColor={profile.profile_color} /> : null}
        {profile.bio ? <p className="mb-0 mt-3 max-w-[70ch] whitespace-pre-wrap break-words text-[15px] leading-6 text-[var(--ink)]">{profile.bio}</p> : null}
        {profile.badges?.length ? <BadgeStrip badges={profile.badges} className="mt-3" /> : null}
        <ProfileMeta profile={profile} />

        <div className="mt-3 flex items-center gap-5 text-[15px]">
          <button className="min-h-11 border-0 bg-transparent p-0 text-left" onClick={() => openConnections("following")}><strong className="font-bold">{compactNumber(profile.following_count)}</strong> <span className="text-[var(--dim)]">Подписки</span></button>
          <button className="min-h-11 border-0 bg-transparent p-0 text-left" onClick={() => openConnections("followers")}><strong className="font-bold">{compactNumber(profile.followers_count)}</strong> <span className="text-[var(--dim)]">Подписчики</span></button>
        </div>

        {!isMe && profile.paid_subscription_enabled && (profile.subscription_price_stars ?? 0) > 0 ? (
          <button
            className={profile.is_subscribed ? "quiet-button mt-4 w-full" : "mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-full border-0 bg-white px-5 font-extrabold"}
            style={profile.is_subscribed ? undefined : { color: "#000000" }}
            // Cancelling costs the remaining period, so it routes through a confirmation.
            onClick={() => (profile.is_subscribed ? setCancelSubOpen(true) : subscription.mutate())}
            disabled={subscription.isPending}
          >
            <Star size={18} fill="currentColor" />{profile.is_subscribed ? "Платная подписка активна" : `Подписаться · ${profile.subscription_price_stars} ★ / мес`}
          </button>
        ) : null}
      </section>

      {communityQuery.data ? <FeaturedCommunityCard community={communityQuery.data} latestPost={communityPostsQuery.data?.[0]?.content} /> : null}
      {profile.profile_song_url ? <ProfileSong profile={profile} audioRef={audioRef} playing={songPlaying} toggle={toggleSong} onEnded={() => setSongPlaying(false)} /> : null}
      {stories.length ? <><StoryPreviewRow stories={storyViews} onOpen={() => setTab("stories")} /><ProfileRule /></> : null}

      {profile.verified ? <><div className="mx-4 mb-3 flex items-center gap-1.5 text-[13px] text-[var(--ink)]"><ShieldCheck size={15} className="flex-none text-[var(--verified)]" /><span>Представители GRAM подтвердили, что этот профиль официальный.</span></div><ProfileRule /></> : null}

      {contentOpen ? null : <ClosedAccountPanel profile={profile} />}

      {contentOpen ? (
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="sticky top-[56px] z-30 flex overflow-x-auto border-b border-[var(--line-structural)] bg-[var(--header)] backdrop-blur-xl [scrollbar-width:none]" aria-label="Разделы профиля">
          <ProfileTab value="posts" label="Posts" accent={tabAccent} />
          <ProfileTab value="stories" label={stories.length ? `Stories • ${stories.length}` : "Stories"} accent={tabAccent} />
          <ProfileTab value="replies" label="Replies" accent={tabAccent} />
          <ProfileTab value="media" label="Media" accent={tabAccent} />
          <ProfileTab value="gifts" label="Gifts" accent={tabAccent} emblems={tabGifts} me={meQuery.data?.username} />
        </Tabs.List>

        <Tabs.Content value="posts" className="space-y-3 px-3 py-4 outline-none sm:px-5">
          {feedQuery.isLoading ? <ProfileFeedSkeleton /> : feedQuery.isError ? <SectionError text={feedQuery.error.message} retry={() => feedQuery.refetch()} /> : posts.length ? posts.map((post) => <PostCard key={post.id} post={post} showPinned />) : <EmptySection icon={Grid3X3} title="Пока нет постов" text="Новые публикации появятся здесь." />}
        </Tabs.Content>

        <Tabs.Content value="stories" className="outline-none">
          <div className="flex items-center justify-between px-4 pt-4 sm:px-5"><div><h2 className="m-0 text-lg font-bold">Истории</h2><p className="mb-0 mt-1 text-xs text-[var(--muted)]">Моменты и закреплённые истории профиля</p></div>{isMe ? <button className="quiet-button !min-h-10 !px-3 text-xs" onClick={() => setStoryComposerOpen(true)}><Plus size={16} />Добавить</button> : null}</div>
          {storiesQuery.isLoading ? <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5"><div className="skeleton aspect-[3/4] rounded-[18px]" /><div className="skeleton aspect-[3/4] rounded-[18px]" /></div> : storiesQuery.isError ? <SectionError text={storiesQuery.error.message} retry={() => storiesQuery.refetch()} /> : stories.length ? <ProfileStories stories={storyViews} profileName={profile.display_name} className="p-4 sm:p-5" /> : <EmptySection icon={Sparkles} title="Историй пока нет" text={isMe ? "Добавьте историю из медиа своих публикаций." : "Новые истории появятся здесь."} />}
        </Tabs.Content>

        <Tabs.Content value="replies" className="space-y-3 px-3 py-4 outline-none sm:px-5">
          {repliesQuery.isLoading ? <ProfileFeedSkeleton /> : repliesQuery.isError ? <SectionError text={repliesQuery.error.message} retry={() => repliesQuery.refetch()} /> : replies.length ? replies.map((reply) => <ReplyCard key={reply.id} reply={reply} />) : <EmptySection icon={Reply} title="Ответов пока нет" text="Ответы пользователя на публикации появятся здесь." />}
        </Tabs.Content>

        <Tabs.Content value="media" className="outline-none">
          {feedQuery.isError ? <SectionError text={feedQuery.error.message} retry={() => feedQuery.refetch()} /> : mediaPosts.length ? <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 sm:p-5">{mediaPosts.map((post) => <Link href={`/post/${post.id}`} key={post.id} className="relative aspect-square overflow-hidden rounded-[16px] bg-[#121216] focus-visible:outline"><Image src={post.media_url!} alt={`Медиа публикации: ${post.content.slice(0, 80)}`} fill sizes="240px" className="object-cover transition-transform duration-300 hover:scale-[1.03]" /></Link>)}</div> : <EmptySection icon={ImageIcon} title="Медиа пока нет" text="Изображения из публикаций появятся здесь." />}
        </Tabs.Content>

        <Tabs.Content value="gifts" className="outline-none">
          {giftsQuery.isLoading ? <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-4 sm:p-5">{[0,1,2,3].map((item) => <div key={item} className="skeleton aspect-square rounded-[16px]" />)}</div> : giftsQuery.isError ? <SectionError text={giftsQuery.error.message} retry={() => giftsQuery.refetch()} /> : <ProfileCollection gifts={gifts} meUsername={meQuery.data?.username} />}
        </Tabs.Content>

      </Tabs.Root>
      ) : null}

      <ProfileQrDialog open={qrOpen} onOpenChange={setQrOpen} profile={profile} />
      <ConnectionsDialog open={connectionsOpen} onOpenChange={setConnectionsOpen} username={profile.username} initialTab={connectionTab} />
      <StoryComposerDialog open={storyComposerOpen} onOpenChange={setStoryComposerOpen} posts={mediaPosts} username={profile.username} />
      <GiftPurchaseSheet recipient={profile.username} open={giftSheetOpen} onOpenChange={setGiftSheetOpen} />
      <ProfileEditSheet open={editOpen} onOpenChange={setEditOpen} />
      <ConfirmDialog
        open={cancelSubOpen}
        onOpenChange={setCancelSubOpen}
        title="Отменить платную подписку?"
        description={`Доступ к платным материалам @${canonicalUsername} закроется сразу, а списанные за текущий период ${profile.subscription_price_stars ?? 0} ★ не возвращаются.`}
        confirmLabel={subscription.isPending ? "Отменяем…" : "Отменить подписку"}
        cancelLabel="Оставить"
        error={subscription.error?.message}
        pending={subscription.isPending}
        onConfirm={() => {
          subscription.mutate();
          setCancelSubOpen(false);
        }}
      />
      <p className="sr-only" aria-live="polite">{feedback || errorMessage}</p>
    </div>
  );
}

/** Active tab is marked by a short bar carrying the profile's own colour scheme. */
function ProfileTab({
  value,
  label,
  accent,
  emblems,
  me
}: {
  value: string;
  label: string;
  accent: string;
  emblems?: RichGift[];
  me?: string;
}) {
  return (
    <Tabs.Trigger
      value={value}
      className="group relative flex shrink-0 items-center gap-1.5 border-0 bg-transparent px-5 py-4 text-[15px] font-medium text-[var(--dim)] transition-colors hover:bg-white/5 data-[state=active]:font-bold data-[state=active]:text-white"
    >
      {label}
      {emblems?.length ? (
        <span className="flex items-center -space-x-1.5">
          {emblems.map((gift) => (
            <span
              key={gift.id}
              className="rounded-full ring-1 ring-[var(--canvas)]"
              title={`${gift.name} · ${me === gift.owner_username ? "ваш" : gift.owner_username}`}
            >
              {/* Bare: these sit on the tab strip itself, where a coloured disc reads as a badge. */}
              <GiftImage {...giftArtProps(gift)} size={18} bare />
            </span>
          ))}
        </span>
      ) : null}
      <span
        aria-hidden
        className="absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-full opacity-0 transition-opacity group-data-[state=active]:opacity-100"
        style={{ background: accent }}
      />
    </Tabs.Trigger>
  );
}

function ProfileMoreMenu({ profile, isMe, shareProfile, setFeedback }: { profile: User; isMe: boolean; shareProfile: () => Promise<void>; setFeedback: (text: string) => void }) {
  const item = "flex min-h-12 cursor-pointer items-center gap-3 rounded-[14px] px-3 text-[0.95rem] font-semibold outline-none focus:bg-[#27272a] data-[highlighted]:bg-[#27272a]";
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [giftPremiumOpen, setGiftPremiumOpen] = useState(false);
  // Only read once the dialog is open: the balance is for the confirmation line, and nobody
  // needs a wallet fetch behind every profile they visit.
  const wallet = useQuery({
    queryKey: ["stars-wallet"],
    queryFn: api.starsWallet,
    enabled: giftPremiumOpen
  });
  const plan = useQuery({
    queryKey: ["premium-plan"],
    queryFn: api.premiumPlan,
    enabled: giftPremiumOpen
  });
  const price = plan.data?.price_stars ?? 750;
  const giftPremium = useMutation({
    mutationFn: () => api.giftPremium(profile.username),
    onSuccess: async (entitlement) => {
      setGiftPremiumOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profile", profile.username] }),
        queryClient.invalidateQueries({ queryKey: ["stars-wallet"] })
      ]);
      notify(`Premium подарен @${profile.username}`, {
        variant: "success",
        kind: "premium",
        detail: `До ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(entitlement.expires_at))} · −${entitlement.price_stars} ★`
      });
    },
    // The server already says exactly what went wrong — already has Premium, and until when;
    // how many stars are missing — so the notice repeats it instead of burying it.
    onError: (error: Error) =>
      notify("Не удалось подарить Premium", { variant: "error", detail: error.message })
  });
  return (
    <>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className={OUTLINE_ACTION} aria-label="Ещё"><MoreHorizontal size={16} /></button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-[90] min-w-[232px] rounded-[20px] bg-[#17171d] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.55)]">
          <DropdownMenu.Item className={item} onSelect={shareProfile}>
            <Link2 size={18} className="text-[var(--muted)]" />Скопировать ссылку
          </DropdownMenu.Item>
          {/* Gifting, reporting and blocking only make sense towards someone else. */}
          {isMe ? null : (
            <>
              <DropdownMenu.Item asChild>
                <Link href={`/stars?to=${encodeURIComponent(profile.username)}`} className={item}>
                  <Star size={18} className="text-[var(--stars)]" />Подарить звёзды
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Item className={item} onSelect={() => setGiftPremiumOpen(true)}>
                <Sparkles size={18} className="text-[var(--premium)]" />Подарить Premium
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="mx-2 my-1.5 h-px bg-[var(--line)]" />
              <DropdownMenu.Item className={item} onSelect={() => setFeedback("Жалоба будет доступна позже")}>
                <Flag size={18} className="text-[var(--muted)]" />Пожаловаться
              </DropdownMenu.Item>
              <DropdownMenu.Item className={`${item} text-[var(--danger)]`} onSelect={() => setFeedback("Блокировка будет доступна позже")}>
                <Ban size={18} />Заблокировать
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <ConfirmDialog
      open={giftPremiumOpen}
      onOpenChange={(next) => {
        setGiftPremiumOpen(next);
        if (!next) giftPremium.reset();
      }}
      tone="primary"
      title={`Подарить Premium @${profile.username}?`}
      description={`${profile.display_name} получит GRAM Premium на 30 дней. Спишем ${price} ★${
        typeof wallet.data?.balance === "number" ? ` — на балансе ${wallet.data.balance} ★` : ""
      }.`}
      confirmLabel={giftPremium.isPending ? "Дарим…" : `Подарить за ${price} ★`}
      error={giftPremium.error?.message}
      pending={giftPremium.isPending}
      onConfirm={() => giftPremium.mutate()}
    />
    </>
  );
}

function ProfileMeta({ profile }: { profile: User }) {
  const birthday = profile.birthday ? formatBirthday(profile.birthday) : null;
  const hasSocials = Boolean(profile.github_url || profile.telegram_url);
  return <>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[15px] text-[var(--dim)]">
      {profile.location ? <span className="inline-flex items-center gap-1.5"><MapPin size={15} className="flex-none" />{profile.location}</span> : null}
      {profile.website_url ? <a href={profile.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[var(--link)]"><Link2 size={15} className="flex-none" />{websiteLabel(profile.website_url)}<ExternalLink size={12} /></a> : null}
      <span className="inline-flex items-center gap-1.5"><CalendarDays size={15} className="flex-none" />В GRAM с {new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(profile.joined_at))}</span>
      {birthday ? <span className="inline-flex items-center gap-1.5"><CalendarDays size={15} className="flex-none" />{birthday}</span> : null}
    </div>
    {hasSocials ? <div className="mt-3 flex flex-wrap gap-2">
      {profile.github_url ? <a href={profile.github_url} target="_blank" rel="noreferrer" className="icon-button bg-[var(--surface-raised)]" aria-label="GitHub"><Code2 size={17} /></a> : null}
      {profile.telegram_url ? <a href={profile.telegram_url} target="_blank" rel="noreferrer" className="icon-button bg-[var(--surface-raised)] text-[var(--verified)]" aria-label="Telegram"><Send size={16} /></a> : null}
    </div> : null}
  </>;
}

function FeaturedCommunityCard({ community, latestPost }: { community: Community; latestPost?: string }) {
  return <section className="mx-4 mb-3"><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.08em] text-[#52525c]"><span>Канал</span><span className="rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-[11px] normal-case tracking-normal text-[var(--muted)]">{compactNumber(community.members_count)} подписчиков</span></div><Link href={`/c/${community.slug}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[24px] bg-[var(--surface)] p-4 transition-colors hover:bg-[var(--surface-raised)]"><div className="relative size-12 overflow-hidden rounded-full bg-[var(--surface-raised)]">{community.avatar_url ? <Image src={community.avatar_url} alt={community.title} fill sizes="48px" className="object-cover" /> : <span className="grid h-full place-items-center font-black text-[var(--primary-strong)]">{community.title.slice(0,1)}</span>}</div><span className="min-w-0"><span className="flex items-center gap-1.5"><strong className="truncate text-[15px] font-bold">{community.title}</strong>{community.owner.verified ? <VerifiedMark /> : null}</span><span className="mt-0.5 block truncate text-[13px] text-[var(--dim)]">{latestPost ?? community.description}</span></span><time className="self-start text-[12px] text-[var(--dim)]">{relativeTime(community.created_at)}</time></Link></section>;
}

/**
 * The streak counts consecutive days with a visit, so the popover explains the rule
 * instead of leaving a bare number next to the name.
 */
/**
 * Showcased collectibles over the cover photo.
 *
 * Drawn bare — sticker only, no coloured tile — because the cover is already an image and a
 * second backdrop would read as a sticker pack pasted on top. Sizes step down so the pinned
 * gift leads and the rest support it, which is the arrangement the reference uses.
 */
const COVER_SIZES = [66, 48, 40];

function CoverGifts({ gifts, me }: { gifts: RichGift[]; me?: string }) {
  if (!gifts.length) return null;
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 z-20 flex items-end gap-1 sm:bottom-3 sm:right-4 sm:gap-2">
      {gifts.map((gift, index) => (
        <GiftDetailTrigger
          key={gift.id}
          gift={gift}
          me={me}
          className="pointer-events-auto border-0 bg-transparent p-0 drop-shadow-[0_10px_18px_rgba(0,0,0,.55)] transition-transform duration-200 hover:scale-[1.08] active:scale-95"
          label={`Показать подарок ${gift.name} #${gift.serial_number}`}
        >
          <GiftImage
            {...giftArtProps(gift)}
            size={COVER_SIZES[index] ?? 40}
            bare
            rounded="rounded-none"
            className={index === 0 ? "gift-anim gift-bob" : undefined}
          />
        </GiftDetailTrigger>
      ))}
    </div>
  );
}

function StreakBadge({ days, isMe }: { days: number; isMe: boolean }) {
  const word = days % 10 === 1 && days % 100 !== 11 ? "день" : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 10 || days % 100 >= 20) ? "дня" : "дней";
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-full border-0 bg-[#32191d] px-2 text-xs font-extrabold text-[#ff7285] transition-transform hover:scale-105 active:scale-95"
          aria-label={`Огоньки: серия ${days} ${word}`}
        >
          <Flame size={14} fill="currentColor" />
          {days}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          className="z-[90] w-[min(20rem,calc(100vw-24px))] rounded-[20px] border border-[var(--sheet-line)] bg-[var(--sheet)] px-5 py-[18px] outline-none"
        >
          <h3 className="m-0 text-xl font-extrabold">Огоньки</h3>
          <p className="mb-0 mt-3 text-[15px] leading-6 text-[var(--muted)]">
            Серия — {days} {word} подряд. Огонёк добавляется один раз в сутки при заходе в GRAM
            и сгорает, если пропустить день.
          </p>
          {isMe ? (
            <p className="mb-0 mt-2 text-[13px] leading-5 text-[var(--dim)]">
              Сегодняшний визит уже засчитан.
            </p>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
function ProfileRule() {
  return <div aria-hidden className="mb-3 h-px bg-[var(--line-structural)]" />;
}

/** Highlight row: 56px rings with tiny captions, scrolling horizontally like the reference. */
function StoryPreviewRow({ stories, onOpen }: { stories: { id: string; title: string; media_url: string }[]; onOpen: () => void }) {
  return <section className="mx-4 mb-3">
    <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {stories.map((story) => (
        <div key={story.id} className="relative w-[66px] shrink-0 text-center">
          <button type="button" onClick={onOpen} className="group block w-full border-0 bg-transparent p-0" aria-label={`Открыть историю «${story.title}»`}>
            <span className="mx-auto block size-14 rounded-full bg-gradient-to-br from-zinc-700 via-zinc-900 to-black p-[2px] transition group-hover:from-violet-400 group-hover:via-sky-400 group-hover:to-fuchsia-500">
              <span className="block size-full overflow-hidden rounded-full bg-[#09090b] p-[2px]">
                <Image src={story.media_url} alt="" width={56} height={56} className="size-full rounded-full object-cover" />
              </span>
            </span>
            <span className="mt-1 block truncate text-[9px] font-semibold text-[#52525c]">{story.title}</span>
          </button>
        </div>
      ))}
    </div>
  </section>;
}

/** The reference renders profile music as a full-bleed hairline strip, not a card. */
function ProfileSong({ profile, audioRef, playing, toggle, onEnded }: { profile: User; audioRef: React.RefObject<HTMLAudioElement | null>; playing: boolean; toggle: () => void; onEnded: () => void }) {
  const title = profile.profile_song_title || "Песня профиля";
  const artist = profile.profile_song_artist || "GRAM profile music";
  return (
    <section className="mb-3 flex items-center border-y border-white/[0.045] bg-[#151515]">
      <button
        className="flex h-5 min-w-0 flex-1 items-center justify-center gap-1.5 border-0 bg-transparent px-4 text-xs font-medium text-[#e4e4e7] transition-colors hover:bg-white/[0.035]"
        onClick={toggle}
        aria-label={playing ? "Приостановить песню профиля" : "Слушать песню профиля"}
      >
        {playing ? <Pause size={12} className="shrink-0 fill-current text-white" /> : <Play size={12} className="shrink-0 fill-current text-white" />}
        <span className="truncate">{artist} — {title}</span>
      </button>
      <audio ref={audioRef} src={profile.profile_song_url ?? undefined} preload="none" onEnded={onEnded} />
    </section>
  );
}

function ReplyCard({ reply }: { reply: ProfileReply }) {
  return <Link href={`/post/${reply.post_id}`} className="block rounded-[20px] bg-[#121216] p-4 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-[#17171d]"><div className="flex items-center gap-2 text-xs text-[var(--muted)]"><Reply size={15} /><span>Ответ пользователю <strong className="text-[var(--link)]">@{reply.parent_post.author.username}</strong></span><span className="ml-auto">{relativeTime(reply.created_at)}</span></div><p className="mb-0 mt-3 whitespace-pre-wrap text-sm leading-6 text-white">{reply.content}</p><blockquote className="mb-0 mt-3 rounded-[14px] bg-[#121216] px-3 py-2 text-xs leading-5 text-[var(--muted)] shadow-[inset_0_0_0_1px_var(--line)]">{reply.parent_post.content}</blockquote></Link>;
}

function StoryComposerDialog({ open, onOpenChange, posts, username }: { open: boolean; onOpenChange: (open: boolean) => void; posts: Post[]; username: string }) {
  const queryClient = useQueryClient();
  const createStory = useMutation({
    mutationFn: (post: Post) => api.createProfileStory({ title: post.content.slice(0, 80) || "История", media_url: post.media_url!, highlight: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profile-stories", username] });
      onOpenChange(false);
    }
  });
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" /><Dialog.Content className="fixed inset-x-2 bottom-2 z-[90] mx-auto max-h-[86dvh] max-w-[640px] overflow-y-auto rounded-[28px] bg-[#121216] p-4 shadow-[0_28px_80px_rgba(0,0,0,.62)] sm:bottom-auto sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2"><div className="flex items-center gap-3"><button className="icon-button" onClick={() => onOpenChange(false)} aria-label="Закрыть"><ChevronLeft size={21} /></button><div className="min-w-0 flex-1"><Dialog.Title className="text-lg font-bold">Новая история</Dialog.Title><Dialog.Description className="mt-1 text-xs text-[var(--muted)]">Выберите изображение из своей публикации</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Закрыть"><X size={20} /></Dialog.Close></div>{posts.length ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{posts.map((post) => <button key={post.id} className="group relative aspect-[3/4] overflow-hidden rounded-[18px] border-0 bg-[#17171d] p-0 text-left" onClick={() => createStory.mutate(post)} disabled={createStory.isPending}><Image src={post.media_url!} alt={post.content.slice(0,80)} fill sizes="200px" className="object-cover transition-transform group-hover:scale-[1.03]" /><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-3 pt-10 text-xs font-bold text-white">{post.content.slice(0,55)}</span></button>)}</div> : <div className="empty-state"><ImageIcon className="mx-auto mb-3" /><p className="font-bold text-white">Нет публикаций с медиа</p><p className="text-sm">Сначала добавьте изображение в новую запись.</p></div>}<p className="mb-0 mt-3 min-h-5 text-sm text-[var(--danger)]" aria-live="polite">{createStory.error?.message}</p></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function ProfileCollection({ gifts, meUsername }: { gifts: RichGift[]; meUsername?: string }) {
  const openGifts = useUiStore((state) => state.openGifts);
  if (!gifts.length) return <EmptySection icon={GiftIcon} title="Коллекция пока пуста" text="Подарки пользователя появятся здесь." action={<button type="button" className="quiet-button mt-3" onClick={() => openGifts()}>Открыть подарки</button>} />;
  return <section className="px-3 py-4 sm:px-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="m-0 text-lg font-bold">Подарки</h2><p className="mb-0 mt-1 text-xs text-[var(--muted)]">Коллекционные предметы с историей владения</p></div><button type="button" className="border-0 bg-transparent p-0 text-sm font-semibold text-[var(--link)]" onClick={() => openGifts()}>Все</button></div><div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">{gifts.map((gift, index) => <GiftCard key={gift.id} gift={gift} index={index} me={meUsername} />)}</div></section>;
}

function EmptySection({ icon: Icon, title, text, action }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><Icon className="mx-auto mb-3 text-[var(--primary-strong)]" /><p className="font-bold text-white">{title}</p><p className="text-sm">{text}</p>{action}</div>;
}

function SectionError({ text, retry }: { text: string; retry: () => void }) {
  return <div className="empty-state"><RefreshCw className="mx-auto mb-3 text-[var(--danger)]" /><p className="font-bold text-white">Не удалось загрузить раздел</p><p className="text-sm">{text}</p><button className="quiet-button mt-3" onClick={retry}><RefreshCw size={16} />Повторить</button></div>;
}

/**
 * What a stranger sees instead of a closed account's tabs.
 *
 * The profile above it stays whole — name, avatar, counts — so the decision to follow can be
 * made from something, which is the point of a private account rather than a hidden one.
 */
function ClosedAccountPanel({ profile }: { profile: User }) {
  return (
    <section className="mx-4 mb-4 grid justify-items-center gap-2 rounded-[22px] bg-[var(--surface)] px-5 py-8 text-center shadow-[inset_0_0_0_1px_var(--line)]">
      <span className="grid size-12 place-items-center rounded-full bg-[var(--surface-raised)] text-[var(--muted)]">
        <Lock size={22} />
      </span>
      <strong className="text-[16px]">Закрытый аккаунт</strong>
      <p className="mb-0 max-w-[42ch] text-[14px] leading-6 text-[var(--muted)]">
        Посты, истории и ответы {profile.display_name} видны только подписчикам. Подпишитесь,
        чтобы открыть их.
      </p>
    </section>
  );
}

function ProfileFeedSkeleton() {
  return <div className="space-y-3">{[0,1].map((item) => <div key={item} className="skeleton h-48 rounded-[22px]" />)}</div>;
}

function ProfileSkeleton() {
  return <div><div className="skeleton h-[62px]" /><div className="skeleton h-[252px]" /><div className="px-5"><div className="skeleton -mt-[54px] size-[112px] rounded-full" /><div className="skeleton mt-6 h-8 w-52 rounded" /><div className="skeleton mt-4 h-20 rounded-[18px]" /></div></div>;
}

function websiteLabel(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url.replace(/^https?:\/\//, ""); }
}

function formatBirthday(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  if (now.getMonth() < date.getMonth() || (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())) age -= 1;
  const formatted = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(date);
  return age >= 0 ? `${formatted} (${age})` : formatted;
}
