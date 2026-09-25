import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(new Date(value));
}

export function money(value?: number | null) {
  if (!value) return "—";
  return `${new Intl.NumberFormat("en-US").format(value)} GR`;
}

/**
 * English plural agreement for counts: 1 item, 2 items, 5 items.
 * Numeric counts are printed all over the product, and "1 items" reads as a bug.
 */
export function plural(count: number, one: string, few: string, many: string) {
  return Math.abs(count) === 1 ? one : many || few;
}

/**
 * Whether a stored upload is a clip.
 *
 * An avatar and a cover hold whichever the owner uploaded, and the surface that draws them has
 * to decide between `<img>` and a looping `<video>`. The container is read from the url because
 * that is all a rendered profile carries — the API stores what it verified from the bytes.
 */
export function isVideoUrl(url?: string | null) {
  if (!url) return false;
  const clean = url.split(/[?#]/, 1)[0]?.toLocaleLowerCase("en-US") ?? "";
  return /\.(mp4|m4v|mov|webm|ogv)$/.test(clean);
}
