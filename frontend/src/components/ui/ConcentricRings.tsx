/**
 * Concentric progress rings — several measures, one gauge, a summary in the
 * middle. Rounded caps, each ring over a faint track of its own colour.
 *
 * Colours come from CSS (`.rings-tone-N` → `--ring`), so the gauge follows
 * Monochrome / Color Mode like every other accent.
 */
export interface Ring {
  /** 0..1; clamped. A non-zero value always draws a visible sliver. */
  value: number;
  /** Which colour slot (1-based) this ring uses. */
  tone: number;
  label: string;
}

const MIN_VISIBLE = 0.02;

export function ConcentricRings({
  rings,
  size = 200,
  stroke = 12,
  gap = 5,
  centerValue,
  centerLabel,
}: {
  rings: Ring[];
  size?: number;
  stroke?: number;
  gap?: number;
  centerValue: string;
  centerLabel: string;
}) {
  const c = size / 2;
  return (
    <div className="rings" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={rings.map((r) => `${r.label} ${Math.round(r.value * 100)}%`).join(", ")}>
        {rings.map((ring, i) => {
          const r = c - stroke / 2 - i * (stroke + gap);
          if (r <= stroke) return null;
          const circumference = 2 * Math.PI * r;
          const v = Math.min(1, Math.max(0, Number.isFinite(ring.value) ? ring.value : 0));
          const shown = v > 0 ? Math.max(v, MIN_VISIBLE) : 0;
          return (
            <g key={ring.label} className={`rings-tone-${ring.tone}`}>
              <circle className="rings-track" cx={c} cy={c} r={r} fill="none" strokeWidth={stroke} />
              {shown > 0 && (
                <circle
                  className="rings-value"
                  cx={c}
                  cy={c}
                  r={r}
                  fill="none"
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${circumference * shown} ${circumference}`}
                  transform={`rotate(-90 ${c} ${c})`}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="rings-center">
        <strong>{centerValue}</strong>
        <span>{centerLabel}</span>
      </div>
    </div>
  );
}
