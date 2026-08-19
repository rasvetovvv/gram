"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, RefreshCw, UserRoundPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { nameColor } from "@/lib/profile-color";
import { UserAvatar } from "../user-avatar";
import { PremiumMark } from "../premium-mark";
import { AdminMark } from "../admin-mark";
import { VerifiedMark } from "../verified-mark";
import { useToast } from "../ui/toast";

type Tab = "following" | "followers";

/**
 * Контакты: the two sides of the social graph, reached from the feed menu.
 *
 * Each row goes straight to writing rather than to another profile page — a contact list whose
 * only action is "look at them again" is a directory, not a contact list.
 */
export function ContactsView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [tab, setTab] = useState<Tab>("following");

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const handle = me?.username;
  const people = useQuery({
    queryKey: ["profile-connections", handle, tab],
    queryFn: () => (tab === "following" ? api.following(handle!) : api.followers(handle!)),
    enabled: Boolean(handle)
  });

  const write = useMutation({
    mutationFn: (user: User) => api.directChat(user.username),
    onSuccess: async (chat) => {
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      router.push(`/chats?chat=${chat.id}`);
    },
    onError: (error: Error) =>
      notify("Не удалось открыть чат", { variant: "error", detail: error.message })
  });

  const rows = people.data ?? [];

  return (
    <>
      <div className="mobile-topbar">
        <span className="wordmark">КОНТАКТЫ</span>
        <UsersRound size={20} />
      </div>

      <header className="channel-header">
        <div>
          <h1 className="channel-title">Контакты</h1>
          <p className="channel-subtitle">Кого вы читаете и кто читает вас</p>
        </div>
      </header>

      <div className="px-3 pb-3 sm:px-5">
        <div className="segmented-control" role="tablist" aria-label="Сторона связей">
          {(
            [
              ["following", "Подписки"],
              ["followers", "Подписчики"]
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              data-active={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-1 pb-6 sm:px-3">
        {people.isLoading
          ? [0, 1, 2, 3].map((index) => (
              <div key={index} className="flex items-center gap-3 px-3 py-2.5">
                <div className="skeleton size-11 rounded-full" />
                <div className="min-w-0 flex-1">
                  <div className="skeleton h-4 w-32 rounded" />
                  <div className="skeleton mt-2 h-3 w-20 rounded" />
                </div>
              </div>
            ))
          : null}

        {people.isError ? (
          <div className="empty-state">
            <RefreshCw className="mx-auto mb-3 text-[var(--danger)]" />
            <p className="font-bold text-white">Не удалось загрузить</p>
            <p className="text-sm">{people.error.message}</p>
            <button className="quiet-button mt-3" onClick={() => people.refetch()}>
              <RefreshCw size={16} />
              Повторить
            </button>
          </div>
        ) : null}

        {rows.map((user) => (
          <div
            key={user.id}
            className="flex items-center gap-3 rounded-[16px] px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
          >
            <Link href={`/u/${user.username}`} className="flex min-w-0 flex-1 items-center gap-3">
              <UserAvatar
                src={user.avatar_url}
                name={user.display_name}
                online={user.is_online}
                size={44}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span
                    className="truncate text-[15px] font-semibold"
                    style={{ color: nameColor(user.profile_color) }}
                  >
                    {user.display_name}
                  </span>
                  {user.verified ? <VerifiedMark size={15} /> : null}{user.is_admin ? <AdminMark size={14} /> : null}
                  {user.is_premium ? (
                    <PremiumMark size={14} profileColor={user.profile_color} />
                  ) : null}
                </span>
                <span className="block truncate text-[13px] text-[var(--muted)]">
                  @{user.username}
                </span>
              </span>
            </Link>
            <button
              type="button"
              aria-label={`Написать ${user.display_name}`}
              onClick={() => write.mutate(user)}
              disabled={write.isPending}
              className="grid size-10 flex-none place-items-center rounded-full bg-[var(--surface-raised)] text-[var(--ink)] transition active:scale-95 disabled:opacity-50"
            >
              <MessageSquare size={18} />
            </button>
          </div>
        ))}

        {!people.isLoading && !people.isError && !rows.length ? (
          <div className="empty-state">
            <UserRoundPlus className="mx-auto mb-3 text-[var(--primary-strong)]" />
            <p className="font-bold text-white">
              {tab === "following" ? "Вы пока ни на кого не подписаны" : "Пока никто не подписался"}
            </p>
            <Link href="/discover" className="quiet-button mt-3">
              Найти людей
            </Link>
          </div>
        ) : null}
      </div>
    </>
  );
}
