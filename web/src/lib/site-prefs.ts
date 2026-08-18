"use client";

/**
 * Site appearance: the parts of the interface a visitor may recolour.
 *
 * Kept in localStorage and applied as attributes on `<html>`, so a reload does not flash the
 * default first and every component can react through plain CSS rather than through props.
 */
export type ChatAccent = "violet" | "blue" | "teal" | "green" | "rose" | "orange" | "purple";
export type ChatWallpaper = "aurora" | "dusk" | "forest" | "ink" | "plain";
export type SiteTheme = "dark";

export type SitePrefs = {
  theme: SiteTheme;
  chatAccent: ChatAccent;
  chatWallpaper: ChatWallpaper;
  chatPattern: boolean;
};

export const DEFAULT_PREFS: SitePrefs = {
  theme: "dark",
  chatAccent: "violet",
  chatWallpaper: "aurora",
  chatPattern: true
};

/**
 * Accent options, each carrying the outgoing-bubble colour it produces.
 *
 * The set and its order follow the reference's «Цвет» row, with the brand colour in the lead
 * position it holds there.
 */
export const CHAT_ACCENTS: { value: ChatAccent; label: string; color: string }[] = [
  { value: "violet", label: "GRAM", color: "#6d5fc4" },
  { value: "blue", label: "Синий", color: "#2f80ed" },
  { value: "teal", label: "Бирюзовый", color: "#12a594" },
  { value: "green", label: "Зелёный", color: "#1f9d63" },
  { value: "rose", label: "Розовый", color: "#c2447c" },
  { value: "orange", label: "Оранжевый", color: "#d97706" },
  { value: "purple", label: "Фиолетовый", color: "#8b5cf6" }
];

export const CHAT_WALLPAPERS: { value: ChatWallpaper; label: string; preview: string }[] = [
  {
    value: "aurora",
    label: "Аврора",
    preview: "linear-gradient(160deg,#7a5cc4 0%,#8f5fbd 38%,#c86fa8 72%,#e08aa0 100%)"
  },
  {
    value: "dusk",
    label: "Сумерки",
    preview: "linear-gradient(160deg,#2b3d6b 0%,#3f4f86 45%,#6a5a9b 100%)"
  },
  {
    value: "forest",
    label: "Лес",
    preview: "linear-gradient(160deg,#1d4d3f 0%,#2f6b4f 45%,#5d8f5a 100%)"
  },
  { value: "ink", label: "Чернила", preview: "linear-gradient(160deg,#191a20 0%,#25262f 100%)" },
  { value: "plain", label: "Без фона", preview: "var(--canvas)" }
];

let snapshot: SitePrefs | null = null;

function invalidate() {
  snapshot = null;
}

const KEY = "gram.site";

export function readPrefs(): SitePrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<SitePrefs>;
    return {
      theme: "dark",
      chatAccent: CHAT_ACCENTS.some((item) => item.value === parsed.chatAccent)
        ? (parsed.chatAccent as ChatAccent)
        : DEFAULT_PREFS.chatAccent,
      chatWallpaper: CHAT_WALLPAPERS.some((item) => item.value === parsed.chatWallpaper)
        ? (parsed.chatWallpaper as ChatWallpaper)
        : DEFAULT_PREFS.chatWallpaper,
      chatPattern: parsed.chatPattern !== false
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Attributes, not inline styles: CSS then owns which values each choice maps to. */
export function applyPrefs(prefs: SitePrefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.chatAccent = prefs.chatAccent;
  root.dataset.chatWallpaper = prefs.chatWallpaper;
  root.dataset.chatPattern = prefs.chatPattern ? "on" : "off";
}

export function writePrefs(prefs: SitePrefs) {
  snapshot = prefs;
  applyPrefs(prefs);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
    window.dispatchEvent(new Event("gram:site"));
  } catch {
    // Private mode: the choice holds for this session and resets on the next one.
  }
}

/**
 * A cached snapshot, so `useSyncExternalStore` can compare by reference.
 *
 * Parsing on every read would hand React a fresh object each time and spin it forever, so the
 * parse happens once per change and the same object is returned until something writes.
 */

export function subscribePrefs(onChange: () => void) {
  const handle = () => {
    invalidate();
    onChange();
  };
  window.addEventListener("gram:site", handle);
  window.addEventListener("storage", handle);
  return () => {
    window.removeEventListener("gram:site", handle);
    window.removeEventListener("storage", handle);
  };
}

export function getPrefsSnapshot(): SitePrefs {
  snapshot ??= readPrefs();
  return snapshot;
}

export function getServerPrefsSnapshot(): SitePrefs {
  return DEFAULT_PREFS;
}
