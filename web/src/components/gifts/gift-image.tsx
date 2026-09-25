"use client";

import { useState } from "react";
import { GiftArt, type GiftRarityName } from "./gift-art";

/**
 * Gift artwork at any size, in one place.
 *
 * Every surface that shows a collectible — catalogue tile, chat bubble, profile marker, hero —
 * goes through here, so switching the whole product onto real Telegram artwork was one change
 * rather than one per screen.
 *
 * `animate` decides how much motion a surface can afford. `"hover"` is the storefront default:
 * a still until the tile is pointed at or tapped, because 120 simultaneous Lottie players is
 * not a tradeoff worth making for a grid nobody is looking at closely.
 */
export type GiftArtMotion = "still" | "hover" | "always";

export function GiftImage({
  design,
  name,
  model,
  pattern,
  accent,
  backdropEdge,
  patternColor,
  rarity,
  upgraded = true,
  size,
  rounded = "rounded-full",
  className = "",
  animate = "hover",
  bare = false,
  fill = false
}: {
  design?: string | null;
  name: string;
  model?: string | null;
  pattern?: string | null;
  accent?: string | null;
  backdropEdge?: string | null;
  patternColor?: string | null;
  rarity?: GiftRarityName | null;
  /** A plain gift shows the design's own artwork; upgrading it rolls a model and a backdrop. */
  upgraded?: boolean;
  size: number;
  rounded?: string;
  className?: string;
  animate?: GiftArtMotion;
  /** No backdrop: just the sticker, for markers beside a name or over a cover photo. */
  bare?: boolean;
  /** Size from the parent, so a responsive grid can change the tile at a breakpoint. */
  fill?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <span
      aria-hidden
      title={name}
      className={`block overflow-hidden ${fill ? "h-full w-full" : ""} ${rounded} ${className}`}
      style={fill ? undefined : { width: size, height: size }}
      onPointerEnter={animate === "hover" ? () => setHovered(true) : undefined}
      // `pointerover` as well: enter/leave do not bubble, so the over event is the one that
      // reliably arrives when the pointer lands on a child of the tile.
      onPointerOver={animate === "hover" ? () => setHovered(true) : undefined}
      onPointerLeave={animate === "hover" ? () => setHovered(false) : undefined}
      // Touch has no hover, so a tap is what starts it there.
      onTouchStart={animate === "hover" ? () => setHovered(true) : undefined}
    >
      <GiftArt
        design={design}
        model={model}
        pattern={pattern}
        accent={accent}
        backdropEdge={backdropEdge}
        patternColor={patternColor}
        rarity={rarity}
        size={size}
        animated={animate === "always" || (animate === "hover" && hovered)}
        bare={bare}
        fill={fill}
        upgraded={upgraded}
      />
    </span>
  );
}

type ArtSource = {
  slug?: string;
  design_slug?: string | null;
  name?: string;
  accent?: string | null;
  backdrop_edge?: string | null;
  pattern_color?: string | null;
  pattern?: string | null;
  symbol?: string | null;
  model?: string | null;
  model_name?: string | null;
  rarity?: GiftRarityName | null;
  upgraded?: boolean;
  is_owned_by_me?: boolean;
};

/** `vintage-cigar-007` -> `vintage-cigar`, so an item resolves to the design it depicts. */
function designSlug(item: ArtSource) {
  return item.design_slug ?? (item.slug ?? "").replace(/-\d+$/, "");
}

/**
 * Maps an item, a catalogue design or a compact chat embed onto the renderer's props. Callers
 * spread this rather than threading nine fields by hand at every call site.
 *
 * A catalogue design has nothing rolled yet and no `upgraded` field, so the default is `true`:
 * a storefront tile has to show the design's own artwork, which is exactly what a plain gift
 * shows too. Only an item that says `upgraded: false` is drawn as plain.
 */
export function giftArtProps(item: ArtSource) {
  return {
    design: designSlug(item),
    name: item.name ?? "",
    model: item.model ?? item.model_name ?? null,
    pattern: item.symbol ?? item.pattern ?? null,
    accent: item.accent,
    backdropEdge: item.backdrop_edge,
    patternColor: item.pattern_color,
    rarity: item.rarity ?? null,
    upgraded: item.upgraded !== false
  };
}
