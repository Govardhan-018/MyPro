import { useMemo, type CSSProperties } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Loading — the ONE loading indicator for the whole app: a wavy ring that
 * rotates smoothly (SVG, GPU `transform` only, no flicker). Theme-aware: the
 * stroke is the live `--accent`, so it tracks Monochrome ↔ Color Mode. Under
 * reduced motion it stops rotating and gently pulses instead. No blank or black
 * loading states anywhere — every async spot renders one of these variants.
 *
 *   fullscreen — initial app / route loads (covers the viewport over --bg)
 *   overlay    — fills a positioned parent with a scrim (modals, sections)
 *   component  — centred in a card / list while its data loads
 *   inline     — sits inside a button or next to text
 */
export type LoadingVariant = "fullscreen" | "overlay" | "component" | "inline";

const DEFAULT_SIZE: Record<LoadingVariant, number> = {
  fullscreen: 56,
  overlay: 44,
  component: 40,
  inline: 18,
};

/**
 * A closed, gently scalloped ring path (radius modulated by a sine), built once.
 * Many fine steps + round joins keep the wave smooth at any size.
 */
function wavyRingPath(cx = 24, cy = 24, radius = 18, amplitude = 2, lobes = 12, steps = 360): string {
  let d = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const r = radius + amplitude * Math.sin(lobes * t);
    const x = cx + r * Math.cos(t);
    const y = cy + r * Math.sin(t);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return `${d}Z`;
}

const RING_PATH = wavyRingPath();

function Ring({ size, color }: { size: number; color: string }) {
  const reduce = useReducedMotion();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={reduce ? "ds-wavy-pulse" : "ds-wavy-spin"}
      role="presentation"
      aria-hidden="true"
      style={{ display: "block", color }}
    >
      <path
        d={RING_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={3.2}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.95}
      />
    </svg>
  );
}

export function Loading({
  variant = "component",
  size,
  text,
  color = "var(--accent)",
  className,
  style,
}: {
  variant?: LoadingVariant;
  size?: number;
  /** Optional label shown beside (inline) or below (block) the ring. */
  text?: string;
  /** Stroke colour; defaults to the theme accent. */
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ringSize = size ?? DEFAULT_SIZE[variant];
  const label = useMemo(() => text, [text]);

  const ring = <Ring size={ringSize} color={color} />;

  if (variant === "inline") {
    return (
      <span
        className={className}
        role="status"
        aria-label={label ?? "Loading"}
        style={{ display: "inline-flex", alignItems: "center", gap: label ? 8 : 0, ...style }}
      >
        {ring}
        {label ? (
          <span className="ds-callout" style={{ color: "var(--text-2)" }}>
            {label}
          </span>
        ) : null}
      </span>
    );
  }

  const block = (
    <div
      role="status"
      aria-label={label ?? "Loading"}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: label ? 12 : 0,
      }}
    >
      {ring}
      {label ? (
        <span className="ds-callout" style={{ color: "var(--text-2)" }}>
          {label}
        </span>
      ) : null}
    </div>
  );

  if (variant === "fullscreen") {
    return (
      <div
        className={className}
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          zIndex: 2000,
          ...style,
        }}
      >
        {block}
      </div>
    );
  }

  if (variant === "overlay") {
    return (
      <div
        className={className}
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0, 0, 0, 0.45)",
          backdropFilter: "blur(2px)",
          zIndex: 50,
          ...style,
        }}
      >
        {block}
      </div>
    );
  }

  // component
  return (
    <div className={className} style={{ padding: "32px 16px", display: "flex", justifyContent: "center", ...style }}>
      {block}
    </div>
  );
}
