"use client";

import { useQuery } from "@tanstack/react-query";
import { Bookmark, RefreshCw } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PostCard } from "../feed/post-card";

/**
 * Избранное: the posts this account has bookmarked, reached from the feed menu.
 *
 * The same `PostCard` the feed uses, so a saved post keeps every action it had — un-saving it
 * here removes it from the list on the next fetch, which is the behaviour people expect.
 */
export function SavedPostsView() {
  const saved = useQuery({ queryKey: ["bookmarked-posts"], queryFn: api.bookmarkedPosts });
  const posts = saved.data ?? [];

  return (
    <>
      <div className="mobile-topbar">
        <span className="wordmark">ИЗБРАННОЕ</span>
        <Bookmark size={20} />
      </div>

      <header className="channel-header">
        <div>
          <h1 className="channel-title">Избранное</h1>
          <p className="channel-subtitle">Публикации, которые вы сохранили</p>
        </div>
        <span className="rounded-full bg-[var(--surface-raised)] px-3 py-1.5 text-sm font-semibold text-[var(--muted)]">
          {posts.length}
        </span>
      </header>

      <div className="space-y-3 px-3 pb-6 sm:px-5">
        {saved.isLoading
          ? [0, 1, 2].map((index) => <div key={index} className="skeleton h-40 rounded-[20px]" />)
          : null}

        {saved.isError ? (
          <div className="empty-state">
            <RefreshCw className="mx-auto mb-3 text-[var(--danger)]" />
            <p className="font-bold text-white">Не удалось загрузить</p>
            <p className="text-sm">{saved.error.message}</p>
            <button className="quiet-button mt-3" onClick={() => saved.refetch()}>
              <RefreshCw size={16} />
              Повторить
            </button>
          </div>
        ) : null}

        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}

        {!saved.isLoading && !saved.isError && !posts.length ? (
          <div className="empty-state">
            <Bookmark className="mx-auto mb-3 text-[var(--primary-strong)]" />
            <p className="font-bold text-white">Пока ничего не сохранено</p>
            <p className="text-sm">
              Нажмите закладку под публикацией, чтобы вернуться к ней позже.
            </p>
            <Link href="/" className="quiet-button mt-3">
              В ленту
            </Link>
          </div>
        ) : null}
      </div>
    </>
  );
}
