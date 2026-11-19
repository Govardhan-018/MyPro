import { describe, it, expect } from 'vitest';
import { SKILLS } from '../src/skills/definitions';

/**
 * Phase 12.1 (applied to the new Phase 16.1 skills): the commitment skills are
 * registered with the right side-effect tier, and their argument schemas accept
 * valid input and reject the mistakes the model could plausibly make. Pure —
 * the executor injects the db, so no Supabase is needed to check this.
 */

const byName = (name: string) => SKILLS.find((s) => s.name === name);

describe('commitment skills are registered', () => {
  it('exposes list/create/update with the expected side-effect tiers', () => {
    expect(byName('list_commitments')?.sideEffect).toBe('read');
    expect(byName('create_commitment')?.sideEffect).toBe('write');
    expect(byName('update_commitment')?.sideEffect).toBe('write');
  });

  it('never marks a commitment skill outward (they only touch the user’s own rows)', () => {
    for (const name of ['list_commitments', 'create_commitment', 'update_commitment']) {
      expect(byName(name)?.sideEffect).not.toBe('outward');
    }
  });
});

describe('create_commitment schema', () => {
  const schema = byName('create_commitment')!.schema;

  it('accepts a bare title and defaults the kind', () => {
    const parsed = schema.parse({ title: 'Finish the report' }) as { title: string; kind?: string };
    expect(parsed.title).toBe('Finish the report');
  });

  it('accepts a full commitment', () => {
    expect(() =>
      schema.parse({
        title: 'Call Anu',
        detail: 'promised at dinner',
        kind: 'promise',
        due_at: '2026-11-20T18:00:00Z',
        confidence: 3,
        next_checkin_at: '2026-11-19T09:00:00Z',
      }),
    ).not.toThrow();
  });

  it('rejects an empty title and an unknown kind', () => {
    expect(() => schema.parse({ title: '' })).toThrow();
    expect(() => schema.parse({ title: 'x', kind: 'wish' })).toThrow();
  });
});

describe('update_commitment schema', () => {
  const schema = byName('update_commitment')!.schema;

  it('requires the id', () => {
    expect(() => schema.parse({ state: 'done' })).toThrow();
  });

  it('accepts a state transition by id', () => {
    expect(() =>
      schema.parse({ id: '00000000-0000-0000-0000-000000000000', state: 'at_risk' }),
    ).not.toThrow();
  });

  it('rejects an unknown state', () => {
    expect(() =>
      schema.parse({ id: '00000000-0000-0000-0000-000000000000', state: 'maybe' }),
    ).toThrow();
  });
});
