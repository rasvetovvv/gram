"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { nameColor } from "@/lib/profile-color";
import type { User } from "@/lib/types";
import { compactNumber } from "@/lib/utils";
import { useToast } from "./ui/toast";
import { UserAvatar } from "./user-avatar";
import { PremiumMark } from "./premium-mark";
import { VerifiedMark } from "./verified-mark";

/**
 * The right column, rebuilt to the reference's own two blocks: «Что происходит» over the
 * trending tags, and «Кого читать» over people to follow.
 *
 * It used to show recent conversations and listed usernames — neither of which the reference
 * puts here, and both of which duplicated a place that already exists in the rail.
 */
const POSTS_PLURAL = ["пост", "поста", "постов"];

function plural(count: number, forms: string[]) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

export function ContextRail() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { data: trends = [] } = useQuery({ queryKey: ["trends"], queryFn: () => api.trends(5) });
  const { data: people = [] } = useQuery({
    queryKey: ["recommended-users"],
    queryFn: api.recommendedUsers
  });

  return (
    <aside className="px-5 py-5">
      <form
        className="flex h-12 items-center gap-3 rounded-[17px] bg-[#121216] px-4 text-[var(--muted)] shadow-[inset_0_0_0_1px_var(--line)]"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) router.push(`/discover?q=${encodeURIComponent(query.trim())}`);
        }}
      >
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#8b8f98]"
          placeholder="Люди, посты, @юзы"
        />
      </form>

      <section className="surface mt-6 overflow-hidden p-0">
        <h2 className="m-0 px-4 pb-1 pt-4 text-[19px] font-extrabold">Что происходит</h2>
        {trends.length ? (
          trends.map((trend) => (
            <Link
              key={trend.tag}
              href={`/tags/${encodeURIComponent(trend.tag)}`}
              className="block px-4 py-2.5 transition-colors hover:bg-[#17171d]"
            >
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--faint)]">
                В тренде
              </span>
              <span className="mt-0.5 block truncate text-[15px] font-bold">#{trend.tag}</span>
              <span className="block text-[13px] text-[var(--muted)]">
                {compactNumber(trend.posts_count)} {plural(trend.posts_count, POSTS_PLURAL)}
              </span>
            </Link>
          ))
        ) : (
          <p className="m-0 px-4 pb-4 text-sm text-[var(--muted)]">Пока ничего не набрало обороты.</p>
        )}
        <Link
          href="/discover"
          className="flex min-h-11 items-center px-4 text-sm font-semibold text-[var(--link)] transition-colors hover:bg-[#17171d]"
        >
          Показать больше
        </Link>
      </section>

      <section className="surface mt-4 overflow-hidden p-0">
        <h2 className="m-0 px-4 pb-2 pt-4 text-[19px] font-extrabold">Кого читать</h2>
        {people.slice(0, 5).map((person) => (
          <SuggestedRow key={person.id} person={person} />
        ))}
        {people.length ? null : (
          <p className="m-0 px-4 pb-4 text-sm text-[var(--muted)]">Некого предложить — пока.</p>
        )}
        <Link
          href="/discover"
          className="flex min-h-11 items-center px-4 text-sm font-semibold text-[var(--link)] transition-colors hover:bg-[#17171d]"
        >
          Показать ещё
        </Link>
      </section>

      <p className="mt-8 px-2 text-xs leading-5 text-[#858792]">
        GRAM · локальная версия
        <br />
        Коллекции · Конфиденциальность
      </p>
    </aside>
  );
}

/** One person with a follow action, as the reference's «Читать» row does it. */
function SuggestedRow({ person }: { person: User }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const follow = useMutation({
    mutationFn: () => api.follow(person.username),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recommended-users"] }),
        queryClient.invalidateQueries({ queryKey: ["feed"] })
      ]);
      notify(`Вы подписались на @${person.username}`, { variant: "success" });
    },
    onError: (error: Error) =>
      notify("Не удалось подписаться", { variant: "error", detail: error.message })
  });

  return (
    <div className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-[#17171d]">
      <Link href={`/u/${person.username}`} className="flex min-w-0 flex-1 items-center gap-3">
        <UserAvatar
          src={person.avatar_url}
          name={person.display_name}
          online={person.is_online}
          size={40}
          ringColor="var(--surface)"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span
              className="truncate text-[15px] font-bold"
              style={{ color: nameColor(person.profile_color) }}
            >
              {person.display_name}
            </span>
            {person.verified ? <VerifiedMark size={14} /> : null}
            {person.is_premium ? (
              <PremiumMark size={13} profileColor={person.profile_color} />
            ) : null}
          </span>
          <span className="block truncate text-[13px] text-[var(--muted)]">@{person.username}</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => follow.mutate()}
        disabled={follow.isPending}
        className="h-8 flex-none rounded-full bg-white px-3.5 text-[13px] font-bold text-black transition active:scale-95 disabled:opacity-60"
      >
        Читать
      </button>
    </div>
  );
}
