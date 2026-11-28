/**
 * Register (COMPANION_VISION §7) — one personality, several modes. Pure.
 *
 * A charter defines who the companion is; the register defines how it's being
 * right now. It's *derived* from the situation, not configured, and becomes a
 * single hint in the prompt — most of what makes the thing feel situationally
 * aware rather than monotone.
 */

export type Register = 'focus' | 'casual' | 'serious' | 'celebratory' | 'concerned';

export interface RegisterSignals {
  /** A live health concern (and the grant is active). */
  healthActive?: boolean;
  /** An open task is overdue. */
  atRisk?: boolean;
  /** A deadline is close (hours/a day out). */
  deadlineSoon?: boolean;
  /** A task was just completed. */
  justCompleted?: boolean;
}

/**
 * Most-serious-wins: a health event pulls hardest, then risk, then a near
 * deadline, then a win; otherwise the easy default. Returning one value keeps
 * it a single prompt line rather than a blend the model has to reconcile.
 */
export function deriveRegister(s: RegisterSignals): Register {
  if (s.healthActive) return 'serious';
  if (s.atRisk) return 'concerned';
  if (s.deadlineSoon) return 'focus';
  if (s.justCompleted) return 'celebratory';
  return 'casual';
}

/** The one line that goes into the system prompt. */
export function registerHint(r: Register): string {
  const how: Record<Register, string> = {
    focus: 'Register: focus — brief, concrete, help them get the thing done.',
    casual: 'Register: casual — relaxed and warm, no agenda.',
    serious: 'Register: serious — careful and plain; this matters to them.',
    celebratory: 'Register: celebratory — acknowledge the win, lightly.',
    concerned: 'Register: concerned — honest and supportive; something is slipping.',
  };
  return how[r];
}
