/**
 * Connected mailboxes — Phase 7.2.
 *
 * Everything here goes through render, which is the only half holding the
 * OAuth tokens. The connect flow is a full-page navigation rather than a
 * popup: Google blocks its consent screen in many popup contexts, and a
 * redirect works everywhere including an installed PWA.
 */
import { useCallback, useEffect, useState } from 'react';
import type { GmailAccountRow, GmailAccessLevel } from '@mypro/shared';
import { api } from './api';
import { isApiConfigured } from './env';
import { inShell } from './shell';

/**
 * Whether the page was opened by Render's Gmail callback (`?gmail=…`). The app
 * reads this at boot to open Settings → Mail, so the outcome is shown where
 * the user started instead of on whatever page happened to load.
 */
export function isGmailReturn(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('gmail');
}

export interface GmailState {
  /** Whether the server has Google credentials at all. */
  configured: boolean;
  /** Where the credentials come from: the app's Settings, Render's env, or none. */
  source: 'settings' | 'env' | null;
  /** The server's own OAuth callback URL, shown read-only for developer setup. */
  redirectUri: string | null;
  /** What the server says is missing for Gmail to work (names only). */
  missing: string[];
  /**
   * The status request itself failed (offline, server waking). Distinct from
   * "not configured": the UI must not claim Gmail is unavailable on the server
   * when it simply could not ask.
   */
  statusError: string | null;
  accounts: GmailAccountRow[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Result of the last sync, phrased for a person. */
  note: string | null;
  /** Start the connect flow for a mailbox at the chosen access level. */
  connect: (mode: GmailAccessLevel) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  sync: () => Promise<void>;
  /** Save the in-app Google OAuth app credentials (encrypted server-side). */
  saveOauthConfig: (input: { client_id: string; client_secret: string }) => Promise<void>;
  /** Delete the in-app credentials. */
  deleteOauthConfig: () => Promise<void>;
  reload: () => void;
}

export function useGmail(enabled: boolean): GmailState {
  const active = isApiConfigured && enabled;
  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState<'settings' | 'env' | null>(null);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<GmailAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!active) {
      setLoading(false);
      return;
    }
    setError(null);
    setStatusError(null);
    try {
      const [status, rows] = await Promise.all([
        api.gmail.status(),
        api.gmail.accounts().catch(() => [] as GmailAccountRow[]),
      ]);
      setConfigured(status.configured);
      setSource(status.source);
      setRedirectUri(status.redirect_uri ?? null);
      setMissing(status.missing ?? []);
      setAccounts(rows);
    } catch (caught) {
      setStatusError(
        caught instanceof Error ? caught.message : 'Could not check your Gmail connection.',
      );
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Read the outcome render appended on its way back, then clean the URL so a
   * refresh does not re-announce a connection made ten minutes ago.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('gmail');
    if (!outcome) return;

    if (outcome === 'connected') {
      const email = params.get('email');
      setNote(email ? `${email} is connected.` : 'Mailbox connected.');
      void load();
    } else if (outcome === 'denied') {
      setError('Google sign-in was cancelled, so nothing was connected.');
    } else if (outcome === 'expired') {
      setError('That sign-in took too long and expired. Tap Connect Gmail to try again.');
    } else {
      setError('That mailbox could not be connected. Try again.');
    }

    params.delete('gmail');
    params.delete('email');
    const query = params.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    );
  }, [load]);

  const connect = useCallback(async (mode: GmailAccessLevel) => {
    setBusy(true);
    setError(null);
    try {
      // From the Android app the consent screen opens in the system browser
      // (Google refuses OAuth in a WebView); ask Render to return us to the app.
      const { url } = await api.gmail.connect(mode, inShell ? 'app' : 'web');
      // Leaves the app. The state in that URL is short-lived and signed, so
      // it cannot be saved and replayed later.
      window.location.assign(url);
      // In the app the page stays put (the browser opened instead), so do not
      // leave the button spinning; the result arrives via the app link.
      if (inShell) window.setTimeout(() => setBusy(false), 1500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the connect flow.');
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        await api.gmail.removeAccount(id);
        setNote('Mailbox disconnected. Its stored messages were removed with it.');
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not disconnect that mailbox.');
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const sync = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { results } = await api.gmail.sync();
      if (!results.length) {
        setNote('No mailboxes to sync.');
      } else {
        setNote(
          results
            .map((result) =>
              result.error
                ? `${result.account}: ${result.error}`
                : `${result.account}: ${result.stored} message${result.stored === 1 ? '' : 's'} (${result.mode})`,
            )
            .join(' · '),
        );
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sync failed.');
    } finally {
      setBusy(false);
    }
  }, [load]);

  const saveOauthConfig = useCallback(
    async (input: { client_id: string; client_secret: string }) => {
      setBusy(true);
      setError(null);
      setNote(null);
      try {
        const status = await api.gmail.saveOauthConfig(input);
        setConfigured(status.configured);
        setSource(status.source);
        setRedirectUri(status.redirect_uri ?? null);
        setMissing(status.missing ?? []);
        setNote('Google app credentials saved. You can connect a mailbox now.');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not save those credentials.');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const deleteOauthConfig = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const status = await api.gmail.deleteOauthConfig();
      setConfigured(status.configured);
      setSource(status.source);
      setMissing(status.missing ?? []);
      setNote('Google app credentials removed.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove those credentials.');
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    configured,
    source,
    redirectUri,
    missing,
    statusError,
    accounts,
    loading,
    busy,
    error,
    note,
    connect,
    disconnect,
    sync,
    saveOauthConfig,
    deleteOauthConfig,
    reload: () => void load(),
  };
}
