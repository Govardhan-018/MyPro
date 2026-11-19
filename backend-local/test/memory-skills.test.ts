import { describe, it, expect } from 'vitest';
import { SKILLS } from '../src/skills/definitions';

/**
 * Phase 16 memory skills: remember/forget are registered as writes (never
 * outward — they only touch the user's own rows) and their schemas accept
 * valid input and reject the mistakes the model could make. Pure; no Supabase.
 */

const byName = (name: string) => SKILLS.find((s) => s.name === name);

describe('memory skills are registered', () => {
  it('exposes remember and forget as write-tier skills', () => {
    expect(byName('remember')?.sideEffect).toBe('write');
    expect(byName('forget')?.sideEffect).toBe('write');
  });
});

describe('remember schema', () => {
  const schema = byName('remember')!.schema;

  it('accepts a key/value fact', () => {
    expect(() => schema.parse({ key: 'work_rhythm', value: 'deep work before noon' })).not.toThrow();
  });

  it('accepts an optional confidence in [0,1]', () => {
    expect(() => schema.parse({ key: 'k', value: 'v', confidence: 0.6 })).not.toThrow();
  });

  it('rejects an empty key and a confidence above 1', () => {
    expect(() => schema.parse({ key: '', value: 'v' })).toThrow();
    expect(() => schema.parse({ key: 'k', value: 'v', confidence: 2 })).toThrow();
  });
});

describe('forget schema', () => {
  const schema = byName('forget')!.schema;

  it('requires a key', () => {
    expect(() => schema.parse({})).toThrow();
    expect(() => schema.parse({ key: 'work_rhythm' })).not.toThrow();
  });
});
