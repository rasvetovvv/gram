"use client";

import { useCallback, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { giftStickerUrl, giftSymbolUrl } from "@/lib/api";
import { GiftLottie } from "./gift-lottie";

/**
 * A collectible as Telegram composes one: a backdrop ramp, a symbol tiled behind the object,
 * and the object itself — the gift's rolled model.
 *
 * That composition only exists once a gift has been **upgraded**. A plain gift is the design's
 * own artwork on its own neutral colour: no model, no symbol, no sparkles. Upgrading rolls all
 * three, which is what `upgraded` switches between here.
 *
 * Stills are PNG and motion is Lottie, switched by `animated`: a 120-tile storefront cannot
 * afford 120 running players, so grids stay still until a tile is pointed at, while a hero, a
 * chat card or an upgrade always animates.
 */
export type GiftRarityName = "rare" | "epic" | "legendary" | "mythic";

export type GiftArtProps = {
  /** Design slug, e.g. `vintage-cigar` — what artwork URLs are built from. */
  design?: string | null;
  model?: string | null;
  pattern?: string | null;
  accent?: string | null;
  backdropEdge?: string | null;
  patternColor?: string | null;
  rarity?: GiftRarityName | null;
  size: number;
  animated?: boolean;
  className?: string;
  /**
   * Draw the sticker alone, with no backdrop, pattern or sparkles. Used where the gift sits on
   * somebody else's surface — beside a name, over a cover photo — and a coloured tile would
   * read as a badge stuck onto the layout rather than as the object itself.
   */
  bare?: boolean;
  /**
   * Size from the parent box instead of a fixed pixel count, so a responsive grid can change
   * the tile at a breakpoint. `size` still sets the asset resolution and the pattern scale.
   */
  fill?: boolean;
  /**
   * Whether the roll has happened. A plain gift draws the design's original sticker and skips
   * the pattern and the sparkles, so the difference is visible at a glance.
   */
  upgraded?: boolean;
};

/** Below this the tiled pattern and the sparkles turn to mud, so small marks skip them. */
const DETAIL_SIZE = 40;
const SPARKLE_SIZE = 72;

const SPARKLES: [number, number, number, number][] = [
  [18, 24, 5, 0],
  [82, 30, 4, 0.7],
  [26, 76, 3.5, 1.3],
  [78, 72, 4.5, 0.4],
  [50, 14, 3, 1],
];

const SPARKLE_COUNT: Record<GiftRarityName, number> = {
  rare: 0,
  epic: 3,
  legendary: 5,
  mythic: 5,
};

/** The symbol layer is a mask, not an image, so it takes the backdrop's own pattern colour. */
function PatternLayer({
  url,
  color,
  tile
}: {
  url: string;
  color: string;
  /** Edge of one repeat, in pixels. */
  tile: number;
}) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        background: color,
        opacity: 0.22,
        maskImage: `url(${url})`,
        WebkitMaskImage: `url(${url})`,
        maskSize: `${tile}px ${tile}px`,
        WebkitMaskSize: `${tile}px ${tile}px`,
        maskRepeat: "repeat",
        WebkitMaskRepeat: "repeat"
      }}
    />
  );
}

/**
 * A collectible's backdrop on its own, at any shape.
 *
 * The detail sheet needs it edge to edge, behind the artwork rather than around it: drawing the
 * gift's own tile inside a panel that already had a gradient of its own made two backgrounds
 * where the reference has one continuous surface. Children are laid over the backdrop.
 */
export function GiftBackdrop({
  design,
  pattern,
  accent,
  backdropEdge,
  patternColor,
  tile = 52,
  className = "",
  children
}: {
  design?: string | null;
  pattern?: string | null;
  accent?: string | null;
  backdropEdge?: string | null;
  patternColor?: string | null;
  tile?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const symbol = pattern ? giftSymbolUrl(design ?? "", pattern) : null;
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        background: `radial-gradient(circle at 50% 34%, ${accent || "#1c1c26"} 0%, ${
          backdropEdge || "#08080a"
        } 100%)`
      }}
    >
      {symbol ? (
        <PatternLayer url={symbol} color={patternColor || "#ffffff"} tile={tile} />
      ) : null}
      {children}
    </div>
  );
}


