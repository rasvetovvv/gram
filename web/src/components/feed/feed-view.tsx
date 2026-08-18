"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Star } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Post, User } from "@/lib/types";
import { compactNumber } from "@/lib/utils";
import { useUiStore } from "@/store/ui";
import { UserAvatar } from "../user-avatar";
import { FeedMenu } from "./feed-menu";
import { PostCard } from "./post-card";
import { PostComposer } from "./post-composer";
import { SuggestedPeople } from "./suggested-people";

type FeedMode = "for-you" | "following" | "topics";
type FollowableUser = User & { is_following?: boolean };

export function FeedView() {
  const openComposer = useUiStore((state) => state.openComposer);
  const [mode, setMode] = useState<FeedMode>("for-you");
  const { data: posts = [], isLoading, error, refetch } = useQuery({
    queryKey: ["feed"],
    queryFn: () => api.feed(),
    // The reference polls its feed every 15s and swaps the list in silently.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false
  });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const users = useMemo(
    () => posts.map((post) => post.author).filter((user, index, all) => all.findIndex((item) => item.id === user.id) === index),
    [posts]
  );
  const visiblePosts = useMemo(() => {
    if (mode === "following") return posts.filter((post) => (post.author as FollowableUser).is_following);
    if (mode === "topics") return posts.filter((post) => /(^|\s)[#@][\p{L}\d_]+/u.test(post.content));
    return posts;
  }, [mode, posts]);

  return (
    <>
      <div className="mobile-topbar">
        <span className="wordmark">GRAM</span>
        <span className="flex items-center gap-1">
          {/* The reference keeps the star balance beside the wordmark on phones. */}
          <Link
            href="/stars"
            className="flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-extrabold text-[var(--stars)]"
            aria-label={`Звёзды: ${me?.stars_balance ?? 0}`}
          >
            <Star size={16} fill="currentColor" />
            {compactNumber(me?.stars_balance ?? 0)}
          </Link>
          <Link href="/notifications" className="icon-button" aria-label="Уведомления"><Bell size={21} /></Link>
        </span>
      </div>

      <header className="channel-header">
        <div>
          <h1 className="channel-title">Лента</h1>
          <p className="channel-subtitle">Люди, сообщества и темы, которые вам близки</p>
        </div>
        <span className="flex items-center gap-1">
          {/* The reference keeps the star balance in the feed's own header on wide screens too. */}
          <Link
            href="/stars"
            className="hidden min-h-9 items-center gap-1.5 rounded-full bg-[var(--surface-raised)] px-3 text-sm font-extrabold text-[var(--stars)] transition hover:brightness-110 lg:flex"
            aria-label={`Звёзды: ${me?.stars_balance ?? 0}`}
          >
            <Star size={15} fill="currentColor" />
            {compactNumber(me?.stars_balance ?? 0)}
          </Link>
          <FeedMenu />
        </span>
      </header>

      <div className="px-3 pb-3 sm:px-5">
        <div className="segmented-control" role="tablist" aria-label="Режим ленты">
          {[
            { value: "for-you" as const, label: "Для вас" },
            { value: "following" as const, label: "Подписки" },
            { value: "topics" as const, label: "Теги" }
          ].map((item) => (
            <button key={item.value} role="tab" aria-selected={mode === item.value} data-active={mode === item.value} onClick={() => setMode(item.value)}>{item.label}</button>
          ))}
        </div>
      </div>

      {users.length > 0 ? (
        <section className="border-y border-[var(--line)] py-4" aria-label="Люди в ленте">
          <div className="flex gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:px-6">
            {users.slice(0, 8).map((user) => (
              <Link key={user.id} href={`/u/${user.username}`} className="flex w-[66px] flex-none flex-col items-center gap-2">
                <span className="rounded-full p-[2px]" style={{ background: user.is_online ? "linear-gradient(145deg,#9e8cff,#52d4ff,#25db7c)" : "#35353d" }}>
                  <span className="block rounded-full border-[3px] border-[var(--canvas)]"><UserAvatar src={user.avatar_url} name={user.display_name} size={50} ringColor="var(--canvas)" /></span>
                </span>
                <span className="w-full truncate text-center text-[0.7rem] text-[var(--muted)]">{user.display_name.split(" ")[0]}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="border-b border-[var(--line)] px-3 py-3 sm:px-5" aria-label="Новая запись">
        <PostComposer avatarUrl={me?.avatar_url} displayName={me?.display_name} />
      </section>

      {isLoading ? (
        <div className="space-y-3 px-3 sm:px-5">
          {[0, 1, 2].map((item) => <div key={item} className="surface p-5"><div className="skeleton h-5 w-44 rounded-md" /><div className="skeleton mt-5 h-20 rounded-[16px]" /></div>)}
        </div>
      ) : error ? (
        <div className="empty-state">
          <p className="font-semibold text-white">Не удалось загрузить ленту</p>
          <p className="text-sm">Проверьте соединение и попробуйте ещё раз.</p>
          <button className="quiet-button mt-3" onClick={() => refetch()}>Повторить</button>
        </div>
      ) : visiblePosts.length === 0 ? (
        <div className="empty-state">
          <p className="font-semibold text-white">{mode === "following" ? "В подписках пока тихо" : "Подходящих публикаций нет"}</p>
          <p className="text-sm">{mode === "following" ? "Найдите интересных авторов и подпишитесь на них." : "Переключите раздел или создайте первую запись."}</p>
          <Link className="signal-button mt-3" href={mode === "following" ? "/discover" : "#"} onClick={mode === "following" ? undefined : openComposer}>{mode === "following" ? "Найти людей" : "Создать запись"}</Link>
        </div>
      ) : (
        <AnimatePresence initial={false} mode="popLayout">
          <div className="space-y-3 px-3 pb-6 sm:px-5">
            {visiblePosts.map((post: Post, index) => (
              <motion.div key={post.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, delay: Math.min(index * 0.035, 0.14), ease: [0.16, 1, 0.3, 1] }}>
                <PostCard post={post} priority={index === 0} />
                {/* The reference breaks its feed after the third post with a people rail. */}
                {index === 2 ? <SuggestedPeople /> : null}
              </motion.div>
            ))}
          </div>
        </AnimatePresence>
      )}
    </>
  );
}
