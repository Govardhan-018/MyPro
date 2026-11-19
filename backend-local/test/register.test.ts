import { describe, it, expect } from 'vitest';
import { deriveRegister, registerHint } from '../src/assistant/register';

/** Phase 16.4 — derived register (how the companion is being right now). */

describe('deriveRegister', () => {
  it('defaults to casual with no signals', () => {
    expect(deriveRegister({})).toBe('casual');
  });
  it('follows most-serious-wins precedence', () => {
    expect(deriveRegister({ healthActive: true, atRisk: true, deadlineSoon: true })).toBe('serious');
    expect(deriveRegister({ atRisk: true, deadlineSoon: true })).toBe('concerned');
    expect(deriveRegister({ deadlineSoon: true, justCompleted: true })).toBe('focus');
    expect(deriveRegister({ justCompleted: true })).toBe('celebratory');
  });
});

describe('registerHint', () => {
  it('returns a single prompt line naming the register', () => {
    expect(registerHint('focus')).toMatch(/^Register: focus/);
    expect(registerHint('casual')).toContain('Register:');
  });
});
