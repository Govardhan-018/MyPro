/**
 * The character creator.
 *
 * Who the assistant *is* used to be three unexplained text fields in a
 * settings list — a name, a "tone", and "style notes" — which is a terrible
 * way to ask someone to invent a companion. This is the same three fields,
 * presented as the one decision it actually is: what is it called, and how
 * does it talk.
 *
 * Effort deliberately does **not** live here. How hard it should think is a
 * per-question decision, not a personality trait, so that control sits in the
 * chat where the question is typed.
 *
 * It owns no state and does no saving. The settings modal still loads and
 * saves everything in one place; this is the form.
 */

export type PersonaDraft = {
  name?: string;
  tone?: string;
  style_notes?: string;
  check_in_time?: string;
  inactivity_hours?: number;
  proactive_enabled?: boolean;
};

/**
 * Starting points, not personalities. Each one fills the two fields the model
 * actually reads, and the charter is written in the second person because
 * that is how it reaches the prompt.
 */
const PRESETS: {
  id: string;
  label: string;
  blurb: string;
  tone: string;
  charter: string;
}[] = [
  {
    id: "friend",
    label: "Close friend",
    blurb: "Warm, informal, remembers things",
    tone: "warm, casual, like a close friend",
    charter:
      "Talk to me the way a close friend would: short messages, no formality, no hedging. " +
      "Ask about the things I told you mattered. Say the hard thing kindly.",
  },
  {
    id: "dry",
    label: "Dry and brief",
    blurb: "Few words, no padding",
    tone: "dry, brief, lightly funny",
    charter:
      "Be brief to the point of blunt. One or two sentences unless I ask for more. " +
      "No encouragement, no preamble. Dry humour is welcome; enthusiasm is not.",
  },
  {
    id: "coach",
    label: "Coach",
    blurb: "Direct, holds you to things",
    tone: "direct, steady, encouraging without flattery",
    charter:
      "Hold me to what I said I would do. Open with the thing I am avoiding. " +
      "Offer the next concrete step rather than sympathy, and tell me when I am drifting.",
  },
  {
    id: "calm",
    label: "Calm and careful",
    blurb: "Measured, explains its reasoning",
    tone: "calm, plain, unhurried",
    charter:
      "Be measured and plain. Lay out what you know, what you did, and what you are unsure " +
      "about. Never rush me toward a decision, and never oversell an answer.",
  },
];

/** A face for the character, derived from its name — no upload, no storage. */
export function characterInitial(name?: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "M";
  // Works for an emoji name too: the first code point, whatever it is.
  return [...trimmed][0].toUpperCase();
}

export function CharacterPanel({
  persona,
  onPersona,
}: {
  persona: PersonaDraft;
  onPersona: (next: PersonaDraft) => void;
}) {
  const patch = (next: Partial<PersonaDraft>) => onPersona({ ...persona, ...next });

  const activePreset = PRESETS.find(
    (p) => p.tone === persona.tone && p.charter === persona.style_notes,
  );

  return (
    <>
      <span className="settings-group-label">Character</span>

      <div className="character-head">
        <div className="character-avatar" aria-hidden="true">
          {characterInitial(persona.name)}
        </div>
        <div className="character-head-fields">
          <input
            className="character-name-input"
            type="text"
            value={persona.name ?? ""}
            maxLength={60}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="MyPro"
            aria-label="Character name"
          />
          <span className="character-head-hint">
            What should it call itself? It answers to this name.
          </span>
        </div>
      </div>

      <div className="character-presets" role="group" aria-label="Character presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`character-preset${activePreset?.id === preset.id ? " is-active" : ""}`}
            onClick={() => patch({ tone: preset.tone, style_notes: preset.charter })}
          >
            <span className="character-preset-label">{preset.label}</span>
            <span className="character-preset-blurb">{preset.blurb}</span>
          </button>
        ))}
      </div>
      <span className="character-note">
        A preset fills the two fields below. Edit them freely — they go straight into how it
        speaks, so your own words beat a preset every time.
      </span>

      <label className="settings-row">
        <span>Tone</span>
        <input
          type="text"
          value={persona.tone ?? ""}
          maxLength={400}
          onChange={(e) => patch({ tone: e.target.value })}
          placeholder="warm, casual, like a close friend"
        />
      </label>

      <label className="settings-row settings-row-stack">
        <span>Charter — the rules it follows</span>
        <textarea
          value={persona.style_notes ?? ""}
          maxLength={4000}
          rows={4}
          onChange={(e) => patch({ style_notes: e.target.value })}
          placeholder="How should it talk to you? What should it never do?"
        />
      </label>

      <span className="settings-group-label">Speaking first</span>
      <label className="settings-row settings-toggle-row">
        <span>
          Let it start conversations
          <small>Check-ins, nudges, an evening close-out. At most three a day.</small>
        </span>
        <input
          type="checkbox"
          checked={persona.proactive_enabled ?? false}
          onChange={(e) => patch({ proactive_enabled: e.target.checked })}
        />
      </label>
      <label className="settings-row">
        <span>Daily check-in</span>
        <input
          type="time"
          value={(persona.check_in_time ?? "").slice(0, 5)}
          onChange={(e) => patch({ check_in_time: e.target.value })}
        />
      </label>
      <label className="settings-row">
        <span>Nudge after (hours idle)</span>
        <input
          type="number"
          min={1}
          max={168}
          value={persona.inactivity_hours ?? ""}
          onChange={(e) =>
            patch({
              inactivity_hours: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
      </label>
    </>
  );
}
