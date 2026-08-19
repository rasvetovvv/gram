"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Compass,
  Gift,
  Home,
  MessageCircle,
  Plus,
  Settings,
  Star,
  Store,
  UserRound,
  UsersRound,
  WandSparkles,
  LogOut,
  Crown,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { useUiStore } from "@/store/ui";
import { useLogout } from "./auth/use-logout";
import { UserAvatar } from "./user-avatar";

/**
 * The rail's order is the reference's own, with the market added: it is a place of its own in
 * GRAM, and it used to be reachable only through the right column.
 */
const desktopItems = [
  { href: "/", label: "Лента", icon: Home },
  { href: "/discover", label: "Поиск", icon: Compass },
  { href: "/notifications", label: "Уведомления", icon: Bell },
  { href: "/chats", label: "Сообщения", icon: MessageCircle },
  { href: "/communities", label: "Сообщества", icon: UsersRound },
  { href: "/market", label: "Маркет", icon: Store },
  { href: "/gifts", label: "Подарки", icon: Gift, sheet: "gifts" as const },
  { href: "/studio", label: "Студия", icon: WandSparkles },
  { href: "/stars", label: "Звёзды", icon: Star },
  { href: "/profile", label: "Профиль", icon: UserRound },
];

/** One row shape for every sidebar destination, matching the reference's 44px pills. */
const NAV_ROW =
  "nav-link group relative flex h-11 w-full items-center gap-3 rounded-xl px-3 text-base transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--ink)]";

function active(pathname: string, href: string) {
  if (href === "/profile")
    return pathname.startsWith("/profile/") || pathname.startsWith("/u/");
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
function useNavigationData() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  // Dock badges track unread the way the reference does: a poll rather than a page reload.
  // Interval matches LiveNotifications; TanStack shares the single cached query.
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: api.notifications,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false
  });
  const chats = useQuery({
    queryKey: ["chats"],
    queryFn: api.chats,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false
  });
  return {
    me: me.data,
    unread: (notifications.data ?? []).filter((item) => !item.read).length,
    unreadChats: (chats.data ?? []).reduce(
      (total, chat) => total + (chat.unread_count ?? 0),
      0,
    ),
  };
}

export function DesktopNavigation() {
  const pathname = usePathname();
  const { me, unread, unreadChats } = useNavigationData();
  const logout = useLogout();
  const openPremium = useUiStore((state) => state.openPremium);
  const openGifts = useUiStore((state) => state.openGifts);
  const profileHref = me ? `/u/${me.username}` : "/login";
  // Only these two rows carry a live count; the rest have nothing to accumulate.
  const badges: Record<string, number> = { "/notifications": unread, "/chats": unreadChats };
  return (
    <div className="flex h-full flex-col justify-between px-2.5 py-5 min-[1180px]:px-3.5">
      <div>
        <Link
          href="/"
          className="flex h-10 items-center justify-center gap-1.5 min-[1180px]:justify-start"
          aria-label="GRAM — на главную"
        >
          <span className="grid size-8 flex-none place-items-center rounded-lg bg-[linear-gradient(90deg,#191a1c_25%,#16171a_50%,#08090b_100%)] text-[13px] font-black leading-none text-white">
            G
          </span>
          <span className="brand-copy text-base font-extrabold">GRAM</span>
        </Link>
        <nav className="mt-6 flex flex-col gap-1" aria-label="Основная навигация">
          {desktopItems.map(({ href, label, icon: Icon, ...item }) => {
            const selected = active(pathname, href);
            const destination = href === "/profile" ? profileHref : href;
            const count = badges[href] ?? 0;
            const style = {
              color: selected || count ? "var(--ink)" : "var(--muted)",
              background: selected ? "var(--surface-raised)" : undefined,
            };
            // A sheet is not a destination: it opens over whatever the reader is on.
            if ("sheet" in item)
              return (
                <button
                  key={href}
                  type="button"
                  onClick={() => openGifts()}
                  className={`${NAV_ROW} border-0 bg-transparent text-left`}
                  style={style}
                >
                  <Icon size={20} strokeWidth={1.9} className="flex-none" />
                  <span className="nav-copy">{label}</span>
                </button>
              );
            return (
              <Link
                key={href}
                href={destination}
                className={NAV_ROW}
                style={style}
                aria-current={selected ? "page" : undefined}
              >
                <Icon size={20} strokeWidth={selected ? 2.3 : 1.9} className="flex-none" />
                <span className="nav-copy">{label}</span>
                {count ? (
                  <span
                    className="nav-badge grid place-items-center rounded-full font-extrabold text-white"
                    style={{ background: "var(--primary)" }}
                  >
                    {count > 99 ? "99+" : count}
                    <span className="sr-only">непрочитанных</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={openPremium}
          className={`${NAV_ROW} border-0 bg-transparent text-left`}
          style={{ color: "var(--muted)" }}
        >
          <Crown size={20} strokeWidth={1.9} className="text-[var(--premium)]" />
          <span className="nav-copy">GRAM Premium</span>
        </button>
        <Link href="/settings" className={NAV_ROW} style={{ color: "var(--muted)" }}>
          <Settings size={20} strokeWidth={1.9} />
          <span className="nav-copy">Настройки</span>
        </Link>
        {me ? (
          <button
            className={`${NAV_ROW} border-0 bg-transparent text-left`}
            style={{ color: "var(--muted)" }}
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut size={20} strokeWidth={1.9} />
            <span className="nav-copy">Выйти</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
export function MobileDock() {
  const pathname = usePathname();
  const { me, unread, unreadChats } = useNavigationData();
  const items = [
    { href: "/", label: "Главная", icon: Home },
    { href: "/discover", label: "Обзор", icon: Compass },
    { href: "/notifications", label: "События", icon: Bell, badge: unread },
    { href: "/chats", label: "Чаты", icon: MessageCircle, badge: unreadChats },
    { href: "/studio", label: "Студия", icon: WandSparkles },
    {
      href: me ? `/u/${me.username}` : "/login",
      label: "Профиль",
      icon: me ? null : Settings,
    },
  ];
  return (
    <nav className="mobile-dock" aria-label="Мобильная навигация">
      {items.map(({ href, label, icon: Icon, badge }) => {
        const selected = active(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className="dock-link"
            data-active={selected}
            aria-label={label}
            aria-current={selected ? "page" : undefined}
          >
            <span className="relative grid size-6 place-items-center">
              {Icon ? (
                <Icon size={23} strokeWidth={selected ? 2.4 : 1.85} />
              ) : (
                <UserAvatar
                  src={me?.avatar_url}
                  name={me?.display_name ?? "GRAM"}
                  size={26}
                  ringColor="transparent"
                />
              )}
              {badge && badge > 0 ? (
                <span className="absolute -right-3 -top-2 unread-badge">
                  {badge > 9 ? "9+" : badge}
                </span>
              ) : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
export function MobileComposeButton() {
  const pathname = usePathname();
  const openComposer = useUiStore((state) => state.openComposer);
  // The reference keeps the compose button on the feed only; profiles stay uncovered.
  const supportsPosts = pathname === "/" || pathname.startsWith("/post/");
  if (!supportsPosts) return null;
  return (
    <button
      className="mobile-compose-fab"
      onClick={openComposer}
      aria-label="Создать запись"
    >
      <Plus size={25} />
    </button>
  );
}
