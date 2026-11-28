/**
 * A typographic book cover for a book with no artwork.
 *
 * Every book gets its own look, decided by a hash of its id (or title): the
 * colourway, the motif behind the title, the spine, and how the type is set.
 * The same book always draws the same cover, on every device and in every
 * place it appears (Library cards, Today's "Continue learning").
 */
import type { CSSProperties } from "react";

/** Accent colourways on a near-black base: lavender, mint, blue, amber, rose. */
const PALETTES = [
  { accent: "#b69af5", deep: "#1a1330", ink: "#efe8ff" },
  { accent: "#83d9b0", deep: "#0d211b", ink: "#e5fbf1" },
  { accent: "#71b7f5", deep: "#0d1a2b", ink: "#e6f2ff" },
  { accent: "#f5b266", deep: "#2a1a0b", ink: "#fff1df" },
  { accent: "#f28bb0", deep: "#2a0f1b", ink: "#ffe6ef" },
] as const;

const MOTIFS = ["rings", "stripes", "dots", "sun", "bands", "peaks"] as const;
type Motif = (typeof MOTIFS)[number];

/** FNV-1a: small, fast, stable across platforms. */
export function coverHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The look for a seed. Pure, so it is tested for determinism and spread. */
export function coverDesign(seed: string) {
  const h = coverHash(seed || "untitled");
  return {
    palette: PALETTES[h % PALETTES.length],
    motif: MOTIFS[(h >>> 3) % MOTIFS.length] as Motif,
    /** Title at the top or the bottom of the cover. */
    titleAtTop: ((h >>> 7) & 1) === 0,
    /** Serif book type, or spaced-out uppercase. */
    serif: ((h >>> 8) & 3) !== 0,
    /** Where the gradient's light falls, in degrees. */
    angle: 120 + ((h >>> 10) % 7) * 15,
  };
}

/** "Robert Greene" → "RG"; one word → its first two letters. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function MotifArt({ motif }: { motif: Motif }) {
  const common = { fill: "none", stroke: "var(--cover-accent)", strokeWidth: 1.2 } as const;
  switch (motif) {
    case "rings":
      return (
        <g {...common} opacity={0.55}>
          {[14, 24, 34, 44].map((r) => (
            <circle key={r} cx={82} cy={18} r={r} />
          ))}
        </g>
      );
    case "stripes":
      return (
        <g opacity={0.3}>
          {Array.from({ length: 9 }, (_, i) => (
            <rect key={i} x={-20 + i * 16} y={-20} width={5} height={160} fill="var(--cover-accent)" transform="rotate(28 50 50)" />
          ))}
        </g>
      );
    case "dots":
      return (
        <g fill="var(--cover-accent)" opacity={0.4}>
          {Array.from({ length: 36 }, (_, i) => (
            <circle key={i} cx={10 + (i % 6) * 16} cy={10 + Math.floor(i / 6) * 16} r={1.6} />
          ))}
        </g>
      );
    case "sun":
      return (
        <g>
          <circle cx={70} cy={34} r={22} fill="var(--cover-accent)" opacity={0.28} />
          <circle cx={70} cy={34} r={30} {...common} opacity={0.35} />
        </g>
      );
    case "bands":
      return (
        <g fill="var(--cover-accent)">
          <rect x={0} y={58} width={100} height={6} opacity={0.5} />
          <rect x={0} y={68} width={100} height={2} opacity={0.35} />
          <rect x={0} y={74} width={100} height={1} opacity={0.25} />
        </g>
      );
    case "peaks":
      return (
        <g>
          <path d="M-5 100 L30 52 L52 78 L72 46 L105 100 Z" fill="var(--cover-accent)" opacity={0.22} />
          <path d="M-5 100 L30 52 L52 78 L72 46 L105 100" {...common} opacity={0.5} />
        </g>
      );
  }
}

export function BookCover({
  title,
  author,
  seed,
  size = "card",
}: {
  title: string;
  author?: string;
  /** Stable identity for the design — the item id, else its title. */
  seed?: string;
  /** "card" for Library tiles, "small" for the Today row. */
  size?: "card" | "small";
}) {
  const design = coverDesign(seed || title);
  const { palette } = design;
  const style = {
    "--cover-accent": palette.accent,
    "--cover-deep": palette.deep,
    "--cover-ink": palette.ink,
    "--cover-angle": `${design.angle}deg`,
  } as CSSProperties;
  const byline = author?.trim();
  return (
    <span
      className={`book-cover-art size-${size} ${design.titleAtTop ? "title-top" : "title-bottom"} ${
        design.serif ? "type-serif" : "type-caps"
      }`}
      style={style}
      aria-hidden="true"
    >
      <svg className="book-cover-motif" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <MotifArt motif={design.motif} />
      </svg>
      <span className="book-cover-spine" />
      <span className="book-cover-text">
        <strong>{title}</strong>
        {byline ? (
          <small>
            <span className="book-cover-author">{byline}</span>
            <span className="book-cover-initials">{initialsOf(byline)}</span>
          </small>
        ) : null}
      </span>
    </span>
  );
}
