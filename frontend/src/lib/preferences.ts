/**
 * Small per-device display preferences, kept in localStorage.
 *
 * These change how a screen looks on *this* device, never what it can do, so
 * they do not travel with the profile. Every read and write is guarded: in a
 * private window or with storage blocked the default simply applies.
 */
import { useCallback, useEffect, useState } from "react";

const EVENT = "mypro:preference";

export interface Preferences {
  /** Show the search bar at the top of the Library. */
  librarySearch: boolean;
}

const DEFAULTS: Preferences = {
  librarySearch: true,
};

const keyOf = (name: keyof Preferences) => `mypro.pref.${name}`;

export function readPreference<K extends keyof Preferences>(name: K): Preferences[K] {
  try {
    const raw = localStorage.getItem(keyOf(name));
    if (raw === null) return DEFAULTS[name];
    return JSON.parse(raw) as Preferences[K];
  } catch {
    return DEFAULTS[name];
  }
}

export function writePreference<K extends keyof Preferences>(name: K, value: Preferences[K]): void {
  try {
    localStorage.setItem(keyOf(name), JSON.stringify(value));
  } catch {
    /* storage blocked: the change lasts for this visit only */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { name, value } }));
}

/** A preference as React state, kept in step across components and tabs. */
export function usePreference<K extends keyof Preferences>(
  name: K,
): [Preferences[K], (value: Preferences[K]) => void] {
  const [value, setValue] = useState<Preferences[K]>(() => readPreference(name));
  useEffect(() => {
    const sync = () => setValue(readPreference(name));
    const onLocal = (event: Event) => {
      if ((event as CustomEvent<{ name: string }>).detail?.name === name) sync();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === keyOf(name)) sync();
    };
    window.addEventListener(EVENT, onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, [name]);
  const set = useCallback(
    (next: Preferences[K]) => {
      setValue(next);
      writePreference(name, next);
    },
    [name],
  );
  return [value, set];
}
