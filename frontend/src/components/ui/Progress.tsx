import { Check } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/**
 * ProgressBar (UI upgrade §3.4) — 4px track, accent fill with backward ribbing
 * that eases as it nears 100%; a check replaces it when complete. Only width
 * (transform-equivalent) and opacity move.
 */
export function ProgressBar({
  value,
  height = 4,
  tint = "var(--accent)",
}: {
  /** 0–1. */
  value: number;
  height?: number;
  tint?: string;
}) {
  const pct = clamp(value);
  const done = pct >= 1;
  return (
    <div
      style={{
        position: "relative",
        height,
        borderRadius: "var(--r-full)",
        background: "var(--surface-2)",
        overflow: "hidden",
      }}
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className={done ? undefined : "ds-ribbing"}
        initial={false}
        animate={{ width: `${pct * 100}%` }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        style={{
          position: "absolute",
          inset: 0,
          right: "auto",
          background: tint,
          borderRadius: "var(--r-full)",
        }}
      />
    </div>
  );
}

/**
 * ProgressRing (UI upgrade §3.5). Stroke uses the content-type tint; it
 * animates from its previous value, and at 100% pulses then shows a check.
 */
export function ProgressRing({
  value,
  size = 32,
  stroke = 3,
  tint = "var(--accent)",
  children,
}: {
  /** 0–1. */
  value: number;
  size?: number;
  stroke?: number;
  tint?: string;
  children?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const pct = clamp(value);
  const done = pct >= 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <motion.div
      style={{ position: "relative", width: size, height: size, display: "inline-flex" }}
      animate={done && !reduce ? { scale: [1, 1.08, 1] } : undefined}
      transition={{ duration: 0.32, ease: "easeOut" }}
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tint}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: reduce ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: tint,
        }}
      >
        {done ? <Check size={size * 0.5} strokeWidth={3} /> : children}
      </div>
    </motion.div>
  );
}
