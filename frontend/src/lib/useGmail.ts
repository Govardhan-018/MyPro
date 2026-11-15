/**
 * Connected mailboxes — Phase 7.2.
 *
 * Everything here goes through render, which is the only half holding the
 * OAuth tokens. The connect flow is a full-page navigation rather than a
 * popup: Google blocks its consent screen in many popup contexts, and a
 * redirect works everywhere including an installed PWA.
 */
import { useCallback, useEffect, useState } from 'react';
import type { GmailAccountRow } from '@mypro/shared';
import { api } from './api';
import { isApiConfigured } from './env';

export interface GmailState {
  /** Whether the server has Google credentials at all. */
  configured: boolean;
  accounts: GmailAccountRow[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Result of the last sync, phrased for a person. */
  note: string | null;
  connect: () => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  sync: () => Promise<void>;
  reload: () => void;
}

export function useGmail(enabled: boolean): GmailState {
  const active = isApiConfigured && enabled;
  const [configured, setConfigured] = useState(false);
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
    try {
      const [status, rows] = await Promise.all([
        api.gmail.status(),
        api.gmail.accounts().catch(() => [] as GmailAccountRow[]),
      ]);
      setConfigured(status.configured);
      setAccounts(rows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your mailboxes.');
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
      setError('Google sign-in was cancelled.');
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

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.gmail.connect();
      // Leaves the app. The state in that URL is short-lived and signed, so
      // it cannot be saved and replayed later.
      window.location.assign(url);
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

  return {
    configured,
    accounts,
    loading,
    busy,
    error,
    note,
    connect,
    disconnect,
    sync,
    reload: () => void load(),
  };
}
