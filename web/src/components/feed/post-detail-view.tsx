"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PostCard } from "./post-card";
import { PostComments } from "./post-comments";

/** One post by permalink, fetched by id so it works however old the post is. */
export function PostDetailView({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["post", id], queryFn: () => api.post(id) });
  return (
    <>
      <div className="mobile-topbar">
        <Link href="/" className="icon-button" aria-label="Back to feed">
          <ArrowLeft size={21} />
        </Link>
        <span className="wordmark">POST</span>
        <span className="size-11" />
      </div>
      <header className="channel-header">
        <div>
          <h1 className="channel-title">Post</h1>
          <p className="channel-subtitle">The post and its discussion</p>
        </div>
      </header>
      {query.isLoading ? (
        <div className="surface mx-3 p-5 sm:mx-5">
          <div className="skeleton h-5 w-40 rounded" />
          <div className="skeleton mt-5 h-32 rounded-[18px]" />
        </div>
      ) : query.data ? (
        <div className="px-3 pb-6 sm:px-5">
          <PostCard post={query.data} priority showPinned openOnClick={false} />
          <PostComments post={query.data} />
        </div>
      ) : (
        <div className="empty-state">
          <p className="font-bold text-white">Post not found</p>
          <p>
            {query.error?.message === "Закрытый аккаунт: подпишитесь, чтобы видеть публикации"
              ? "This account is private — follow the author to read their posts."
              : "The author may have deleted it."}
          </p>
          <Link href="/" className="quiet-button mt-3">
            Back to feed
          </Link>
        </div>
      )}
    </>
  );
}
