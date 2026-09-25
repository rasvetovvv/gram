import type { CSSProperties } from "react";

/**
 * Profile colour schemes: one source of truth for names, accents and identity surfaces.
 *
 * The reference renders a themed name as a two-stop horizontal gradient clipped to the
 * glyphs, plus an 18px glow tinted with the closing stop at 40% alpha. `default` stays
 * plain white so an unthemed profile is never accidentally tinted.
 */
export type ProfileTheme = {
  slug: string;
  label: string;
  /** Gradient start, used for the left edge of a themed name. */
  from: string;
  /** Gradient end; also drives the glow and any flat accent use. */
  to: string;
  /** Flat accent colour for icons, rings and small marks. */
  accent: string;
  /** Text colour that reads on top of `accent`. */
  onAccent: string;
  /** Softer fill for large surfaces such as the collectible-username card. */
  soft: string;
};

const DEFAULT_THEME: ProfileTheme = {
  slug: "default",
  label: "Default",
  from: "#ffffff",
  to: "#ffffff",
  accent: "#e7e9ea",
  onAccent: "#000000",
  soft: "#8b8f98"
};

const THEMES: ProfileTheme[] = [
  DEFAULT_THEME,
  { slug: "platinum", label: "Platinum", from: "#d1d5db", to: "#a1a7b3", accent: "#a1a7b3", onAccent: "#16171c", soft: "#a1a7b3" },
  { slug: "champagne", label: "Champagne", from: "#f0e2be", to: "#d8c9a3", accent: "#d8c9a3", onAccent: "#211c10", soft: "#d8c9a3" },
  { slug: "ice_blue", label: "Ice Blue", from: "#9fd4ff", to: "#4aa8ff", accent: "#4aa8ff", onAccent: "#06192b", soft: "#4aa8ff" },
  { slug: "blue", label: "Blue", from: "#8fa2ff", to: "#4a63ff", accent: "#4a63ff", onAccent: "#070b26", soft: "#4a63ff" },
  { slug: "violet", label: "Violet", from: "#d3c2ff", to: "#a984ff", accent: "#a984ff", onAccent: "#150c2b", soft: "#a984ff" },
  { slug: "cyan", label: "Cyan", from: "#8ce8db", to: "#33ccb8", accent: "#33ccb8", onAccent: "#06231f", soft: "#33ccb8" },
  { slug: "emerald", label: "Emerald", from: "#a7ebb5", to: "#5fd97a", accent: "#5fd97a", onAccent: "#062312", soft: "#5fd97a" },
  { slug: "pink", label: "Pink", from: "#ff9dcb", to: "#ff58a6", accent: "#ff58a6", onAccent: "#2a0718", soft: "#ff58a6" },
  { slug: "orange", label: "Orange", from: "#ffc184", to: "#ff9430", accent: "#ff9430", onAccent: "#2a1405", soft: "#ff9430" },
  { slug: "gold", label: "Gold", from: "#ffe89c", to: "#ffd24b", accent: "#ffd24b", onAccent: "#2a1f05", soft: "#ffd24b" },
  { slug: "red", label: "Red", from: "#ff97a3", to: "#ff5468", accent: "#ff5468", onAccent: "#2a070c", soft: "#ff5468" }
];

const BY_SLUG = new Map(THEMES.map((theme) => [theme.slug, theme]));

export const PROFILE_THEMES = THEMES;

export function profileTheme(slug?: string | null): ProfileTheme {
  return BY_SLUG.get((slug ?? "").trim().toLowerCase()) ?? DEFAULT_THEME;
}

/** Flat name colour, for compact rows where a gradient would not survive truncation. */
export function nameColor(slug?: string | null): string | undefined {
  const theme = profileTheme(slug);
  return theme.slug === "default" ? undefined : theme.accent;
}

/** Gradient + glow treatment the reference applies to a themed display name. */
export function nameStyle(slug?: string | null): CSSProperties | undefined {
  const theme = profileTheme(slug);
  if (theme.slug === "default") return undefined;
  return {
    backgroundImage: `linear-gradient(to right, ${theme.from}, ${theme.to})`,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    textShadow: `0 0 18px ${theme.to}66`
  };
}

/** Gradient stops as a CSS value, for rings and dividers that echo the name treatment. */
export function themeGradient(slug?: string | null): string {
  const theme = profileTheme(slug);
  return `linear-gradient(to right, ${theme.from}, ${theme.to})`;
}

/**
 * Colour for the anonymous +888 number shown under the username. The number is plain text — no
 * background pill — so a themed profile tints the digits with the theme's gradient (clipped to
 * the glyphs) and adds a soft glow, while a default profile stays a neutral muted colour.
 */
export function numberDigitStyle(slug?: string | null): CSSProperties {
  const theme = profileTheme(slug);
  if (theme.slug === "default") {
    return { color: "var(--muted)" };
  }
  return {
    backgroundImage: `linear-gradient(to right, ${theme.from}, ${theme.to})`,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    // Consumed by the .number-badge glow keyframes; currentColor is transparent here because
    // the digits are a clipped gradient, so the glow needs its own colour.
    ["--number-glow" as string]: theme.to,
    filter: `drop-shadow(0 0 8px ${theme.to}66)`
  } as CSSProperties;
}
