import { describe, it, expect } from 'vitest';
import {
  scoreCapability,
  selectCapabilities,
} from '../src/capabilities/capability.routing';
import type { Capability } from '../src/capabilities/capability.types';

/**
 * Phase 19 — capability selection. This is what replaced "offer all 28 tool
 * schemas on every model call", so the thing to pin down is that narrowing
 * never makes a capability unreachable.
 */

const cap = (over: Partial<Capability> & { name: string }): Capability => ({
  version: '1.0.0',
  category: 'other',
  keywords: [],
  enabled: true,
  description: `the ${over.name} capability`,
  permission: 'read',
  input_schema: {},
  ...over,
});

const now = cap({ name: 'get_now', category: 'time', keywords: ['today', 'now'], always: true });
const listEvents = cap({
  name: 'list_events',
  category: 'calendar',
  keywords: ['calendar', 'event', 'already have'],
  dependencies: ['get_now'],
});
const createEvent = cap({
  name: 'create_event',
  category: 'calendar',
  keywords: ['book', 'add to my calendar'],
  permission: 'write',
  dependencies: ['list_events'],
});
const listEmails = cap({ name: 'list_emails', category: 'email', keywords: ['email', 'inbox'] });
const disabled = cap({ name: 'retired', keywords: ['calendar'], enabled: false });

const all = [now, listEvents, createEvent, listEmails, disabled];

describe('scoreCapability', () => {
  it('scores a phrase above a bare word', () => {
    expect(scoreCapability('add to my calendar please', createEvent)).toBe(2);
    expect(scoreCapability('what is in my inbox', listEmails)).toBe(1);
  });

  it('matches words on boundaries, not substrings', () => {
    // 'event' must not be found inside 'eventually'
    expect(scoreCapability('eventually I will decide', listEvents)).toBe(0);
    expect(scoreCapability('one event tomorrow', listEvents)).toBe(1);
  });

  it('is case-insensitive and scores every hit', () => {
    expect(scoreCapability('My CALENDAR event', listEvents)).toBe(2);
  });
});

describe('selectCapabilities', () => {
  it('narrows to what the request names', () => {
    const result = selectCapabilities('what is in my inbox', all, { limit: 10 });
    expect(result.ambiguous).toBe(false);
    expect(result.selected).toContain('list_emails');
    expect(result.selected).not.toContain('create_event');
  });

  it('always offers always-on capabilities, and ranks them first', () => {
    const result = selectCapabilities('what is in my inbox', all, { limit: 10 });
    expect(result.selected[0]).toBe('get_now');
  });

  it('pulls in dependencies below anything the request named', () => {
    const result = selectCapabilities('book the dentist', all, { limit: 10 });
    expect(result.selected).toContain('create_event');
    // list_events was never named, but you check before you write
    expect(result.selected).toContain('list_events');
    expect(result.selected.indexOf('create_event')).toBeLessThan(
      result.selected.indexOf('list_events'),
    );
  });

  it('widens rather than guesses when nothing matches', () => {
    const result = selectCapabilities('hey', all, { limit: 10 });
    expect(result.ambiguous).toBe(true);
    // every enabled capability is still reachable
    expect(result.selected).toContain('list_emails');
    expect(result.selected).toContain('create_event');
  });

  it('never offers a disabled capability', () => {
    for (const text of ['my calendar', 'hey']) {
      expect(selectCapabilities(text, all, { limit: 10 }).selected).not.toContain('retired');
    }
  });

  it('respects the budget cap', () => {
    const result = selectCapabilities('hey', all, { limit: 2 });
    expect(result.selected).toHaveLength(2);
    expect(result.selected[0]).toBe('get_now');
  });

  it('handles a multi-task request by selecting across categories', () => {
    const result = selectCapabilities(
      'check my calendar and add to my calendar, then look at my email',
      all,
      { limit: 10 },
    );
    expect(result.ambiguous).toBe(false);
    expect(result.selected).toContain('list_events');
    expect(result.selected).toContain('create_event');
    expect(result.selected).toContain('list_emails');
  });
});
