/* eslint-disable @next/next/no-img-element */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  ImageOff,
  Palette,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Share2,
  UserPlus,
  UsersRound,
  X
} from "lucide-react";
import Link from "next/link";
import { QRCodeCanvas } from "qrcode.react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { nameColor } from "@/lib/profile-color";
import type { User } from "@/lib/types";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { UserAvatar } from "@/components/user-avatar";
import { VerifiedMark } from "@/components/verified-mark";

type ProfileQrDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: {
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
};

type ConnectionsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string;
  initialTab: "followers" | "following";
};

export type ProfileStoryView = {
  id: string;
  title: string;
  media_url: string;
  created_at: string;
};

type ProfileStoriesProps = {
  stories: ProfileStoryView[];
  profileName?: string;
  className?: string;
};

const QR_COLORS = [
  { value: "#0b0b0d", label: "Графит" },
  { value: "#46378f", label: "Фиолетовый" },
  { value: "#075e78", label: "Циан" }
] as const;

function profileHref(username: string) {
  return `/u/${encodeURIComponent(username.replace(/^@/, ""))}`;
}

function absoluteProfileUrl(username: string) {
  const path = profileHref(username);
  return typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy is unavailable");
}

function isShareCancellation(error: unknown) {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "NotAllowedError");
}

export function ProfileQrDialog({ open, onOpenChange, profile }: ProfileQrDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-2 bottom-2 z-[90] mx-auto flex max-h-[calc(100dvh-1rem)] max-w-[540px] flex-col overflow-hidden rounded-[28px] bg-[#17171d] shadow-[0_28px_80px_rgba(0,0,0,.62)] sm:bottom-auto sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2">
          <QrDialogContent key={`${profile.username}-${open ? "open" : "closed"}`} profile={profile} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function QrDialogContent({ profile }: { profile: ProfileQrDialogProps["profile"] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const profileUrl = absoluteProfileUrl(profile.username);
  const [foreground, setForeground] = useState<(typeof QR_COLORS)[number]["value"]>(QR_COLORS[0].value);
  const [status, setStatus] = useState("");

  function downloadQr() {
    const canvas = canvasRef.current;
    if (!canvas) {
      setStatus("QR-код ещё не готов. Попробуйте снова.");
      return;
    }

    try {
      const link = document.createElement("a");
      const filename = profile.username.replace(/^@/, "").replace(/[^a-z0-9_-]+/gi, "-") || "profile";
      link.download = `gram-${filename}-qr.png`;
      link.href = canvas.toDataURL("image/png");
      document.body.appendChild(link);
      link.click();
      link.remove();
      setStatus("QR-код сохранён в PNG.");
    } catch {
      setStatus("Не удалось сохранить QR-код. Сделайте снимок экрана.");
    }
  }

  async function shareProfile() {
    const url = absoluteProfileUrl(profile.username);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({
          title: `${profile.display_name} в GRAM`,
          text: `Профиль @${profile.username.replace(/^@/, "")} в GRAM`,
          url
        });
        setStatus("Профиль отправлен.");
        return;
      }
      await copyText(url);
      setStatus("Ссылка на профиль скопирована.");
    } catch (error) {
      if (!isShareCancellation(error)) setStatus("Не удалось поделиться ссылкой. Попробуйте ещё раз.");
    }
  }

  return (
    <>
      <header className="flex flex-none items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar src={profile.avatar_url} name={profile.display_name} size={46} ringColor="#17171d" />
          <div className="min-w-0">
            <Dialog.Title className="truncate text-lg font-extrabold tracking-[-0.025em]">QR профиля</Dialog.Title>
            <Dialog.Description className="mt-0.5 truncate text-sm text-[var(--muted)]">
              @{profile.username.replace(/^@/, "")}
            </Dialog.Description>
          </div>
        </div>
        <Dialog.Close className="icon-button -mr-2 -mt-1" aria-label="Закрыть QR-код">
          <X size={20} />
        </Dialog.Close>
      </header>

      <Tabs.Root defaultValue="my-qr" className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-6">
        <Tabs.List className="segmented-control" aria-label="Режим QR-кода">
          <Tabs.Trigger value="my-qr" className="flex items-center justify-center gap-2">
            <QrCode size={17} />
            Мой QR
          </Tabs.Trigger>
          <Tabs.Trigger value="scan" className="flex items-center justify-center gap-2">
            <ScanLine size={17} />
            Сканировать
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="my-qr" className="mt-5 outline-none">
          <div className="mx-auto flex max-w-[390px] flex-col items-center text-center">
            <div className="w-full rounded-[24px] bg-white p-4 shadow-[0_18px_46px_rgba(0,0,0,.34)] sm:p-5">
              <QRCodeCanvas
                ref={canvasRef}
                value={profileUrl}
                size={1024}
                level="H"
                marginSize={3}
                bgColor="#ffffff"
                fgColor={foreground}
                title={`QR-код профиля @${profile.username.replace(/^@/, "")}`}
                className="mx-auto"
                style={{ width: 248, height: 248, maxWidth: "100%" }}
              />
            </div>
            <h2 className="mb-0 mt-4 max-w-full truncate text-lg font-extrabold">{profile.display_name}</h2>
            <p className="mb-0 mt-1 max-w-full truncate text-sm text-[var(--muted)]">
              Наведите камеру, чтобы открыть @{profile.username.replace(/^@/, "")}
            </p>

            <fieldset className="mt-5 w-full">
              <legend className="flex items-center gap-2 text-sm font-bold">
                <Palette size={16} className="text-[var(--primary-strong)]" />
                Стиль QR
              </legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {QR_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() => {
                      setForeground(color.value);
                      setStatus(`Выбран стиль «${color.label}».`);
                    }}
                    aria-pressed={foreground === color.value}
                    className="flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-[14px] bg-[#27272a] px-2 text-xs font-bold text-[var(--muted)] shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:text-white aria-pressed:bg-[#302b40] aria-pressed:text-white aria-pressed:shadow-[inset_0_0_0_1px_#554b74]"
                  >
                    <span
                      aria-hidden="true"
                      className="size-3.5 flex-none rounded-full ring-2 ring-white/20"
                      style={{ backgroundColor: color.value }}
                    />
                    <span className="truncate">{color.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-4 grid w-full grid-cols-2 gap-2">
              <button type="button" className="quiet-button !px-3" onClick={downloadQr}>
                <Download size={17} />
                Скачать PNG
              </button>
              <button type="button" className="signal-button !px-3" onClick={() => void shareProfile()}>
                <Share2 size={17} />
                Поделиться
              </button>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="scan" className="mt-5 outline-none">
          <div className="mx-auto max-w-[390px] rounded-[24px] bg-[#121216] px-5 py-8 text-center shadow-[inset_0_0_0_1px_var(--line)]">
            <div className="relative mx-auto grid aspect-square w-40 place-items-center rounded-[26px] bg-[#1d1b25] text-[var(--primary-strong)] shadow-[inset_0_0_0_1px_#373245]">
              <ScanLine size={54} strokeWidth={1.5} />
              <span className="absolute inset-3 rounded-[18px] border border-dashed border-[#655a85]" aria-hidden="true" />
            </div>
            <h2 className="mb-0 mt-5 text-lg font-extrabold">Сканер пока недоступен</h2>
            <p className="mx-auto mb-0 mt-2 max-w-[34ch] text-sm leading-6 text-[var(--muted)]">
              Камера ещё не подключена. Откройте QR-код обычной камерой телефона — GRAM не запрашивает разрешение без рабочего сканера.
            </p>
          </div>
        </Tabs.Content>

        <p
          className={`mx-auto mb-0 mt-3 min-h-5 max-w-[390px] text-center text-xs ${status.includes("Не удалось") ? "text-[var(--danger)]" : "text-[var(--online)]"}`}
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
      </Tabs.Root>
    </>
  );
}

export function ConnectionsDialog({ open, onOpenChange, username, initialTab }: ConnectionsDialogProps) {
  const normalizedUsername = username.replace(/^@/, "");
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Связи профиля"
      description={`Подписчики и подписки @${normalizedUsername}`}
      headerRight={
        <Dialog.Close className="icon-button !size-9 bg-[#27272a]" aria-label="Закрыть список связей">
          <X size={19} />
        </Dialog.Close>
      }
      // A browsing list, so the panel keeps one tall height: switching tab or typing a filter
      // must not resize the sheet under the finger that is about to tap a row.
      className="h-[90dvh]"
    >
      <ConnectionsDialogContent
        key={`${username}-${initialTab}-${open ? "open" : "closed"}`}
        open={open}
        username={username}
        initialTab={initialTab}
        onOpenProfile={() => onOpenChange(false)}
      />
    </BottomSheet>
  );
}

function ConnectionsDialogContent({
  open,
  username,
  initialTab,
  onOpenProfile
}: {
  open: boolean;
  username: string;
  initialTab: ConnectionsDialogProps["initialTab"];
  onOpenProfile: () => void;
}) {
  const [search, setSearch] = useState("");
  const normalizedUsername = username.replace(/^@/, "");
  const followers = useQuery({
    queryKey: ["profile-connections", normalizedUsername, "followers"],
    queryFn: () => api.followers(normalizedUsername),
    enabled: open
  });
  const following = useQuery({
    queryKey: ["profile-connections", normalizedUsername, "following"],
    queryFn: () => api.following(normalizedUsername),
    enabled: open
  });

  return (
    <Tabs.Root defaultValue={initialTab}>
      <div className="min-w-0 pt-1">
        <h2 className="m-0 truncate text-lg font-extrabold tracking-[-0.025em]">Связи профиля</h2>
        <p className="mb-0 mt-0.5 truncate text-sm text-[var(--muted)]">
          Подписчики и подписки @{normalizedUsername}
        </p>
      </div>

      {/* Tabs and the filter stay pinned so a long list scrolls underneath them. */}
      <div className="sticky top-0 z-10 -mx-4 bg-[var(--sheet)] px-4 pb-3 pt-3">
        <Tabs.List className="segmented-control" aria-label="Связи пользователя">
          <Tabs.Trigger value="followers" className="flex min-w-0 items-center justify-center gap-2 px-2">
            <UsersRound size={17} />
            <span className="truncate">Подписчики</span>
            <ConnectionCount value={followers.data?.length} loading={followers.isLoading} />
          </Tabs.Trigger>
          <Tabs.Trigger value="following" className="flex min-w-0 items-center justify-center gap-2 px-2">
            <UserPlus size={17} />
            <span className="truncate">Подписки</span>
            <ConnectionCount value={following.data?.length} loading={following.isLoading} />
          </Tabs.Trigger>
        </Tabs.List>

        <label className="field mt-3 flex items-center gap-3 px-4">
          <Search size={18} className="flex-none text-[var(--faint)]" aria-hidden="true" />
          <span className="sr-only">Поиск по имени или юзернейму</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
            placeholder="Найти человека"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#8b8f98]"
          />
        </label>
      </div>

      <Tabs.Content value="followers" className="outline-none">
        <ConnectionsList
          users={followers.data}
          loading={followers.isLoading}
          error={followers.error}
          search={search}
          emptyCopy={`У @${normalizedUsername} пока нет подписчиков.`}
          onRetry={() => void followers.refetch()}
          onOpenProfile={onOpenProfile}
        />
      </Tabs.Content>
      <Tabs.Content value="following" className="outline-none">
        <ConnectionsList
          users={following.data}
          loading={following.isLoading}
          error={following.error}
          search={search}
          emptyCopy={`@${normalizedUsername} пока ни на кого не подписан.`}
          onRetry={() => void following.refetch()}
          onOpenProfile={onOpenProfile}
        />
      </Tabs.Content>
    </Tabs.Root>
  );
}

function ConnectionCount({ value, loading }: { value?: number; loading: boolean }) {
  return (
    <span className="inline-grid min-w-6 flex-none place-items-center rounded-full bg-black/25 px-1.5 py-0.5 text-[0.68rem] font-extrabold text-current">
      {loading ? <span aria-label="Загрузка">…</span> : value ?? 0}
    </span>
  );
}

function ConnectionsList({
  users,
  loading,
  error,
  search,
  emptyCopy,
  onRetry,
  onOpenProfile
}: {
  users?: User[];
  loading: boolean;
  error: Error | null;
  search: string;
  emptyCopy: string;
  onRetry: () => void;
  onOpenProfile: () => void;
}) {
  const filteredUsers = useMemo(() => {
    const needle = search.trim().normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/^@/, "");
    if (!needle) return users ?? [];
    return (users ?? []).filter((user) => {
      const name = user.display_name.normalize("NFKC").toLocaleLowerCase("ru-RU");
      const handle = user.username.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/^@/, "");
      return name.includes(needle) || handle.includes(needle);
    });
  }, [search, users]);

  if (loading) {
    return (
      <div className="space-y-1" aria-busy="true" aria-label="Загружаем список пользователей">
        {[0, 1, 2, 3, 4].map((item) => (
          <div key={item} className="flex min-h-[68px] items-center gap-3 px-2 py-2">
            <div className="skeleton size-11 flex-none rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="skeleton h-3.5 w-2/5 rounded-full" />
              <div className="skeleton h-3 w-1/4 rounded-full" />
            </div>
            <div className="skeleton h-10 w-24 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center" role="alert">
        <span className="grid size-12 place-items-center rounded-full bg-[#302126] text-[var(--danger)]">
          <AlertCircle size={23} />
        </span>
        <h3 className="mb-0 mt-4 text-base font-extrabold">Список не загрузился</h3>
        <p className="mb-0 mt-2 max-w-[36ch] text-sm leading-5 text-[var(--muted)]">
          {error.message || "Проверьте соединение и попробуйте ещё раз."}
        </p>
        <button type="button" className="quiet-button mt-4" onClick={onRetry}>
          <RefreshCw size={17} />
          Повторить
        </button>
      </div>
    );
  }

  if (!filteredUsers.length) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-[#24212e] text-[var(--primary-strong)]">
          <UsersRound size={23} />
        </span>
        <h3 className="mb-0 mt-4 text-base font-extrabold">{search.trim() ? "Совпадений нет" : "Список пуст"}</h3>
        <p className="mb-0 mt-2 max-w-[36ch] text-sm leading-5 text-[var(--muted)]">
          {search.trim() ? "Попробуйте другое имя или юзернейм." : emptyCopy}
        </p>
      </div>
    );
  }

  return (
    <ul className="m-0 list-none overflow-hidden rounded-[20px] bg-[#121216] p-0 shadow-[inset_0_0_0_1px_var(--line)]">
      {filteredUsers.map((user, index) => {
        const username = user.username.replace(/^@/, "");
        const href = profileHref(username);
        return (
          <li
            key={user.id}
            className={`flex min-w-0 items-center gap-3 px-3 py-3 sm:px-4 ${index ? "border-t border-[var(--line)]" : ""}`}
          >
            <Link href={href} onClick={onOpenProfile} className="flex min-w-0 flex-1 items-center gap-3 rounded-[14px]">
              <UserAvatar src={user.avatar_url} name={user.display_name} online={user.is_online} size={44} ringColor="#121216" />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <strong className="truncate text-sm" style={{ color: nameColor(user.profile_color) }}>{user.display_name}</strong>
                  {user.verified || user.is_verified ? <VerifiedMark label="Подтверждённый профиль GRAM" /> : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">@{username}</span>
              </span>
            </Link>
            <Link
              href={href}
              onClick={onOpenProfile}
              className="inline-flex min-h-10 flex-none items-center gap-1.5 rounded-full bg-[#27272a] px-3 text-xs font-bold text-white shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-[#27272a]"
              aria-label={`Открыть профиль ${user.display_name}`}
            >
              Открыть
              <ExternalLink size={14} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ProfileStories({ stories, profileName = "Профиль", className = "" }: ProfileStoriesProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [shareStatus, setShareStatus] = useState("");
  const currentStory = selectedIndex === null ? undefined : stories[selectedIndex];
  const hasPrevious = selectedIndex !== null && selectedIndex > 0;
  const hasNext = selectedIndex !== null && selectedIndex < stories.length - 1;

  useEffect(() => {
    if (selectedIndex === null || !currentStory) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft" && hasPrevious) {
        event.preventDefault();
        setSelectedIndex((index) => (index === null ? null : index - 1));
        setShareStatus("");
      }
      if (event.key === "ArrowRight" && hasNext) {
        event.preventDefault();
        setSelectedIndex((index) => (index === null ? null : index + 1));
        setShareStatus("");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentStory, hasNext, hasPrevious, selectedIndex]);

  async function shareStory(story: ProfileStoryView) {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: story.title, text: `${story.title} · ${profileName}`, url: story.media_url });
        setShareStatus("История отправлена.");
        return;
      }
      await copyText(story.media_url);
      setShareStatus("Ссылка на историю скопирована.");
    } catch (error) {
      if (!isShareCancellation(error)) setShareStatus("Не удалось поделиться историей.");
    }
  }

  if (!stories.length) return null;

  return (
    <section className={className} aria-label={`Истории: ${profileName}`}>
      <div className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-6">
        {stories.map((story, index) => (
          <button
            key={story.id}
            type="button"
            onClick={() => {
              setSelectedIndex(index);
              setShareStatus("");
            }}
            className="group relative aspect-[9/16] w-[116px] flex-none snap-start overflow-hidden rounded-[18px] border-0 bg-[#121216] p-0 text-left shadow-[inset_0_0_0_1px_var(--line)] sm:w-[136px]"
            aria-label={`Открыть историю «${story.title}», ${formatStoryDate(story.created_at)}`}
          >
            <StoryMedia story={story} thumbnail />
            <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_38%,rgba(0,0,0,.88))]" />
            <span className="absolute inset-x-0 bottom-0 block p-3">
              <strong className="line-clamp-2 block text-sm leading-[1.25] text-white">{story.title || "Без названия"}</strong>
              <span className="mt-1 block truncate text-[0.68rem] font-semibold text-white/70">{formatStoryDate(story.created_at)}</span>
            </span>
          </button>
        ))}
      </div>

      <Dialog.Root
        open={Boolean(currentStory)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSelectedIndex(null);
            setShareStatus("");
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/95" />
          {currentStory && selectedIndex !== null ? (
            <Dialog.Content
              className="fixed inset-0 z-[110] flex flex-col bg-[#050506] outline-none sm:bg-black/30"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) setSelectedIndex(null);
              }}
            >
              <Dialog.Title className="sr-only">{currentStory.title || "История профиля"}</Dialog.Title>
              <Dialog.Description className="sr-only">
                История {selectedIndex + 1} из {stories.length}. Используйте стрелки влево и вправо для навигации.
              </Dialog.Description>

              <div className="absolute inset-x-3 top-[max(.75rem,env(safe-area-inset-top))] z-20 flex gap-1" aria-hidden="true">
                {stories.map((story, index) => (
                  <span key={story.id} className="h-0.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/25">
                    <span className={`block h-full rounded-full bg-white ${index <= selectedIndex ? "w-full" : "w-0"}`} />
                  </span>
                ))}
              </div>

              <header className="relative z-10 flex min-h-[76px] flex-none items-center gap-3 px-3 pb-2 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-sm font-extrabold text-white">{currentStory.title || "Без названия"}</p>
                  <p className="mb-0 mt-0.5 truncate text-xs text-white/65">
                    {profileName} · {formatStoryDate(currentStory.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-button bg-white/10 text-white hover:bg-white/15"
                  onClick={() => void shareStory(currentStory)}
                  aria-label="Поделиться историей"
                >
                  <Share2 size={19} />
                </button>
                <Dialog.Close className="icon-button bg-white/10 text-white hover:bg-white/15" aria-label="Закрыть историю">
                  <X size={21} />
                </Dialog.Close>
              </header>

              <div
                className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-[max(4.5rem,env(safe-area-inset-bottom))] sm:px-20 sm:pb-6"
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) setSelectedIndex(null);
                }}
              >
                <div className="relative h-full max-h-[calc(100dvh-7rem)] w-full max-w-[520px] overflow-hidden rounded-[18px] bg-[#121216] shadow-[0_28px_80px_rgba(0,0,0,.62)] sm:rounded-[24px]">
                  <StoryMedia key={currentStory.id} story={currentStory} />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedIndex((index) => (index === null ? null : index - 1));
                    setShareStatus("");
                  }}
                  disabled={!hasPrevious}
                  className="icon-button absolute left-3 top-1/2 z-10 -translate-y-1/2 bg-black/55 text-white shadow-[0_8px_22px_rgba(0,0,0,.36)] hover:bg-black/75 disabled:invisible sm:left-5"
                  aria-label="Предыдущая история"
                >
                  <ChevronLeft size={25} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIndex((index) => (index === null ? null : index + 1));
                    setShareStatus("");
                  }}
                  disabled={!hasNext}
                  className="icon-button absolute right-3 top-1/2 z-10 -translate-y-1/2 bg-black/55 text-white shadow-[0_8px_22px_rgba(0,0,0,.36)] hover:bg-black/75 disabled:invisible sm:right-5"
                  aria-label="Следующая история"
                >
                  <ChevronRight size={25} />
                </button>
              </div>

              <p
                className={`pointer-events-none absolute inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 m-0 text-center text-xs font-semibold ${shareStatus.includes("Не удалось") ? "text-[var(--danger)]" : "text-white"}`}
                role="status"
                aria-live="polite"
              >
                {shareStatus}
              </p>
            </Dialog.Content>
          ) : null}
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

