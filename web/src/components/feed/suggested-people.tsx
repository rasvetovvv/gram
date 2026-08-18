"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { nameStyle } from "@/lib/profile-color";
import { compactNumber } from "@/lib/utils";
import { UserAvatar } from "../user-avatar";
import { VerifiedMark } from "../verified-mark";

type Suggested = User & { is_following?: boolean };

/**
 * "Возможно знакомые люди", copied from the reference: a horizontal rail of 150px cards
 * injected between posts, each dismissable and with a white follow pill. Dismissals are
 * kept client-side because the API has no "not interested" signal.
 */
export function SuggestedPeople() {
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState<string[]>([]);
  // `/users/recommended` omits is_following, so followed ids are tracked here to give the
  // button an immediate confirmed state instead of snapping back to "Подписаться".
  const [followed, setFollowed] = useState<string[]>([]);
  const { data = [] } = useQuery({ queryKey: ["recommended-users"], queryFn: api.recommendedUsers });

  const follow = useMutation({
    mutationFn: (user: Suggested) =>
      followed.includes(user.id) ? api.unfollow(user.username) : api.follow(user.username),
    onSuccess: async (_result, user) => {
      setFollowed((current) =>
        current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id]
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feed"] }),
        queryClient.invalidateQueries({ queryKey: ["profile", user.username] })
      ]);
    }
  });

  const people = (data as Suggested[]).filter((user) => !user.is_me && !hidden.includes(user.id));
  if (!people.length) return null;

  return (
    <section className="border-t border-[var(--line)] py-3" aria-label="Возможно знакомые люди">
      <div className="flex items-center justify-between px-4 pb-3">
        <h2 className="m-0 text-[13px] font-semibold uppercase tracking-[0.04em] text-[var(--faint)]">
          Возможно знакомые люди
        </h2>
        <Link href="/discover" className="text-sm text-[var(--identity)] transition-colors hover:text-white">
          Показать все
        </Link>
      </div>
      <div className="flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {people.map((user) => (
          <article
            key={user.id}
            className="relative flex w-[150px] shrink-0 snap-start flex-col rounded-2xl bg-[#131313] p-3"
          >
            <button
              type="button"
              aria-label={`Скрыть ${user.display_name}`}
              onClick={() => setHidden((current) => [...current, user.id])}
              className="absolute right-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-full border-0 bg-transparent text-[var(--faint)] transition hover:bg-[var(--surface-raised)] hover:text-[var(--ink)] active:scale-90"
            >
              <X size={16} />
            </button>
            <Link href={`/u/${user.username}`} className="w-fit">
              <UserAvatar src={user.avatar_url} name={user.display_name} size={64} ringColor="rgba(255,255,255,.1)" />
            </Link>
            <div className="mt-2 flex items-center gap-1">
              <Link
                href={`/u/${user.username}`}
                className="min-w-0 truncate text-[15px] font-bold leading-tight hover:underline"
                style={nameStyle(user.profile_color)}
              >
                {user.display_name}
              </Link>
              {user.verified ? <VerifiedMark size={14} /> : null}
            </div>
            <p className="mb-0 truncate text-[13px] leading-tight text-[var(--faint)]">@{user.username}</p>
            <p className="mb-0 mt-1 truncate text-[12px] leading-tight tracking-[-0.01em] text-[var(--faint)]">
              {user.followers_count > 0
                ? `${compactNumber(user.followers_count)} подписчиков`
                : "Популярный профиль"}
            </p>
            <button
              type="button"
              onClick={() => follow.mutate(user)}
              disabled={follow.isPending && follow.variables?.id === user.id}
              className={`mt-3 inline-flex h-8 items-center justify-center gap-1.5 rounded-full border-0 px-3 text-[15px] font-semibold transition active:scale-[0.97] disabled:opacity-60 ${
                followed.includes(user.id)
                  ? "bg-[var(--surface-raised)] text-[var(--ink)]"
                  : "bg-white text-black hover:bg-[#eceef2]"
              }`}
            >
              {followed.includes(user.id) ? (
                <>
                  <Check size={15} />Читаете
                </>
              ) : (
                "Подписаться"
              )}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
