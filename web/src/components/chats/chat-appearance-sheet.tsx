"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Crown, Moon, Sparkles, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import {
  CHAT_ACCENTS,
  CHAT_WALLPAPERS,
  getPrefsSnapshot,
  getServerPrefsSnapshot,
  subscribePrefs,
  writePrefs,
  type SitePrefs
} from "@/lib/site-prefs";
import { useUiStore } from "@/store/ui";
import { BottomSheet } from "../ui/bottom-sheet";

/**
 * Chat appearance and Chat wallpaper, the two sheets the reference opens from the chat menu.
 *
 * They edit the same stored appearance as Site settings rather than a per-chat copy: the
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
      title="Chat appearance"
      description="Theme and conversation color"
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Chat appearance</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">
          The color applies across the whole messenger: messages, buttons, checkmarks.
        </p>

        <p className={SECTION}>Theme</p>
        <div className="mb-1 mt-2 grid grid-cols-3 gap-2">
          {[
            { key: "light", label: "Light", icon: Sun, active: false },
            { key: "dark", label: "Dark", icon: Moon, active: true },
            { key: "system", label: "System", icon: Sparkles, active: false }
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={!option.active}
              aria-pressed={option.active}
              title={option.active ? undefined : "Coming in the next update"}
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
          GRAM is dark-only for now — a light palette will arrive when the tokens are rebuilt.
        </p>

        <p className={SECTION}>Color</p>
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
            This is how your messages look
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
  const me = useQuery({ queryKey: ["me"], queryFn: api.currentUser, enabled: open });
  const openPremium = useUiStore((state) => state.openPremium);
  const premium = Boolean(me.data?.is_premium);

  function showPremium() {
    onOpenChange(false);
    window.setTimeout(openPremium, 0);
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Chat wallpaper" description="The wallpaper behind your conversation">
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Chat wallpaper</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">
          Five base wallpapers are available to everyone. Three extra ones are part of GRAM Premium.
        </p>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
          {CHAT_WALLPAPERS.map((paper) => {
            const active = prefs.chatWallpaper === paper.value;
            // A Premium wallpaper already chosen stays visible after expiry. The subscription
            // buys the choice, just like the profile palette; selecting another one locks it.
            const locked = Boolean(paper.premium && !premium && !active);
            return (
              <button
                key={paper.value}
                type="button"
                aria-pressed={active}
                aria-label={`${paper.label}${locked ? " — GRAM Premium" : ""}`}
                onClick={() => (locked ? showPremium() : update({ chatWallpaper: paper.value }))}
                className="relative grid gap-1.5 rounded-[14px] p-1 text-[11px] text-[var(--muted)] transition active:scale-95"
                style={active ? { background: "rgba(109,95,196,.22)", color: "var(--identity)" } : undefined}
              >
                <span
                  className="relative block aspect-[3/4] overflow-hidden rounded-[10px]"
                  style={{ background: paper.preview, boxShadow: "inset 0 0 0 1px var(--line)" }}
                >
                  {locked ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/45 text-[var(--stars)] backdrop-blur-[1px]">
                      <Crown size={17} />
                    </span>
                  ) : active ? (
                    <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-black/45 text-white">
                      <Check size={14} />
                    </span>
                  ) : null}
                </span>
                <span className="inline-flex items-center justify-center gap-1">
                  {paper.premium ? <Crown size={11} className="text-[var(--stars)]" /> : null}
                  {paper.label}
                </span>
              </button>
            );
          })}
        </div>
        <label className="mt-4 flex min-h-12 items-center justify-between gap-3 rounded-[14px] bg-[var(--surface-raised)] px-3">
          <span className="text-sm font-semibold">Pattern over the wallpaper</span>
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
