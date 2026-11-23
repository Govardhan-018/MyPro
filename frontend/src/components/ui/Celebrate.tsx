/**
 * Celebrate (UI upgrade §3.9) — reward the real completion moments (peak-end
 * rule), never anything random. `small` is a haptic tick; `big` is a short
 * confetti burst (lazy-loaded, ≤800ms). Reduced motion gets neither confetti
 * nor haptics.
 */

const AFFIRMATIONS = [
  "Chapter done.",
  "That's logged.",
  "Nice run.",
  "Kept it going.",
  "One more done.",
  "Good session.",
  "Saved.",
  "On a roll.",
  "That counts.",
  "Day's progress, banked.",
];

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
}

/** A non-cringe, rotating one-liner for a celebration toast. */
export function randomAffirmation(): string {
  return AFFIRMATIONS[Math.floor(Math.random() * AFFIRMATIONS.length)];
}

export async function celebrate(
  type: "small" | "big",
  opts?: { origin?: { x: number; y: number }; tint?: string },
): Promise<void> {
  if (prefersReducedMotion()) return;

  if (type === "small") {
    navigator.vibrate?.([10, 40, 10]);
    return;
  }

  navigator.vibrate?.([10, 40, 10]);
  try {
    const confetti = (await import("canvas-confetti")).default;
    confetti({
      particleCount: 60,
      spread: 70,
      startVelocity: 38,
      ticks: 120,
      scalar: 0.9,
      disableForReducedMotion: true,
      colors: ["#A78BFA", opts?.tint ?? "#C084FC"],
      origin: opts?.origin ?? { x: 0.5, y: 0.7 },
    });
  } catch {
    /* confetti is a nicety — never let a failed lazy-load break the flow */
  }
}
