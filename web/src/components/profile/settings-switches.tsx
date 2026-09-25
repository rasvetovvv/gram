"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Eye, Lock, Smile } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import type { AccountSettings, MessagePrivacy } from "@/lib/types";
import { useToast } from "../ui/toast";

/**
 * The account's own switches, split into the two sections the edit sheet already offers.
 *
 * Each one is a real server field with a visible consequence — hidden presence, a closed
 * account, a silenced kind of notification — so nothing here is a decoration.
 */
const STATUS_EMOJI = ["🌙", "💤", "🎧", "🎮", "📚", "☕️", "🏝️", "🔥", "🧊", "❤️"];

function useSettings() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const query = useQuery({ queryKey: ["my-settings"], queryFn: api.mySettings });
  const update = useMutation({
    mutationFn: (patch: Partial<AccountSettings>) => api.updateMySettings(patch),
    onSuccess: (next) => {
      queryClient.setQueryData(["my-settings"], next);
      // Presence and privacy are read back from the profile, so it has to be refetched.
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (error: Error) =>
      notify("Setting didn't save", { variant: "error", detail: error.message })
  });
  return { settings: query.data, loading: query.isLoading, error: query.error, update };
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[16px] bg-[var(--surface-raised)] p-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[0.95rem] font-bold">{label}</span>
        {hint ? (
          <span className="mt-0.5 block text-[0.8rem] leading-5 text-[var(--muted)]">{hint}</span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative mt-0.5 h-6 w-11 flex-none rounded-full transition disabled:opacity-50"
        style={{ background: checked ? "var(--primary)" : "rgba(255,255,255,.16)" }}
      >
        <span
          aria-hidden
          className="absolute top-0.5 size-5 rounded-full bg-white transition-all"
          style={{ left: checked ? "22px" : "2px" }}
        />
      </button>
    </div>
  );
}

function Loading({ rows = 2 }: { rows?: number }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-16 rounded-[16px]" />
      ))}
    </div>
  );
}

/**
 * A choice of three, where a switch would lie: "who can message me" is not on-or-off.
 * The chosen row explains what it does, so the consequence is visible before it is saved.
 */
