"use client";

import { Check, MessageCircle, Moon, Palette, Sparkles, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  CHAT_ACCENTS,
  CHAT_WALLPAPERS,
  DEFAULT_PREFS,
  getPrefsSnapshot,
  getServerPrefsSnapshot,
  subscribePrefs,
  writePrefs,
  type SitePrefs
} from "@/lib/site-prefs";

/**
 * «Настройки сайта»: how the interface looks, as opposed to who you are.
 *
 * Only choices that actually change something are offered. A light theme would mean auditing
 * every colour token, so the control says so instead of shipping a half-inverted screen.
 */
export function SiteSettingsView() {
  // The store is localStorage plus a change event, which is exactly what this hook is for.
  const prefs = useSyncExternalStore(subscribePrefs, getPrefsSnapshot, getServerPrefsSnapshot);

  function update(patch: Partial<SitePrefs>) {
    writePrefs({ ...prefs, ...patch });
  }

  return (
    <>
      <div className="mobile-topbar">
        <span className="wordmark">ОФОРМЛЕНИЕ</span>
        <Palette size={20} />
      </div>

      <header className="channel-header">
        <div>
          <h1 className="channel-title">Настройки сайта</h1>
          <p className="channel-subtitle">Тема, цвет чатов и фон переписки</p>
        </div>
      </header>

      <div className="space-y-3 px-3 pb-8 sm:px-5">
        <section className="surface p-4">
          <h2 className="m-0 flex items-center gap-2 text-base font-bold">
            <Moon size={17} className="text-[var(--primary-strong)]" />
            Тема
          </h2>
          <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
            GRAM пока только тёмный. Светлая тема требует пересборки всей палитры — пока её нет,
            переключатель об этом говорит честно.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed
              className="flex min-h-12 items-center justify-center gap-2 rounded-[14px] text-sm font-semibold"
              style={{ background: "rgba(109,95,196,.22)", color: "var(--identity)" }}
            >
              <Moon size={16} />
              Тёмная
              <Check size={15} />
            </button>
            <button
              type="button"
              disabled
              title="Появится в следующем обновлении"
              className="flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-[var(--surface-raised)] text-sm font-semibold text-[var(--dim)]"
            >
              <Sun size={16} />
              Светлая — скоро
            </button>
          </div>
        </section>

        <section className="surface p-4">
          <h2 className="m-0 flex items-center gap-2 text-base font-bold">
            <MessageCircle size={17} className="text-[var(--primary-strong)]" />
            Цвет чатов
          </h2>
          <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
            Красит ваши сообщения, кнопку отправки и «Новый чат».
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {CHAT_ACCENTS.map((accent) => {
              const active = prefs.chatAccent === accent.value;
              return (
                <button
                  key={accent.value}
                  type="button"
                  aria-pressed={active}
                  aria-label={accent.label}
                  title={accent.label}
                  onClick={() => update({ chatAccent: accent.value })}
                  className="grid size-11 place-items-center rounded-full transition active:scale-95"
                  style={{
                    background: accent.color,
                    boxShadow: active ? "0 0 0 3px var(--canvas), 0 0 0 5px #ffffff" : undefined
                  }}
                >
                  {active ? <Check size={18} className="text-white" /> : null}
                </button>
              );
            })}
          </div>
          {/* A preview, so the choice is judged against a bubble rather than a swatch. */}
          <div className="mt-4 flex justify-end rounded-[16px] bg-[var(--surface-2)] p-3">
            <span
              className="max-w-[80%] rounded-[15px] rounded-br-[5px] px-2 pb-[5px] pt-1 text-[15px] text-white"
              style={{ background: "var(--chat-accent, var(--primary))" }}
            >
              Так выглядят ваши сообщения
            </span>
          </div>
        </section>

        <section className="surface p-4">
          <h2 className="m-0 flex items-center gap-2 text-base font-bold">
            <Sparkles size={17} className="text-[var(--primary-strong)]" />
            Фон чата
          </h2>
          <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
            Обои под перепиской и узор поверх них.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {CHAT_WALLPAPERS.map((paper) => {
              const active = prefs.chatWallpaper === paper.value;
              return (
                <button
                  key={paper.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ chatWallpaper: paper.value })}
                  className="grid gap-1.5 rounded-[14px] p-1 text-[11px] text-[var(--muted)] transition active:scale-95"
                  style={active ? { background: "rgba(109,95,196,.22)", color: "var(--identity)" } : undefined}
                >
                  <span
                    className="block aspect-[3/4] rounded-[10px]"
                    style={{ background: paper.preview, boxShadow: "inset 0 0 0 1px var(--line)" }}
                  />
                  {paper.label}
                </button>
              );
            })}
          </div>
          <label className="mt-4 flex min-h-12 items-center justify-between gap-3 rounded-[14px] bg-[var(--surface-raised)] px-3">
            <span className="text-sm font-semibold">Узор поверх фона</span>
            <input
              type="checkbox"
              checked={prefs.chatPattern}
              onChange={(event) => update({ chatPattern: event.target.checked })}
              className="size-5 accent-[var(--primary)]"
            />
          </label>
        </section>

        <button
          type="button"
          className="quiet-button w-full"
          onClick={() => update(DEFAULT_PREFS)}
        >
          Сбросить оформление
        </button>
      </div>
    </>
  );
}
