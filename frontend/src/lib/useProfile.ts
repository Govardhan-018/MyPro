/**
 * Your profile row (`/me`): display name, timezone, locale and whether Color
 * Mode is on. The row is created on first read by the API, so there is no
 * separate "set up your profile" step.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';

export interface Profile {
  display_name: string;
  timezone: string;
  locale: string;
  color_mode: boolean;
}

const EMPTY: Profile = { display_name: '', timezone: '', locale: '', color_mode: false };

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function toProfile(row: Record<string, unknown>): Profile {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    display_name: str(row.display_name),
    timezone: str(row.timezone) || browserTimezone(),
    locale: str(row.locale),
    color_mode: Boolean(row.color_mode),
  };
}

export interface ProfileState {
  profile: Profile;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** True once the server's copy has been read at least once. */
  loaded: boolean;
  save: (patch: Partial<Profile>) => Promise<void>;
}

export function useProfile(enabled: boolean): ProfileState {
  const active = isApiConfigured && enabled;
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [loading, setLoading] = useState(active);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setLoading(false);
      return;
    }
    let alive = true;
    api.profile
      .get()
      .then((row) => {
        if (!alive) return;
        setProfile(toProfile(row));
        setLoaded(true);
      })
      .catch((caught) => {
        if (!alive) return;
        setError(caught instanceof ApiError ? caught.message : 'Could not load your profile.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [active]);

  const save = useCallback(
    async (patch: Partial<Profile>) => {
      setProfile((current) => ({ ...current, ...patch }));
      if (!active) return;
      setSaving(true);
      setError(null);
      try {
        await api.profile.update(patch as Record<string, unknown>);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Could not save that.');
      } finally {
        setSaving(false);
      }
    },
    [active],
  );

  return { profile, loading, saving, error, loaded, save };
}
