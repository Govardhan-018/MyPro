import { CalendarDays, CloudSun, ExternalLink } from "lucide-react";
import type { DisplayBlock } from "../../lib/api";

/**
 * The structured half of a reply.
 *
 * Everything here was built on the agent from what the tools actually
 * returned, so a link shown is a link that was genuinely fetched and a date
 * shown came from the provider rather than from the model's memory. That is
 * the reason these are cards and not prose: prose is where a date quietly
 * becomes wrong.
 *
 * The model is told these are on screen and not to repeat them, so the
 * paragraph above should be a takeaway, not a list.
 */

/** Dates come from providers in UTC; the user reads them in local time. */
function when(iso?: string, timeKnown = true): string {
  if (!iso) return "date to be confirmed";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "date to be confirmed";

  const day = date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (!timeKnown) return `${day} · time TBC`;
  return `${day}, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function published(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const hours = (Date.now() - date.getTime()) / 3_600_000;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  if (hours < 24 * 7) return `${Math.round(hours / 24)}d ago`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SourcesBlock({ block }: { block: Extract<DisplayBlock, { kind: "sources" }> }) {
  return (
    <ul className="result-sources">
      {block.items.map((item) => (
        <li key={item.url}>
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            <span className="source-title">{item.title}</span>
            <span className="source-meta">
              {item.publisher ?? hostOf(item.url)}
              {published(item.published_at) && <> · {published(item.published_at)}</>}
              <ExternalLink size={11} aria-hidden="true" />
            </span>
          </a>
          {item.snippet && <p className="source-snippet">{item.snippet}</p>}
        </li>
      ))}
    </ul>
  );
}

function FixturesBlock({ block }: { block: Extract<DisplayBlock, { kind: "fixtures" }> }) {
  return (
    <div className="result-card">
      <header className="result-card-head">
        <CalendarDays size={13} aria-hidden="true" />
        <span>
          {block.resolved
            ? block.resolved.kind === "player"
              ? `${block.resolved.name} — ${block.resolved.team}`
              : block.resolved.team
            : "Fixtures"}
        </span>
      </header>
      <ul className="result-fixtures">
        {block.items.map((f, i) => (
          <li key={`${f.home}-${f.away}-${i}`}>
            <span className="fixture-teams">
              {f.home} <i>v</i> {f.away}
            </span>
            <span className="fixture-meta">
              {when(f.starts_at, !f.time_unknown)}
              {f.venue && <> · {f.venue}</>}
              {f.score && <> · {f.score}</>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WeatherBlock({ block }: { block: Extract<DisplayBlock, { kind: "weather" }> }) {
  const round = (n?: number) => (typeof n === "number" ? Math.round(n) : null);

  return (
    <div className="result-card">
      <header className="result-card-head">
        <CloudSun size={13} aria-hidden="true" />
        <span>{block.place}</span>
        {block.now?.temperature_c != null && (
          <strong className="weather-now">
            {round(block.now.temperature_c)}°{block.now.summary ? ` · ${block.now.summary}` : ""}
          </strong>
        )}
      </header>
      <ul className="result-weather">
        {block.days.map((day) => (
          <li key={day.date}>
            <span className="weather-day">
              {new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "short",
              })}
            </span>
            <span className="weather-range">
              {round(day.max_c)}° <i>/ {round(day.min_c)}°</i>
            </span>
            <span className="weather-summary">
              {day.summary}
              {day.precipitation_chance != null && day.precipitation_chance > 0 && (
                <> · {Math.round(day.precipitation_chance)}% rain</>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResultBlocks({ blocks }: { blocks?: DisplayBlock[] | null }) {
  if (!blocks?.length) return null;

  return (
    <div className="result-blocks">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "sources":
            return <SourcesBlock key={i} block={block} />;
          case "fixtures":
            return <FixturesBlock key={i} block={block} />;
          case "weather":
            return <WeatherBlock key={i} block={block} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
