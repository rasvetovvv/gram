"use client";

import { BookOpen, Check, FileWarning, MessageCircle, Moon, Palette, Sparkles, Sun } from "lucide-react";
import Link from "next/link";
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
 * Site settings: how the interface looks, as opposed to who you are.
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
        <span className="wordmark">APPEARANCE</span>
        <Palette size={20} />
      </div>

      <header className="channel-header">
        <div>
          <h1 className="channel-title">Site settings</h1>
          <p className="channel-subtitle">Theme, chat color and conversation wallpaper</p>
        </div>
      </header>

      <div className="space-y-3 px-3 pb-8 sm:px-5">
        <section className="surface p-4">
          <h2 className="m-0 flex items-center gap-2 text-base font-bold">
            <Moon size={17} className="text-[var(--primary-strong)]" />
            Theme
          </h2>
          <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
            GRAM is dark-only for now. A light theme would mean rebuilding the entire palette — until
            it exists, the toggle says so honestly.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed
              className="flex min-h-12 items-center justify-center gap-2 rounded-[14px] text-sm font-semibold"
              style={{ background: "rgba(109,95,196,.22)", color: "var(--identity)" }}
            >
              <Moon size={16} />
              Dark
              <Check size={15} />
            </button>
            <button
              type="button"
              disabled
              title="Coming in the next update"
              className="flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-[var(--surface-raised)] text-sm font-semibold text-[var(--dim)]"
            >
              <Sun size={16} />
              Light — soon
            </button>
          </div>
        </section>

        <section className="surface p-4">
          <h2 className="m-0 flex items-center gap-2 text-base font-bold">
            <MessageCircle size={17} className="text-[var(--primary-strong)]" />
            Chat color
          </h2>
          <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
            Colors your messages, the send button and &quot;New chat&quot;.
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
              This is how your messages look
            </span>
          </div>
        </section>

        <section className="surface p-4">
          <h2 className="m-0 flex items-center gap-2 text-base font-bold">
            <Sparkles size={17} className="text-[var(--primary-strong)]" />
            Chat wallpaper
          </h2>
          <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
            The wallpaper behind your conversation, and the pattern over it.
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
            <span className="text-sm font-semibold">Pattern over the wallpaper</span>
            <input
              type="checkbox"
              checked={prefs.chatPattern}
              onChange={(event) => update({ chatPattern: event.target.checked })}
              className="size-5 accent-[var(--primary)]"
            />
          </label>
        </section>

        <section className="surface p-4">
          <h2 className="m-0 flex items-center gap-2 text-base font-bold">
            <BookOpen size={17} className="text-[var(--primary-strong)]" />
            Help and documents
          </h2>
          <p className="mb-3 mt-1 text-sm text-[var(--muted)]">
            Guides, terms, privacy and a secure support form.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Link href="/help" className="quiet-button justify-start">Help center</Link>
            <Link href="/faq" className="quiet-button justify-start">FAQ</Link>
            <Link href="/terms" className="quiet-button justify-start">Terms and policies</Link>
            <Link href="/report" className="quiet-button justify-start text-[var(--danger)]">
              <FileWarning size={15} />
              Report or contact
            </Link>
          </div>
        </section>

        <button
          type="button"
          className="quiet-button w-full"
          onClick={() => update(DEFAULT_PREFS)}
        >
          Reset appearance
        </button>
      </div>
    </>
  );
}
