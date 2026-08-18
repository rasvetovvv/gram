"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { nameColor } from "@/lib/profile-color";
import { UserAvatar } from "../user-avatar";
import { PremiumMark } from "../premium-mark";
import { VerifiedMark } from "../verified-mark";

/**
 * The reference marks selection in the group flow with its own sky accent rather than the
 * chat's purple, so the picked state reads as "chosen for this list", not "brand".
 */
const PICK_ACCENT = "#0ea5e9";

/**
 * Full-screen picker shared by "Новое сообщение", "Секретный чат", group creation and
 * "Добавить участников", copied from the reference's own screen: a bordered header with a
 * back arrow and one trailing action, a pill search field, and 60px person rows.
 *
 * `mode` decides whether tapping a row commits immediately or accumulates a selection —
 * the reference uses the same screen for both, differing only in the check circle and the
 * strip of chosen faces above the field.
 */
export function PeoplePicker({
  open,
  onClose,
  ...rest
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  mode: "single" | "multi";
  placeholder: string;
  note?: string;
  actionLabel?: string;
  onPick?: (user: User) => void;
  onSubmit?: (users: User[]) => void;
  excludeIds?: string[];
  accent?: string;
  tone?: "default" | "secret";
  pending?: boolean;
}) {
  // The body only exists while open, so closing discards the query and the selection by
  // unmounting rather than by resetting state in an effect.
  return (
    <AnimatePresence>{open ? <PickerBody onClose={onClose} {...rest} /> : null}</AnimatePresence>
  );
}

function PickerBody({
  onClose,
  title,
  mode,
  placeholder,
  note,
  actionLabel,
  onPick,
  onSubmit,
  excludeIds = [],
  accent = PICK_ACCENT,
  tone = "default",
  pending = false
}: {
  onClose: () => void;
  title: string;
  mode: "single" | "multi";
  placeholder: string;
  note?: string;
  actionLabel?: string;
  onPick?: (user: User) => void;
  onSubmit?: (users: User[]) => void;
  excludeIds?: string[];
  accent?: string;
  tone?: "default" | "secret";
  pending?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<User[]>([]);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const needle = query.trim();
  const recommended = useQuery({
    queryKey: ["recommended-users"],
    queryFn: api.recommendedUsers,
    enabled: !needle
  });
  const found = useQuery({
    queryKey: ["search", needle],
    queryFn: () => api.search(needle),
    enabled: needle.length > 0
  });

  const people = useMemo(() => {
    const source = needle ? (found.data?.people ?? []) : (recommended.data ?? []);
    const skip = new Set(excludeIds);
    return source.filter((user) => !skip.has(user.id));
  }, [needle, found.data, recommended.data, excludeIds]);
  const loading = needle ? found.isFetching : recommended.isLoading;

  function toggle(user: User) {
    if (mode === "single") {
      onPick?.(user);
      return;
    }
    setPicked((current) =>
      current.some((item) => item.id === user.id)
        ? current.filter((item) => item.id !== user.id)
        : [...current, user]
    );
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      initial={reduceMotion ? undefined : { opacity: 0, y: 24 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: 24 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[60] flex flex-col bg-[var(--sheet)] text-[var(--ink)]"
    >
      <div
        className={`flex flex-none items-center gap-2 border-b px-2 py-3 ${
          tone === "secret" ? "border-emerald-500/15" : "border-[var(--sheet-line)]"
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Назад"
          className="inline-flex size-10 items-center justify-center rounded-full transition active:bg-white/10"
        >
          <ArrowLeft size={24} />
        </button>
        <h2 className="m-0 flex flex-1 items-center gap-2 text-[18px] font-medium">
          {title}
          {tone === "secret" ? <LockGlyph /> : null}
        </h2>
        {mode === "multi" && actionLabel ? (
          <button
            type="button"
            disabled={!picked.length || pending}
            onClick={() => onSubmit?.(picked)}
            className="h-9 rounded-full px-4 text-[15px] font-medium transition disabled:opacity-50"
            style={picked.length ? { background: accent, color: "#fff" } : { color: "var(--muted)" }}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>

      {mode === "multi" && picked.length ? (
        <div className="flex flex-none gap-3 overflow-x-auto px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {picked.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => toggle(user)}
              aria-label={`Убрать ${user.display_name}`}
              className="flex w-14 shrink-0 flex-col items-center gap-1"
            >
              <span className="relative">
                <UserAvatar src={user.avatar_url} name={user.display_name} size={48} />
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 inline-flex size-4 items-center justify-center rounded-full text-white"
                  style={{ background: accent }}
                >
                  <X size={12} />
                </span>
              </span>
              <span className="w-full truncate text-center text-[11px] text-[var(--muted)]">
                {user.display_name}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex-none px-3 py-2">
        <div className="flex h-10 items-center gap-2 rounded-full bg-white/[0.06] px-4">
          <Search size={20} className="flex-none text-[var(--muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--muted)]"
          />
        </div>
      </div>

      {note ? (
        <p
          className={`m-0 flex-none px-4 pb-1 text-[12px] ${
            tone === "secret" ? "text-emerald-400/80" : "text-[var(--muted)]"
          }`}
        >
          {note}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="m-0 px-3 py-4 text-center text-[13px] text-[var(--muted)]">Поиск…</p>
        ) : null}
        {!loading && !people.length ? (
          <p className="m-0 px-3 py-4 text-center text-[13px] text-[var(--muted)]">
            {needle ? "Никого не нашли" : "Некого предложить"}
          </p>
        ) : null}
        {people.map((user) => {
          const chosen = picked.some((item) => item.id === user.id);
          return (
            <button
              key={user.id}
              type="button"
              onClick={() => toggle(user)}
              aria-pressed={mode === "multi" ? chosen : undefined}
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition active:bg-white/[0.04]"
            >
              <UserAvatar
                src={user.avatar_url}
                name={user.display_name}
                online={user.is_online}
                size={44}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span
                    className="truncate text-[15px]"
                    style={{ color: nameColor(user.profile_color) }}
                  >
                    {user.display_name}
                  </span>
                  {user.verified ? <VerifiedMark size={15} /> : null}
                  {user.is_premium ? (
                    <PremiumMark size={14} profileColor={user.profile_color} />
                  ) : null}
                </span>
                <span className="block truncate text-[13px] text-[var(--muted)]">
                  @{user.username}
                </span>
              </span>
              {mode === "multi" ? (
                <span
                  aria-hidden
                  className="inline-flex size-6 flex-none items-center justify-center rounded-full border transition"
                  style={
                    chosen
                      ? { borderColor: accent, background: accent, color: "#fff" }
                      : { borderColor: "rgba(255,255,255,.2)" }
                  }
                >
                  {chosen ? <Check size={16} /> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

/** The reference marks a secret chat with a small emerald padlock beside the title. */
function LockGlyph() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden className="text-emerald-400">
      <path
        d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 0 1 6 0v3H9Z"
        fill="currentColor"
      />
    </svg>
  );
}
