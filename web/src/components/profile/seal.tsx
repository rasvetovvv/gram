/**
 * Badge seal, reproducing the reference's geometry: one scalloped disc drawn three times —
 * full size for the rim, then 0.88 scale for the face and a top-down sheen — with the
 * glyph sitting above at z-10.
 *
 * The outline is r = 42 + 4.5·cos(10θ) around (50, 50), sampled as a polyline once at
 * module load so every seal shares the same path string.
 */
const SEAL_PATH = (() => {
  const steps = 300;
  const points: string[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2;
    const radius = 42 + 4.5 * Math.cos(10 * angle);
    points.push(`${(50 + radius * Math.cos(angle)).toFixed(2)} ${(50 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points[0]} L${points.slice(1).join(" L")} Z`;
})();

const FACE_TRANSFORM = "translate(50 50) scale(0.88) translate(-50 -50)";

export type SealTone = { from: string; to: string; rimFrom: string; rimTo: string };

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ];
}

function toHex(channels: [number, number, number]) {
  return `#${channels.map((c) => clampChannel(c).toString(16).padStart(2, "0")).join("")}`;
}

function lighten(hex: string, amount: number) {
  const [r, g, b] = parseHex(hex);
  return toHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]);
}

function mix(a: string, b: string, weight: number) {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  return toHex([
    r1 + (r2 - r1) * weight,
    g1 + (g2 - g1) * weight,
    b1 + (b2 - b1) * weight
  ]);
}

/** Rim colours follow the reference's relationship to the face: lighter start, mid-tone end. */
export function sealTone(from: string, to: string, override?: Partial<SealTone>): SealTone {
  return {
    from,
    to,
    rimFrom: lighten(from, 0.55),
    rimTo: mix(from, to, 0.55),
    ...override
  };
}

export function Seal({
  id,
  tone,
  size = 26,
  label,
  children
}: {
  id: string;
  tone: SealTone;
  size?: number;
  label?: string;
  children?: React.ReactNode;
}) {
  const fillId = `seal-fill-${id}`;
  const rimId = `seal-rim-${id}`;
  const sheenId = `seal-sheen-${id}`;
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center align-middle"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <linearGradient id={fillId} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor={tone.from} />
            <stop offset="100%" stopColor={tone.to} />
          </linearGradient>
          <linearGradient id={rimId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tone.rimFrom} />
            <stop offset="100%" stopColor={tone.rimTo} />
          </linearGradient>
          <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
            <stop offset="45%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>
        <path d={SEAL_PATH} fill={`url(#${rimId})`} />
        <path d={SEAL_PATH} fill={`url(#${fillId})`} transform={FACE_TRANSFORM} />
        <path d={SEAL_PATH} fill={`url(#${sheenId})`} transform={FACE_TRANSFORM} />
      </svg>
      {children ? (
        <span className="relative z-10 grid place-items-center" style={{ width: size, height: size }}>
          {children}
        </span>
      ) : null}
    </span>
  );
}

/** Short seals carry a text glyph; the reference sizes it at roughly 0.46 of the seal. */
export function SealText({ text, size = 26 }: { text: string; size?: number }) {
  return (
    <span
      className="font-extrabold leading-none tracking-tight text-white"
      style={{ fontSize: `${(size * 0.46).toFixed(2)}px` }}
    >
      {text}
    </span>
  );
}