function Choice<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange
}: {
  label: string;
  value: T;
  options: { value: T; title: string; hint: string }[];
  disabled?: boolean;
  onChange: (next: T) => void;
}) {
  return (
    <div className="grid gap-1.5 rounded-[16px] bg-[var(--surface-raised)] p-3">
      <span className="text-[0.95rem] font-bold">{label}</span>
      <div role="radiogroup" aria-label={label} className="grid gap-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className="flex items-center gap-3 rounded-[13px] px-2.5 py-2 text-left transition disabled:opacity-50"
            style={value === option.value ? { background: "rgba(255,255,255,.06)" } : undefined}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9rem] font-semibold">{option.title}</span>
              <span className="block text-[0.78rem] leading-4 text-[var(--muted)]">
                {option.hint}
              </span>
            </span>
            <span
              aria-hidden
              className="grid size-[18px] flex-none place-items-center rounded-full border"
              style={{
                borderColor:
                  value === option.value ? "var(--primary-strong)" : "var(--line-strong)",
                background: value === option.value ? "var(--primary-strong)" : "transparent"
              }}
            >
              {value === option.value ? (
                <span className="size-1.5 rounded-full bg-white" />
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PrivacySettings() {
  const { settings, loading, update } = useSettings();
  return (
    <div className="mt-4 grid gap-3">
      <p className="mb-0 text-[0.86rem] leading-5 text-[var(--muted)]">
        Who can see when you&apos;re online, and who can view your posts.
      </p>
      {loading || !settings ? (
        <Loading />
      ) : (
        <>
          <Toggle
            label="Show when I'm online"
            hint="Off — instead of the dot and time, others see “last seen recently”."
            checked={settings.show_online}
            disabled={update.isPending}
            onChange={(next) => update.mutate({ show_online: next })}
          />
          <Toggle
            label="Private account"
            hint="Your profile stays open, but only followers see your posts, stories and replies. Follow requests arrive in notifications."
            checked={settings.private_account}
            disabled={update.isPending}
            onChange={(next) => update.mutate({ private_account: next })}
          />
          <Choice<MessagePrivacy>
            label="Who can message me"
            value={settings.who_can_message}
            disabled={update.isPending}
            onChange={(next) => update.mutate({ who_can_message: next })}
            options={[
              { value: "everyone", title: "Everyone", hint: "Anyone can start a conversation." },
              {
                value: "following",
                title: "Only people I follow",
                hint: "Others are told when they try to message you."
              },
              {
                value: "nobody",
                title: "Nobody",
                hint: "No new conversations open; existing ones keep working."
              }
            ]}
          />
          <Toggle
            label="Accept usernames"
            hint="Off — nobody can transfer a username to you. It doesn't stop people from buying a username you've listed."
            checked={settings.accept_usernames}
            disabled={update.isPending}
            onChange={(next) => update.mutate({ accept_usernames: next })}
          />
          <Toggle
            label="Accept gifts"
            hint="Off — no one can send you a gift from the catalog or transfer one from their collection."
            checked={settings.accept_gifts}
            disabled={update.isPending}
            onChange={(next) => update.mutate({ accept_gifts: next })}
          />
          <p className="m-0 flex items-start gap-2 rounded-[14px] bg-white/[0.04] p-3 text-[0.8rem] leading-5 text-[var(--muted)]">
            <Lock size={14} className="mt-0.5 flex-none" />
            Notes about other people are visible only to you — this doesn&apos;t depend on settings.
          </p>
        </>
      )}
    </div>
  );
}

export function NotificationSettings() {
  const { settings, loading, update } = useSettings();
  const rows: { key: keyof AccountSettings; label: string; hint: string }[] = [
    { key: "notify_likes", label: "Likes", hint: "When someone likes your post." },
    { key: "notify_comments", label: "Replies and communities", hint: "Comments and community activity." },
    { key: "notify_follows", label: "New followers", hint: "When someone follows you." },
    { key: "notify_messages", label: "Messages", hint: "Direct and group chats." },
    { key: "notify_gifts", label: "Gifts", hint: "Received gifts, offers and transfers." },
    { key: "notify_stars", label: "Stars and subscriptions", hint: "Transfers and paid subscriptions." }
  ];
  return (
    <div className="mt-4 grid gap-3">
      <p className="mb-0 text-[0.86rem] leading-5 text-[var(--muted)]">
        What to show in the notifications list and popups.
      </p>
      {loading || !settings ? (
        <Loading rows={4} />
      ) : (
        <>
          {rows.map((row) => (
            <Toggle
              key={row.key}
              label={row.label}
              hint={row.hint}
              checked={Boolean(settings[row.key])}
              disabled={update.isPending}
              onChange={(next) => update.mutate({ [row.key]: next })}
            />
          ))}
          <p className="m-0 flex items-start gap-2 rounded-[14px] bg-white/[0.04] p-3 text-[0.8rem] leading-5 text-[var(--muted)]">
            <Eye size={14} className="mt-0.5 flex-none" />
            Sign-in alerts always arrive — that&apos;s security, not a newsletter.
          </p>
        </>
      )}
    </div>
  );
}

/** Emoji plus a short line, shown beside the name on the profile. */
export function StatusSettings() {
  const { settings, loading, update } = useSettings();
  const me = useQuery({ queryKey: ["me"], queryFn: api.currentUser });
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? settings?.status_text ?? "";
  // The emoji is Premium's; the words are anybody's. One already set keeps showing.
  const premium = Boolean(me.data?.is_premium);

  if (loading || !settings) return <Loading rows={1} />;

  return (
    <div className="grid gap-2">
      <span className="text-[0.98rem] font-extrabold">Status</span>
      <span className="text-[0.82rem] leading-5 text-[var(--muted)]">
        An emoji and a short line next to your name. An empty line removes the status.
      </span>
      {premium ? null : (
        <span className="flex items-start gap-2 rounded-[14px] bg-[var(--surface-raised)] p-3 text-[0.8rem] leading-5 text-[var(--muted)]">
          <Crown size={15} className="mt-0.5 flex-none text-[var(--stars)]" />
          <span>
            The emoji next to your name is part of{" "}
            <Link href="/premium" className="font-semibold text-[var(--link)]">
              GRAM Premium
            </Link>
            . A text status is available to everyone.
          </span>
        </span>
      )}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_EMOJI.map((emoji) => {
          const active = settings.status_emoji === emoji;
          return (
            <button
              key={emoji}
              type="button"
              aria-pressed={active}
              aria-label={`Status ${emoji}`}
              disabled={!premium && !active}
              onClick={() => update.mutate({ status_emoji: active ? null : emoji })}
              className="grid size-10 place-items-center rounded-[12px] text-[19px] transition active:scale-95"
              style={{
                background: active ? "rgba(109,95,196,.28)" : "var(--surface-raised)",
                boxShadow: active ? "inset 0 0 0 1px var(--primary)" : undefined
              }}
            >
              {emoji}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => update.mutate({ status_emoji: null, status_text: null })}
          className="grid h-10 place-items-center rounded-[12px] bg-[var(--surface-raised)] px-3 text-[13px] text-[var(--muted)] transition active:scale-95"
        >
          Remove
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Smile size={16} className="flex-none text-[var(--muted)]" />
        <input
          className="field px-4"
          maxLength={40}
          placeholder="e.g. sleeping, on vacation, in a call"
          aria-label="Status text"
          value={text}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const next = text.trim();
            if (next !== (settings.status_text ?? "")) update.mutate({ status_text: next || null });
            setDraft(null);
          }}
        />
      </div>
    </div>
  );
}
