import { describe, it, expect } from 'vitest';
import {
  scopesForLevel,
  scopesGrantSend,
  levelFromScopes,
} from '../src/gmail/google-oauth.service';

/**
 * A mailbox is connected read-only or read + send, per account (Feature:
 * Gmail access level). These pure helpers decide which scopes are requested
 * at connect time and whether a stored grant may send — the gate the send
 * path leans on, so it is worth pinning.
 */
const READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
const SEND = 'https://www.googleapis.com/auth/gmail.send';

describe('scopesForLevel', () => {
  it('read-only requests gmail.readonly and identity, never send', () => {
    const scopes = scopesForLevel('read');
    expect(scopes).toContain(READONLY);
    expect(scopes).toContain('openid');
    expect(scopes).toContain('email');
    expect(scopes).not.toContain(SEND);
  });

  it('send requests readonly + send', () => {
    const scopes = scopesForLevel('send');
    expect(scopes).toContain(READONLY);
    expect(scopes).toContain(SEND);
  });
});

describe('scopesGrantSend', () => {
  it('is true only when gmail.send is present', () => {
    expect(scopesGrantSend(`${READONLY} ${SEND} openid email`)).toBe(true);
    expect(scopesGrantSend(`${READONLY} openid email`)).toBe(false);
  });

  it('treats null / empty / unknown scopes as read-only', () => {
    expect(scopesGrantSend(null)).toBe(false);
    expect(scopesGrantSend('')).toBe(false);
    expect(scopesGrantSend('   ')).toBe(false);
    // A substring of the send scope must not count as a grant.
    expect(scopesGrantSend('https://www.googleapis.com/auth/gmail.send.readonly')).toBe(false);
  });
});

describe('levelFromScopes', () => {
  it('maps a stored scope string back to its level for display', () => {
    expect(levelFromScopes(`${READONLY} ${SEND}`)).toBe('send');
    expect(levelFromScopes(READONLY)).toBe('read');
    expect(levelFromScopes(null)).toBe('read');
  });
});
