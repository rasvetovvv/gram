"use client";

import { Check, Moon, Sparkles, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  CHAT_ACCENTS,
  CHAT_WALLPAPERS,
  getPrefsSnapshot,
  getServerPrefsSnapshot,
  subscribePrefs,
  writePrefs,
  type SitePrefs
} from "@/lib/site-prefs";
import { BottomSheet } from "../ui/bottom-sheet";

/**
 * «Оформление чата» and «Фон чата», the two sheets the reference opens from the chat menu.
 *
 * They edit the same stored appearance as «Настройки сайта» rather than a per-chat copy: the
 * reference says as much in its own subtitle — the colour applies to the whole messenger — and
 * two places that disagree about one setting is worse than one place that is reachable twice.
 */
const SECTION = "text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--faint)]";

function usePrefs(): [SitePrefs, (patch: Partial<SitePrefs>) => void] {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefsSnapshot, getServerPrefsSnapshot);
  return [prefs, (patch) => writePrefs({ ...prefs, ...patch })];
}

export function ChatAppearanceSheet({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [prefs, update] = usePrefs();

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Оформление чата"
      description="Тема и цвет переписки"
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Оформление чата</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">
          Цвет применяется ко всему мессенджеру: сообщения, кнопки, галочки.
        </p>

        <p className={SECTION}>Тема</p>
        <div className="mb-1 mt-2 grid grid-cols-3 gap-2">
          {[
            { key: "light", label: "Светлая", icon: Sun, active: false },
            { key: "dark", label: "Тёмная", icon: Moon, active: true },
            { key: "system", label: "Системная", icon: Sparkles, active: false }
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={!option.active}
              aria-pressed={option.active}
              title={option.active ? undefined : "Появится в следующем обновлении"}
              className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-[16px] text-[13px] font-semibold disabled:text-[var(--dim)]"
              style={
                option.active
                  ? { background: "rgba(109,95,196,.22)", color: "var(--identity)" }
                  : { background: "var(--surface-raised)" }
              }
            >
              <option.icon size={20} />
              {option.label}
              {option.active ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
        <p className="mb-5 mt-2 text-[12px] text-[var(--dim)]">
          GRAM пока только тёмный — светлая палитра появится вместе с пересборкой токенов.
        </p>

        <p className={SECTION}>Цвет</p>
        <div className="mt-2 flex flex-wrap gap-3 pb-2">
          {CHAT_ACCENTS.map((accent) => {
            const active = prefs.chatAccent === accent.value;
            return (
              <button
                key={accent.value}
                type="button"
                aria-pressed={active}
                aria-label={accent.label}
                onClick={() => update({ chatAccent: accent.value })}
                className="grid w-[62px] justify-items-center gap-1.5 text-[11px] text-[var(--muted)] transition active:scale-95"
              >
                <span
                  className="grid size-11 place-items-center rounded-full"
                  style={{
                    background: accent.color,
                    boxShadow: active ? "0 0 0 3px var(--sheet), 0 0 0 5px #ffffff" : undefined
                  }}
                >
                  {active ? <Check size={18} className="text-white" /> : null}
                </span>
                <span className="w-full truncate text-center">{accent.label}</span>
              </button>
            );
          })}
        </div>

        {/* The choice is judged against a bubble, not a swatch. */}
        <div className="mt-3 flex justify-end rounded-[16px] bg-[var(--surface-2)] p-3">
          <span
            className="max-w-[80%] rounded-[15px] rounded-br-[5px] px-2 pb-[5px] pt-1 text-[15px] text-white"
            style={{ background: "var(--chat-accent, var(--primary))" }}
          >
            Так выглядят ваши сообщения
          </span>
        </div>
      </div>
    </BottomSheet>
  );
}

export function ChatWallpaperSheet({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [prefs, update] = usePrefs();

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Фон чата" description="Обои под перепиской">
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Фон чата</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">
          Обои под перепиской и узор поверх них.
        </p>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
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
      </div>
    </BottomSheet>
  );
}
