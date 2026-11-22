import { describe, it, expect } from 'vitest';
import { SKILLS } from '../src/skills/definitions';
import { CAPABILITY_META } from '../src/capabilities/capability.meta';

/**
 * Phase 19 — registry coverage.
 *
 * The executable registry (`SKILLS`) is the source of truth; routing metadata
 * is a second file that has to keep up with it. This test is the thing that
 * notices when it does not: add skill 29 without routing vocabulary and the
 * router can only reach it by accident, which is exactly the silent
 * degradation the capability layer exists to prevent.
 */

describe('capability metadata', () => {
  it('covers every skill in the registry', () => {
    const missing = SKILLS.filter((s) => !CAPABILITY_META[s.name]).map((s) => s.name);
    expect(missing, 'add these to capabilities/capability.meta.ts').toEqual([]);
  });

  it('describes no capability that does not exist', () => {
    const names = new Set(SKILLS.map((s) => s.name));
    const orphans = Object.keys(CAPABILITY_META).filter((name) => !names.has(name));
    expect(orphans, 'these capabilities have metadata but no skill').toEqual([]);
  });

  it('keys match the name inside each entry', () => {
    for (const [key, entry] of Object.entries(CAPABILITY_META)) {
      expect(entry.name).toBe(key);
    }
  });

  it('gives every capability routing vocabulary and a version', () => {
    for (const entry of Object.values(CAPABILITY_META)) {
      expect(entry.keywords.length, `${entry.name} has no keywords`).toBeGreaterThan(0);
      expect(entry.version, `${entry.name} has no version`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('keeps the always-on set small — it is paid for on every request', () => {
    const always = Object.values(CAPABILITY_META).filter((c) => c.always);
    expect(always.map((c) => c.name)).toEqual(['get_now']);
  });

  it('points dependencies at real capabilities', () => {
    for (const entry of Object.values(CAPABILITY_META)) {
      for (const dep of entry.dependencies ?? []) {
        expect(CAPABILITY_META[dep], `${entry.name} depends on unknown ${dep}`).toBeDefined();
      }
    }
  });
});
