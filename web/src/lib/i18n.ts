"use client";

/**
 * Lightweight client-side localisation: a locale switch (English / Russian) kept in
 * localStorage and mirrored onto <html lang>, plus a tiny dictionary and a `t()` lookup.
 *
 * The app is authored in English inline, so `t(key, fallback)` always takes the English text
 * as its fallback: an untranslated key renders exactly as before, and a key present in the
 * Russian dictionary is swapped when the locale is `ru`. This lets the switcher work today on
 * the surfaces that opt in (navigation, settings, market) and lets the rest be translated
 * incrementally without ever showing a raw key.
 */
import { useSyncExternalStore } from "react";

export type Locale = "en" | "ru";
export const LOCALES: { value: Locale; label: string; native: string }[] = [
  { value: "en", label: "English", native: "English" },
  { value: "ru", label: "Russian", native: "Русский" }
];

const KEY = "gram.locale";

/**
 * Russian overrides, keyed by the English source string. Only the surfaces wired with `t()`
 * need entries here; anything missing falls back to its English source, so adding a screen to
 * the switcher is just adding its lines below.
 */
const RU: Record<string, string> = {
  // Desktop navigation
  Feed: "Лента",
  Search: "Поиск",
  Notifications: "Уведомления",
  Messages: "Сообщения",
  Communities: "Сообщества",
  Market: "Маркет",
  Gifts: "Подарки",
  Studio: "Студия",
  Stars: "Звёзды",
  Profile: "Профиль",
  "GRAM Premium": "GRAM Premium",
  Administration: "Администрирование",
  Settings: "Настройки",
  "Help and rules": "Помощь и правила",
  "Log out": "Выйти",
  // Mobile dock
  Home: "Главная",
  Discover: "Поиск",
  Events: "События",
  Chats: "Чаты",
  // Site settings
  "Site settings": "Настройки сайта",
  "Theme, chat color and conversation wallpaper":
    "Тема, цвет чата и фон переписки",
  Language: "Язык",
  "Choose the interface language. It applies across the app and is remembered on this device.":
    "Выберите язык интерфейса. Он применяется во всём приложении и запоминается на этом устройстве.",
  Theme: "Тема",
  "GRAM is dark-only for now. A light theme would mean rebuilding the entire palette — until it exists, the toggle says so honestly.":
    "Пока GRAM только тёмный. Светлая тема потребует пересборки всей палитры — пока её нет, переключатель честно об этом говорит.",
  Dark: "Тёмная",
  "Light — soon": "Светлая — скоро",
  "Chat color": "Цвет чата",
  "Chat wallpaper": "Фон чата",
  "Pattern over the wallpaper": "Узор поверх фона",
  "Help and documents": "Помощь и документы",
  "Guides, terms, privacy and a secure support form.":
    "Руководства, условия, приватность и защищённая форма поддержки.",
  "Help center": "Центр помощи",
  FAQ: "Вопросы и ответы",
  "Terms and policies": "Условия и политики",
  "Report or contact": "Пожаловаться или связаться",
  "Reset appearance": "Сбросить оформление",
  APPEARANCE: "ОФОРМЛЕНИЕ",
  // Market shell
  Usernames: "Юзернеймы",
  Numbers: "Номера",
  MARKET: "МАРКЕТ",
  // Number market
  "An anonymous +888 number": "Анонимный номер +888",
  "Showcase": "Витрина",
  "For sale": "В продаже",
  "Mine": "Мои",
  "Newest lots": "Новые лоты",
  "Price ↑": "Цена ↑",
  "Price ↓": "Цена ↓",
  Check: "Проверить",
  "Checking…": "Проверяем…",
  Buy: "Купить",
  "Buying…": "Покупаем…",
  "Enter the eight digits after +888.": "Введите восемь цифр после +888.",
  yours: "ваши",
  lots: "лоты",
  balance: "баланс",
  "Nothing here yet": "Здесь пока пусто"
};

const DICTS: Record<Locale, Record<string, string>> = { en: {}, ru: RU };

let snapshot: Locale | null = null;

export function readLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === "ru" ? "ru" : "en";
  } catch {
    return "en";
  }
}

export function applyLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

export function writeLocale(locale: Locale) {
  snapshot = locale;
  applyLocale(locale);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, locale);
    window.dispatchEvent(new Event("gram:locale"));
  } catch {
    // Private mode: the choice holds for this session.
  }
}

function subscribe(onChange: () => void) {
  const handle = () => {
    snapshot = null;
    onChange();
  };
  window.addEventListener("gram:locale", handle);
  window.addEventListener("storage", handle);
  return () => {
    window.removeEventListener("gram:locale", handle);
    window.removeEventListener("storage", handle);
  };
}

function getSnapshot(): Locale {
  snapshot ??= readLocale();
  return snapshot;
}

function getServerSnapshot(): Locale {
  return "en";
}

/** Translate the English source string for the current locale, falling back to the source. */
export function translate(locale: Locale, source: string): string {
  return DICTS[locale]?.[source] ?? source;
}

/**
 * Hook returning the active locale and a `t(source)` translator.
 *
 * `t` takes the English text itself as the key, so a component reads naturally and an
 * untranslated string is never shown as a raw identifier.
 */
export function useLocale() {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    locale,
    setLocale: writeLocale,
    t: (source: string) => translate(locale, source)
  };
}