function StoryMedia({ story, thumbnail = false }: { story: ProfileStoryView; thumbnail?: boolean }) {
  const [failed, setFailed] = useState(false);
  const video = isVideoUrl(story.media_url);

  if (failed || !story.media_url) {
    return (
      <span className="grid h-full w-full place-items-center bg-[#121216] text-center text-[var(--muted)]">
        <span>
          <ImageOff className="mx-auto" size={thumbnail ? 24 : 34} />
          {!thumbnail ? <span className="mt-2 block text-sm">Медиа недоступно</span> : null}
        </span>
      </span>
    );
  }

  if (video) {
    return (
      <video
        src={story.media_url}
        controls={!thumbnail}
        autoPlay={!thumbnail}
        muted={thumbnail}
        playsInline
        preload={thumbnail ? "metadata" : "auto"}
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
        aria-label={story.title || "Видеоистория"}
      />
    );
  }

  return (
    <img
      src={story.media_url}
      alt={story.title || "История профиля"}
      loading={thumbnail ? "lazy" : "eager"}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}

function isVideoUrl(url: string) {
  const cleanUrl = url.split(/[?#]/, 1)[0]?.toLocaleLowerCase("en-US") ?? "";
  return /\.(mp4|m4v|mov|webm|ogv)$/.test(cleanUrl);
}

function formatStoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
