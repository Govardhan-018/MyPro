/**
 * The commitments data layer (Phase 16.1).
 *
 * Open loops are written from two directions — you, here, and the companion
 * when it hears "I need to finish this by Friday" — so this hook always reads
 * the server's view (backend-render) rather than keeping a local model. Served
 * by render, so it works whether or not the laptop is awake.
 */
import { useCallback, useEffect, useState } from 'react';
import type { CommitmentRow } from '@mypro/shared';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';

export interface CommitmentInput extends Record<string, unknown> {
  title: string;
  detail?: string;
  kind?: CommitmentRow['kind'];
  due_at?: string;
  confidence?: number;
  state?: CommitmentRow['state'];
  next_checkin_at?: string;
}

function message(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

export interface CommitmentsState {
  items: CommitmentRow[];
  loading: boolean;
  error: string | null;
  configured: boolean;
  reload: () => void;
  create: (input: CommitmentInput) => Promise<void>;
  update: (id: string, input: Partial<CommitmentInput>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useCommitments(enabled: boolean): CommitmentsState {
  const configured = isApiConfigured;
  const active = configured && enabled;
  const [items, setItems] = useState<CommitmentRow[]>([]);
  const [loading, setLoading] = useState<boolean>(active);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!active) return;
    setError(null);
    try {
      setItems(await api.commitments.list());
    } catch (caught) {
      setError(message(caught, 'Could not load your commitments.'));
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active) {
      setLoading(false);
      return;
    }
    void load();
  }, [active, load]);

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await work();
      await load();
    } catch (caught) {
      setError(message(caught, fallback));
      throw caught;
    }
  };

  return {
    items,
    loading,
    error,
    configured,
    reload: () => void load(),
    create: (input) =>
      run(() => api.commitments.create(input), 'Could not create that commitment.'),
    update: (id, input) =>
      run(() => api.commitments.update(id, input), 'Could not update that commitment.'),
    remove: (id) => run(() => api.commitments.remove(id), 'Could not delete that commitment.'),
  };
}
