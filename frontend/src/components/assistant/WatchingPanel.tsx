import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { InterestRow, StravaStatus } from "../../lib/api";
import { api } from "../../lib/api";
import { Loading } from "../ui";

/**
 * What it watches for you, and where it gets your training from.
 *
 * Both of these are standing permissions rather than one-off actions — "keep
 * checking this and interrupt me when it matters", "read my workouts" — so
 * both need to be visible and switchable in one obvious place. Being easy to
 * turn off at the moment it annoys you is what makes it safe to turn on.
 *
 * Interests live on render, so this list works whether or not the laptop is
 * awake; Strava's tokens live there too, which is why connecting happens by
 * redirect rather than in the agent.
 */

const CATEGORIES: InterestRow["category"][] = [
  "team",
  "player",
  "company",
  "technology",
  "person",
  "topic",
];

const NOTIFY_LABEL: Record<InterestRow["notify"], string> = {
  push: "Buzz me",
  chat: "In the chat",
  none: "Just collect",
};

function lastChecked(value: string | null): string {
  if (!value) return "not checked yet";
  const hours = (Date.now() - Date.parse(value)) / 3_600_000;
  if (!Number.isFinite(hours)) return "not checked yet";
  if (hours < 1) return "checked just now";
  if (hours < 24) return `checked ${Math.round(hours)}h ago`;
  return `checked ${Math.round(hours / 24)}d ago`;
}

export function WatchingPanel() {
  const [interests, setInterests] = useState<InterestRow[] | null>(null);
  const [strava, setStrava] = useState<StravaStatus | null>(null);
  const [entity, setEntity] = useState("");
  const [category, setCategory] = useState<InterestRow["category"]>("topic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.interests
      .list(true)
      .then((rows) => active && setInterests(rows))
      .catch(() => active && setInterests([]));
    api.strava
      .status()
      .then((status) => active && setStrava(status))
      .catch(() => active && setStrava(null));
    return () => {
      active = false;
    };
  }, []);

  const add = async () => {
    const name = entity.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.interests.create({ entity: name, category });
      setInterests((current) => [created, ...(current ?? []).filter((i) => i.id !== created.id)]);
      setEntity("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add that.");
    } finally {
      setBusy(false);
    }
  };

  const change = async (row: InterestRow, patch: Partial<InterestRow>) => {
    setInterests((current) =>
      (current ?? []).map((i) => (i.id === row.id ? { ...i, ...patch } : i)),
    );
    try {
      await api.interests.update(row.id, patch);
    } catch {
      setError("That change did not save.");
    }
  };

  const remove = async (row: InterestRow) => {
    setInterests((current) => (current ?? []).filter((i) => i.id !== row.id));
    try {
      await api.interests.remove(row.id);
    } catch {
      setError("Could not remove that.");
    }
  };

  const connectStrava = async () => {
    try {
      const { url } = await api.strava.connect();
      window.location.href = url;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the Strava connect.");
    }
  };

  return (
    <>
      <span className="settings-group-label">Watching for you</span>
      <span className="capability-note">
        Followed things are checked on their own schedule. At most three unprompted messages a
        day, whatever is happening — the daily limit applies to these too.
      </span>

      <div className="watch-add">
        <input
          type="text"
          value={entity}
          maxLength={120}
          placeholder="India, Anthropic, interest rates…"
          onChange={(e) => setEntity(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          aria-label="Something to follow"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as InterestRow["category"])}
          aria-label="Kind"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button className="quiet-button" onClick={add} disabled={busy} aria-label="Follow">
          <Plus size={16} />
        </button>
      </div>

      {interests === null ? (
        <Loading variant="inline" size={16} text="Loading…" />
      ) : interests.length === 0 ? (
        <span className="capability-note">
          Nothing yet. You can also just tell it — “keep me posted on India's cricket”.
        </span>
      ) : (
        <ul className="watch-list">
          {interests.map((row) => (
            <li key={row.id} className={row.active ? "" : "is-paused"}>
              <div className="watch-main">
                <span className="watch-entity">{row.entity}</span>
                <span className="watch-meta">
                  {row.category} · {lastChecked(row.last_checked_at)}
                </span>
              </div>
              <select
                value={row.notify}
                onChange={(e) => change(row, { notify: e.target.value as InterestRow["notify"] })}
                aria-label={`How to tell you about ${row.entity}`}
              >
                {(Object.keys(NOTIFY_LABEL) as InterestRow["notify"][]).map((n) => (
                  <option key={n} value={n}>
                    {NOTIFY_LABEL[n]}
                  </option>
                ))}
              </select>
              <button
                className="quiet-button"
                onClick={() => change(row, { active: !row.active })}
                title={row.active ? "Pause" : "Resume"}
              >
                {row.active ? "Pause" : "Resume"}
              </button>
              <button
                className="quiet-button"
                onClick={() => remove(row)}
                aria-label={`Stop following ${row.entity}`}
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <span className="settings-group-label">Training</span>
      {strava?.configured === false ? (
        <span className="capability-note">
          Strava is not set up on the server. Add <code>STRAVA_CLIENT_ID</code>,{" "}
          <code>STRAVA_CLIENT_SECRET</code> and <code>STRAVA_REDIRECT_URI</code> to the render
          service to enable it.
        </span>
      ) : strava?.account ? (
        <div className="settings-row">
          <span>
            Connected as {strava.account.athlete_name ?? "your athlete"}
            <small>Read-only. It can see your activities, never change them.</small>
          </span>
          <button
            className="quiet-button"
            onClick={async () => {
              await api.strava.disconnect().catch(() => undefined);
              setStrava((s) => (s ? { ...s, account: null } : s));
            }}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="settings-row">
          <span>
            Connect Strava
            <small>So “can I train today?” knows what you already did this week.</small>
          </span>
          <button className="quiet-button" onClick={connectStrava}>
            Connect
          </button>
        </div>
      )}

      {error && <span className="capability-note">{error}</span>}
    </>
  );
}
