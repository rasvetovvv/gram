"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Hash, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { compactNumber } from "@/lib/utils";
import { PostCard } from "../feed/post-card";

/** Every trend links here: one hashtag, its post count and the matching posts. */
export function HashtagView({ tag }: { tag: string }) {
  const router = useRouter();
  const posts = useQuery({ queryKey: ["feed", "hashtag", tag], queryFn: () => api.feed({ hashtag: tag, limit: 100 }) });
  const trends = useQuery({ queryKey: ["trends"], queryFn: () => api.trends(30) });
  const total = trends.data?.find((item) => item.tag === tag.toLowerCase())?.posts_count;

  return (
    <>
      <header className="sticky top-0 z-40 flex min-h-[56px] items-center gap-3 border-b border-[var(--line)] bg-[rgba(6,6,8,.92)] px-3 backdrop-blur-xl sm:px-5">
        <button onClick={() => router.back()} className="icon-button" aria-label="Назад">
          <ArrowLeft size={21} />
        </button>
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm">#{tag}</strong>
          <span className="block truncate text-xs text-[var(--muted)]">
            {total ? `${compactNumber(total)} постов` : "Тема"}
          </span>
        </div>
        <span className="grid size-9 flex-none place-items-center rounded-full bg-[#17171d] text-[var(--primary-strong)]">
          <Hash size={18} />
        </span>
      </header>

      <div className="space-y-3 px-3 py-4 sm:px-5">
        {posts.isLoading ? (
          <>
            <div className="skeleton h-40 rounded-[22px]" />
            <div className="skeleton h-40 rounded-[22px]" />
          </>
        ) : posts.isError ? (
          <div className="empty-state">
            <RefreshCw className="mx-auto mb-3 text-[var(--danger)]" />
            <p className="font-bold text-white">Не удалось загрузить тему</p>
            <p className="text-sm">{posts.error.message}</p>
            <button className="quiet-button mt-3" onClick={() => posts.refetch()}>
              <RefreshCw size={16} />Повторить
            </button>
          </div>
        ) : posts.data?.length ? (
          posts.data.map((post) => <PostCard key={post.id} post={post} />)
        ) : (
          <div className="empty-state">
            <Hash className="mx-auto mb-3 text-[var(--primary-strong)]" />
            <p className="font-bold text-white">Пока нет постов с #{tag}</p>
            <p className="text-sm">Опубликуйте запись с этим хэштегом — она появится здесь.</p>
            <Link href="/discover" className="quiet-button mt-3">
              К поиску
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
