"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Lock, Smile } from "lucide-react";
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
      notify("Настройка не сохранилась", { variant: "error", detail: error.message })
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
 * A choice of three, where a switch would lie: "кто может мне писать" is not on-or-off.
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
        Кто видит, что вы в сети, и кто может смотреть ваши публикации.
      </p>
      {loading || !settings ? (
        <Loading />
      ) : (
        <>
          <Toggle
            label="Показывать, когда я в сети"
            hint="Выключено — вместо точки и времени другие видят «был(а) недавно»."
            checked={settings.show_online}
            disabled={update.isPending}
            onChange={(next) => update.mutate({ show_online: next })}
          />
          <Toggle
            label="Закрытый аккаунт"
            hint="Профиль остаётся открытым, а посты, истории и ответы видят только подписчики. Заявки на подписку приходят в уведомления."
            checked={settings.private_account}
            disabled={update.isPending}
            onChange={(next) => update.mutate({ private_account: next })}
          />
          <Choice<MessagePrivacy>
            label="Кто может мне писать"
            value={settings.who_can_message}
            disabled={update.isPending}
            onChange={(next) => update.mutate({ who_can_message: next })}
            options={[
              { value: "everyone", title: "Все", hint: "Любой может начать диалог." },
              {
                value: "following",
                title: "Только те, кого я читаю",
                hint: "Остальным при попытке написать скажут об этом."
              },
              {
                value: "nobody",
                title: "Никто",
                hint: "Новые диалоги не открываются; уже начатые продолжают работать."
              }
            ]}
          />
          <p className="m-0 flex items-start gap-2 rounded-[14px] bg-white/[0.04] p-3 text-[0.8rem] leading-5 text-[var(--muted)]">
            <Lock size={14} className="mt-0.5 flex-none" />
            Заметки о других людях видны только вам — это не зависит от настроек.
          </p>
        </>
      )}
    </div>
  );
}

export function NotificationSettings() {
  const { settings, loading, update } = useSettings();
  const rows: { key: keyof AccountSettings; label: string; hint: string }[] = [
    { key: "notify_likes", label: "Лайки", hint: "Когда кому-то понравился ваш пост." },
    { key: "notify_comments", label: "Ответы и сообщества", hint: "Комментарии и события сообществ." },
    { key: "notify_follows", label: "Новые подписчики", hint: "Когда на вас подписались." },
    { key: "notify_messages", label: "Сообщения", hint: "Личные и групповые чаты." },
    { key: "notify_gifts", label: "Подарки", hint: "Полученные подарки, офферы и передачи." },
    { key: "notify_stars", label: "Звёзды и подписки", hint: "Переводы, платные подписки." }
  ];
  return (
    <div className="mt-4 grid gap-3">
      <p className="mb-0 text-[0.86rem] leading-5 text-[var(--muted)]">
        Что показывать в списке уведомлений и всплывающих подсказках.
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
            Сообщения о входе в аккаунт приходят всегда — это безопасность, а не рассылка.
          </p>
        </>
      )}
    </div>
  );
}

/** Emoji plus a short line, shown beside the name on the profile. */
export function StatusSettings() {
  const { settings, loading, update } = useSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? settings?.status_text ?? "";

  if (loading || !settings) return <Loading rows={1} />;

  return (
    <div className="grid gap-2">
      <span className="text-[0.98rem] font-extrabold">Статус</span>
      <span className="text-[0.82rem] leading-5 text-[var(--muted)]">
        Эмодзи и короткая строка рядом с именем. Пустая строка убирает статус.
      </span>
      <div className="flex flex-wrap gap-1.5">
        {STATUS_EMOJI.map((emoji) => {
          const active = settings.status_emoji === emoji;
          return (
            <button
              key={emoji}
              type="button"
              aria-pressed={active}
              aria-label={`Статус ${emoji}`}
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
          Убрать
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Smile size={16} className="flex-none text-[var(--muted)]" />
        <input
          className="field px-4"
          maxLength={40}
          placeholder="например: сплю, в отпуске, на созвоне"
          aria-label="Текст статуса"
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
