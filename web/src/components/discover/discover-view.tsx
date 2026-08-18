"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Hash, Plus, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { nameColor } from "@/lib/profile-color";
import type { CommunityCompact, User } from "@/lib/types";
import { compactNumber } from "@/lib/utils";
import { UserAvatar } from "../user-avatar";
import { VerifiedMark } from "../verified-mark";

export function DiscoverView() {
  const params = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(query.trim());

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(timer);
  }, [query]);

  const communities = useQuery({ queryKey: ["communities"], queryFn: api.communities });
  const trends = useQuery({ queryKey: ["trends"], queryFn: () => api.trends(8) });
  const recommended = useQuery({ queryKey: ["recommended"], queryFn: api.recommendedUsers });
  const results = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length > 0
  });

  const searching = debounced.length > 0;
  const channelList: CommunityCompact[] = searching
    ? results.data?.communities ?? []
    : (communities.data ?? []).slice(0, 6).map((community) => ({
        slug: community.slug,
        title: community.title,
        avatar_url: community.avatar_url ?? null,
        members_count: community.members_count,
        owner_verified: Boolean(community.owner?.verified)
      }));
  const tagList = searching ? results.data?.tags ?? [] : trends.data ?? [];
  const peopleList = searching ? results.data?.people ?? [] : recommended.data ?? [];

  return (
    <>
      <div className="mobile-topbar">
        <span className="wordmark">ПОИСК</span>
        <Search size={20} />
      </div>

      <div className="px-3 pb-2 pt-3 sm:px-5">
        <label className="field flex items-center gap-3 px-4">
          <Search size={19} className="text-[var(--muted)]" />
          <input
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#8b8f98]"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && debounced) router.push(`/discover?q=${encodeURIComponent(debounced)}`);
            }}
            placeholder="Поиск в GRAM"
            aria-label="Поиск в GRAM"
          />
        </label>
      </div>

      <Section title="Сообщества" href="/communities">
        <Link
          href="/communities?create=1"
          className="flex min-h-[68px] items-center gap-3 border-b border-[var(--line)] px-4 last:border-0 hover:bg-[#121216]"
        >
          <span className="grid size-11 flex-none place-items-center rounded-full bg-[#17171d] text-[var(--primary-strong)]">
            <Plus size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-[0.95rem]">Создать канал</strong>
            <span className="text-xs text-[var(--muted)]">Публикуйте для подписчиков</span>
          </span>
          <ChevronRight size={18} className="flex-none text-[var(--faint)]" />
        </Link>
        {communities.isLoading && !searching ? (
          <div className="space-y-2 p-4">
            <div className="skeleton h-12 rounded-[16px]" />
            <div className="skeleton h-12 rounded-[16px]" />
          </div>
        ) : channelList.length ? (
          channelList.map((community) => (
            <Link
              key={community.slug}
              href={`/c/${community.slug}`}
              className="flex min-h-[68px] items-center gap-3 border-b border-[var(--line)] px-4 last:border-0 hover:bg-[#121216]"
            >
              <span className="relative size-11 flex-none overflow-hidden rounded-full bg-[#17171d]">
                {community.avatar_url ? (
                  <Image src={community.avatar_url} alt="" fill sizes="44px" className="object-cover" />
                ) : (
                  <span className="grid h-full place-items-center text-sm font-black text-[var(--primary-strong)]">
                    {community.title.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <strong className="truncate text-[0.95rem]">{community.title}</strong>
                  {community.owner_verified ? <VerifiedMark /> : null}
                </span>
                <span className="block truncate text-xs text-[var(--muted)]">
                  @{community.slug} · {compactNumber(community.members_count)} подписчиков
                </span>
              </span>
              <span className="flex-none rounded-full bg-[#17171d] px-2.5 py-1 text-[0.62rem] font-extrabold uppercase tracking-[.1em] text-[var(--faint)]">
                Канал
              </span>
            </Link>
          ))
        ) : (
          <p className="mb-0 px-4 py-5 text-sm text-[var(--muted)]">Каналы не найдены</p>
        )}
      </Section>

      <Section title={searching ? "Хэштеги" : "Сейчас в трендах"}>
        {tagList.length ? (
          tagList.map((trend) => (
            <Link
              key={trend.tag}
              href={`/tags/${encodeURIComponent(trend.tag)}`}
              className="flex min-h-[60px] items-center gap-3 border-b border-[var(--line)] px-4 last:border-0 hover:bg-[#121216]"
            >
              <span className="grid size-9 flex-none place-items-center rounded-full bg-[#17171d] text-[var(--primary-strong)]">
                <Hash size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[0.95rem]">#{trend.tag}</strong>
                <span className="text-xs text-[var(--muted)]">{compactNumber(trend.posts_count)} постов</span>
              </span>
              <ChevronRight size={18} className="flex-none text-[var(--faint)]" />
            </Link>
          ))
        ) : (
          <p className="mb-0 px-4 py-5 text-sm text-[var(--muted)]">
            {trends.isLoading ? "Загружаем тренды…" : "Пока нет тем с хэштегами"}
          </p>
        )}
      </Section>

      <Section title={searching ? "Люди" : "Кого читать"}>
        {peopleList.length ? (
          peopleList.map((user) => <PersonRow key={user.id} user={user} />)
        ) : (
          <p className="mb-0 px-4 py-5 text-sm text-[var(--muted)]">
            {results.isLoading || recommended.isLoading ? "Ищем людей…" : "Никого не нашлось"}
          </p>
        )}
      </Section>
    </>
  );
}

function Section({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="px-3 pb-4 sm:px-5">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <h2 className="m-0 text-[1.05rem] font-extrabold">{title}</h2>
        {href ? (
          <Link href={href} className="text-sm font-bold text-[var(--link)]">
            Все
          </Link>
        ) : null}
      </div>
      <div className="surface overflow-hidden">{children}</div>
    </section>
  );
}

function PersonRow({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const follow = useMutation({
    mutationFn: () => (user.is_following ? api.unfollow(user.username) : api.follow(user.username)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recommended"] }),
        queryClient.invalidateQueries({ queryKey: ["search"] }),
        queryClient.invalidateQueries({ queryKey: ["profile", user.username] })
      ]);
    }
  });
  return (
    <div className="flex min-h-[74px] items-center gap-3 border-b border-[var(--line)] px-4 last:border-0">
      <Link href={`/u/${user.username}`} className="flex-none">
        <UserAvatar src={user.avatar_url} name={user.display_name} online={user.is_online} size={46} ringColor="var(--surface)" />
      </Link>
      <Link href={`/u/${user.username}`} className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <strong className="truncate text-[0.95rem]" style={{ color: nameColor(user.profile_color) }}>
            {user.display_name}
          </strong>
          {user.verified ? <VerifiedMark /> : null}
        </span>
        <span className="block truncate text-xs text-[var(--muted)]">@{user.username}</span>
        <span className="block truncate text-xs text-[var(--faint)]">Популярный профиль</span>
      </Link>
      <button
        className={user.is_following ? "quiet-button !min-h-9 !px-3 text-xs" : "profile-primary-action !min-h-9 !px-4 text-xs"}
        onClick={() => follow.mutate()}
        disabled={follow.isPending}
      >
        {user.is_following ? "Вы подписаны" : "Подписаться"}
      </button>
    </div>
  );
}