function Sparkles({ count, size }: { count: number; size: number }) {
  const reduceMotion = useReducedMotion();
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {SPARKLES.slice(0, count).map(([x, y, radius, delay]) => (
        <span
          key={`${x}-${y}`}
          className={reduceMotion ? undefined : "gift-anim gift-twinkle"}
          style={{
            position: "absolute",
            left: `${x}%`,
            top: `${y}%`,
            width: (radius / 100) * size * 2,
            height: (radius / 100) * size * 2,
            borderRadius: "50%",
            background: "radial-gradient(circle, #ffffff 0%, rgba(255,255,255,0) 70%)",
            animationDelay: `${delay}s`
          }}
        />
      ))}
    </span>
  );
}

export function GiftArt({
  design,
  model,
  pattern,
  accent,
  backdropEdge,
  patternColor,
  rarity,
  size,
  animated = false,
  className = "",
  bare = false,
  fill = false,
  upgraded = true
}: GiftArtProps) {
  const reduceMotion = useReducedMotion();
  const [playing, setPlaying] = useState<string | null>(null);
  const centre = accent || "#1c1c26";
  const edge = backdropEdge || "#08080a";
  const tier: GiftRarityName = rarity ?? "rare";
  // A plain gift has nothing rolled: no symbol behind it, no sparkles, and the sticker is the
  // design's own rather than a model of it.
  const detailed = upgraded && !bare && size >= DETAIL_SIZE;
  const sparkles = upgraded && !bare && size >= SPARKLE_SIZE ? SPARKLE_COUNT[tier] : 0;
  const symbol = detailed ? giftSymbolUrl(design ?? "", pattern) : null;
  const worn = upgraded ? model : null;
  const still = giftStickerUrl(design ?? "", worn, "png", size > 128 ? 256 : 128);
  const motion = animated && !reduceMotion ? giftStickerUrl(design ?? "", worn, "tgs") : null;
  /*
   * Which animation is actually on screen, by url rather than a bare boolean. Remembering the
   * url means hover can end and start again without resetting anything during render, and a
   * gift whose model changes cannot show the previous animation as if it were ready.
   */
  const showMotion = motion !== null && playing === motion;
  // Stable per animation url, so the player is not rebuilt on unrelated parent renders.
  const onPlaying = useCallback(() => setPlaying(motion), [motion]);
  // A bare sticker uses its whole box: the padding exists to keep artwork off a backdrop's
  // edge, and with no backdrop it only makes the gift look smaller than its neighbours.
  const inset = bare ? 0 : Math.round(size * 0.12);
  const box = fill ? { width: "100%", height: "100%" } : { width: size, height: size };

  return (
    <span
      aria-hidden
      className={`relative block overflow-hidden ${className}`}
      style={{
        ...box,
        background: bare
          ? undefined
          : `radial-gradient(circle at 50% 38%, ${centre} 0%, ${edge} 100%)`
      }}
    >
      {symbol ? (
        <PatternLayer
          url={symbol}
          color={patternColor || "#ffffff"}
          tile={Math.max(16, Math.round(size / 4.5))}
        />
      ) : null}
      <span className="absolute grid place-items-center" style={{ inset }}>
        {/*
          One still, mounted for the life of the tile and never swapped for another element.
          It used to live inside the "is it animating" branch, so pointing at a gift replaced
          the <img> with a different tree — React threw the loaded picture away and the artwork
          blinked before the animation arrived. Now the player fades in over a picture that was
          never taken down, and both sides of the crossfade use the same transition.

          A plain <img>: the proxy already sizes and caches these, so Next's optimiser would
          only add a second cache in front of one that is already local.
        */}
        {still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={still}
            alt=""
            width={size - inset * 2}
            height={size - inset * 2}
            loading="lazy"
            decoding="async"
            className="transition-opacity duration-150"
            style={{
              ...(fill
                ? { width: "100%", height: "100%" }
                : { width: size - inset * 2, height: size - inset * 2 }),
              objectFit: "contain",
              opacity: showMotion ? 0 : 1
            }}
          />
        ) : null}
        {motion ? (
          <span
            className="absolute inset-0 grid place-items-center transition-opacity duration-150"
            style={{ opacity: showMotion ? 1 : 0 }}
          >
            <GiftLottie src={motion} size={size - inset * 2} fill={fill} onReady={onPlaying} />
          </span>
        ) : null}
      </span>
      {sparkles ? <Sparkles count={sparkles} size={size} /> : null}
    </span>
  );
}
