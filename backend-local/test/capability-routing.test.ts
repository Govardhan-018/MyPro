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

const createTask = cap({
  name: 'create_task',
  category: 'tasks',
  keywords: ['add a task'],
  permission: 'write',
});
const getWeather = cap({ name: 'get_weather', category: 'weather', keywords: ['weather'] });

const all = [now, listEvents, createEvent, listEmails, disabled, createTask, getWeather];

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

  it('offers the rest of a category once any of it matches', () => {
    // Asking to read the calendar is one sentence away from asking to
    // change it, and categories are small enough to offer whole.
    const result = selectCapabilities('what is on my calendar', all, { limit: 10 });
    expect(result.selected).toContain('list_events');
    expect(result.selected).toContain('create_event');
  });

  /**
   * The lie guard, from a real failure: "put a reminder on tomorrow morning
   * for run in calender" matched nothing that writes, because `calender` is
   * misspelled — and the agent replied "I can't create calendar reminders,
   * so you'll need to add this manually." It can. Routing had simply not
   * given it the tool.
   *
   * No keyword list fixes a typo. Noticing that an action was asked for and
   * nothing offered can act does.
   */
  it('always offers a way to act when the request asks for an action', () => {
    const result = selectCapabilities(
      'put a reminder on tomorowwo morning for run in calender',
      all,
      { limit: 10 },
    );
    expect(result.selected.some((n) => ['create_event', 'create_task'].includes(n))).toBe(true);
  });

  it('does the same for a request whose only match is a read elsewhere', () => {
    const result = selectCapabilities('check the weather and put it somewhere', all, {
      limit: 10,
    });
    expect(result.selected).toContain('get_weather');
    expect(result.selected.some((n) => ['create_event', 'create_task'].includes(n))).toBe(true);
  });

  it('does not force writes onto a question that only asks something', () => {
    const result = selectCapabilities('what is the weather', all, { limit: 10 });
    expect(result.selected).toContain('get_weather');
    expect(result.selected).not.toContain('create_task');
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
