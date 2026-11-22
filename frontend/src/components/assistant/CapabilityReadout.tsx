import { useEffect, useState } from "react";
import type { AgentCapabilityReadout } from "@mypro/shared";
import { api } from "../../lib/api";

/**
 * What the agent can actually do, read from the agent itself.
 *
 * Deliberately not a hand-maintained list: it comes from the executable
 * registry on the laptop, so it cannot drift from reality the way a feature
 * list in a settings screen always does. The research rows are the useful
 * part day to day — they say which external service would answer a question
 * right now, and which are installed but switched off for want of a key.
 */

const KIND_LABELS: Record<string, string> = {
  search: "Web search",
  news: "News",
  sports: "Fixtures",
  extract: "Reading pages",
  weather: "Weather",
};

export function CapabilityReadout() {
  const [data, setData] = useState<AgentCapabilityReadout | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.assistant
      .capabilities()
      .then((readout) => active && setData(readout))
      .catch(
        (caught: unknown) =>
          active &&
          setError(
            caught instanceof Error ? caught.message : "Could not read the capability list.",
          ),
      );
    return () => {
      active = false;
    };
  }, []);

  if (error) return <span className="capability-note">{error}</span>;
  if (!data) return <span className="capability-note">Reading what it can do…</span>;

  const byCategory = new Map<string, number>();
  for (const capability of data.capabilities) {
    byCategory.set(capability.category, (byCategory.get(capability.category) ?? 0) + 1);
  }

  return (
    <>
      <div className="capability-summary">
        <strong>{data.capabilities.length}</strong> capabilities
        <span>
          {[...byCategory.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([category, count]) => `${category} ${count}`)
            .join(" · ")}
        </span>
      </div>

      {data.research_providers?.length ? (
        <ul className="provider-list">
          {data.research_providers.map((row) => (
            <li key={row.kind} className={row.active.length ? "" : "is-off"}>
              <span className="provider-kind">{KIND_LABELS[row.kind] ?? row.kind}</span>
              <span className="provider-active">
                {row.active.length
                  ? row.active.map((p) => `${p.id}${p.free ? " · free" : ""}`).join(" → ")
                  : "nothing configured"}
              </span>
              {row.inactive.length > 0 && (
                <span className="provider-inactive">off: {row.inactive.join(", ")}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <span className="capability-note">
        Providers are tried left to right; a failure falls through to the next. Add a key in the
        agent's <code>.env</code> to promote a better one.
      </span>
    </>
  );
}
