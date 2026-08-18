"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { AtSign, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { nameColor, nameStyle, profileTheme } from "@/lib/profile-color";
import { UserAvatar } from "../user-avatar";

const RARITY_LABEL: Record<string, string> = {
  common: "Обычный",
  standard: "Обычный",
  rare: "Редкий",
  unique: "Уникальный",
  legendary: "Легендарный",
  founder: "Легендарный"
};

const ACTION_TEXT: Record<string, string> = {
  acquired: "Это имя приобретено у другого пользователя",
  reserved: "Это имя зарезервировано",
  profile_username: "Это имя используется как основное",
  released_handle: "Это имя сохранено за аккаунтом",
  listed: "Это имя выставлено владельцем",
  unlisted: "Это имя снято с продажи",
  registered: "Это имя занято при регистрации"
};

/** Tapping a handle shows who owns it — usernames are ownership records, not listings. */
export function UsernameOwnershipDialog({
  username,
  open,
  onOpenChange
}: {
  username: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [copied, setCopied] = useState("");
  const lookup = useQuery({
    queryKey: ["username-lookup", username],
    queryFn: () => api.usernameLookup(username),
    enabled: open
  });
  const asset = lookup.data;
  // The card follows the owner's colour scheme, so identity surfaces stay consistent.
  const theme = profileTheme(asset?.owner?.profile_color);

  async function copy(text: string, message: string) {
    await navigator.clipboard.writeText(text);
    setCopied(message);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setCopied(""); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/78 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-[440px] rounded-[28px] bg-[#17171d] p-6 text-center shadow-[0_28px_90px_rgba(0,0,0,.7)] outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2">
          <Dialog.Close className="icon-button absolute right-4 top-4" aria-label="Закрыть">
            <X size={20} />
          </Dialog.Close>
          <motion.div
            initial={reduceMotion ? undefined : { opacity: 0, scale: 0.97 }}
            animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <span
              className="mx-auto grid size-28 place-items-center rounded-full"
              style={{ background: theme.soft, color: theme.onAccent }}
            >
              <AtSign size={54} strokeWidth={2.4} />
            </span>
            {lookup.isLoading ? (
              <>
                <div className="skeleton mx-auto mt-5 h-6 w-64 rounded" />
                <div className="skeleton mx-auto mt-3 h-10 w-40 rounded-full" />
              </>
            ) : asset ? (
              <>
                <Dialog.Title className="mx-auto mt-5 max-w-[22ch] text-[1.32rem] font-extrabold leading-tight">
                  @{asset.username} — коллекционное имя пользователя, принадлежащее
                </Dialog.Title>
                {asset.owner ? (
                  <a
                    href={`/u/${asset.owner.username}`}
                    className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full bg-[#27272a] py-1.5 pl-1.5 pr-4"
                  >
                    <UserAvatar src={asset.owner.avatar_url} name={asset.owner.display_name} size={30} ringColor="#27272a" />
                    <strong className="text-[0.95rem]" style={{ color: nameColor(asset.owner.profile_color) }}>{asset.owner.display_name}</strong>
                  </a>
                ) : (
                  <p className="mb-0 mt-4 text-sm text-[var(--muted)]">Имя свободно</p>
                )}
                <Dialog.Description className="mb-0 mt-4 text-[0.92rem] leading-6 text-[var(--muted)]">
                  {ACTION_TEXT[asset.last_action ?? ""] ?? "Это имя закреплено за аккаунтом"}
                  {asset.last_action_at ? ` ${formatMoment(asset.last_action_at)}` : ""}
                </Dialog.Description>
                <span className="mt-3.5 inline-block rounded-full bg-[#27272a] px-3 py-1.5 text-xs font-bold text-[#d6d7de]">
                  {RARITY_LABEL[asset.rarity] ?? "Обычный"}
                </span>
                <button
                  className="mt-5 flex min-h-[52px] w-full items-center justify-center rounded-full border-0 px-5 text-[1.02rem] font-extrabold"
                  style={{ background: theme.soft, color: theme.onAccent }}
                  onClick={() => copy(`${window.location.origin}/u/${asset.username}`, "Ссылка скопирована")}
                >
                  Скопировать ссылку
                </button>
                <button
                  className="mt-3 min-h-11 w-full border-0 bg-transparent text-[0.95rem] font-bold text-[var(--muted)]"
                  onClick={() => copy(`@${asset.username}`, "Юзернейм скопирован")}
                >
                  Скопировать @{asset.username}
                </button>
              </>
            ) : (
              <>
                <Dialog.Title className="mt-5 text-lg font-extrabold">Имя не найдено</Dialog.Title>
                <Dialog.Description className="mb-0 mt-2 text-sm text-[var(--muted)]">
                  {lookup.error?.message ?? `@${username} пока не закреплено ни за одним аккаунтом.`}
                </Dialog.Description>
                <button className="quiet-button mt-4" onClick={() => lookup.refetch()}>
                  <RefreshCw size={16} />Повторить
                </button>
              </>
            )}
            <p className="mb-0 mt-3 min-h-5 text-xs text-[var(--online)]" aria-live="polite">{copied}</p>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Renders the profile's "а также" list, where each handle opens its ownership card.
 * Handles carry the owner's colour scheme, matching how the reference tints them.
 */
export function RelatedUsernames({ handles, profileColor }: { handles: string[]; profileColor?: string | null }) {
  const [active, setActive] = useState<string | null>(null);
  const handleStyle = nameStyle(profileColor);
  if (!handles.length) return null;
  return (
    <>
      <p className="mb-0 mt-1 text-sm leading-6">
        <span className="text-[var(--muted)]">а также </span>
        {handles.map((handle, index) => {
          const name = handle.replace(/^@+/, "");
          return (
            <span key={name}>
              <button
                type="button"
                className="border-0 bg-transparent p-0 text-sm transition-transform active:scale-95"
                style={handleStyle ?? { color: "var(--ink)" }}
                onClick={() => setActive(name)}
              >
                @{name}
              </button>
              {index < handles.length - 1 ? <span className="text-[#52525c]">, </span> : null}
            </span>
          );
        })}
      </p>
      <UsernameOwnershipDialog
        username={active ?? ""}
        open={Boolean(active)}
        onOpenChange={(open) => (open ? null : setActive(null))}
      />
    </>
  );
}

function formatMoment(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${day} в ${time}`;
}
