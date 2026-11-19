/**
 * Commitments — the open loops the companion tracks (Phase 16.1).
 *
 * A commitment is something the user said they'd do, with a believed deadline
 * and a state the companion follows up on — distinct from a task. The same
 * rows the assistant writes when it hears "I need to finish this by Friday"
 * show up here, and can be created, resolved or dropped by hand. Reuses the
 * app shell's existing classes (page-heading, glass-card, data-banner) so it
 * matches the rest of the surface without new CSS.
 */
import { useMemo, useState } from "react";
import { Check, CheckCircle2, Clock3, ClipboardList, Plus, Trash2, X } from "lucide-react";
import type { CommitmentRow, CommitmentState } from "@mypro/shared";
import { useCommitments, type CommitmentInput } from "../../lib/useCommitments";

const KINDS: CommitmentRow["kind"][] = ["promise", "goal", "decision", "intention"];

const STATE_LABEL: Record<CommitmentState, string> = {
  open: "Open",
  at_risk: "At risk",
  done: "Done",
  slipped: "Slipped",
  abandoned: "Dropped",
};

/** Live loops first, then resolved; within each, soonest deadline first. */
const STATE_ORDER: Record<CommitmentState, number> = {
  at_risk: 0,
  open: 1,
  done: 2,
  slipped: 3,
  abandoned: 4,
};

function dueLabel(due: string | null): string {
  if (!due) return "no deadline";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "no deadline";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

const emptyForm: CommitmentInput = { title: "", kind: "promise", due_at: "", detail: "" };

export function CommitmentsView() {
  const commitments = useCommitments(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CommitmentInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const set = <K extends keyof CommitmentInput>(key: K, value: CommitmentInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const sorted = useMemo(
    () =>
      [...commitments.items].sort((a, b) => {
        const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
        if (byState !== 0) return byState;
        const ad = a.due_at ? Date.parse(a.due_at) : Infinity;
        const bd = b.due_at ? Date.parse(b.due_at) : Infinity;
        return ad - bd;
      }),
    [commitments.items],
  );
  const liveCount = commitments.items.filter(
    (c) => c.state === "open" || c.state === "at_risk",
  ).length;

  const submit = async () => {
    setFormError(null);
    const title = (form.title ?? "").trim();
    if (!title) {
      setFormError("What did you commit to?");
      return;
    }
    const input: CommitmentInput = { title, kind: form.kind };
    if (form.detail?.trim()) input.detail = form.detail.trim();
    if (form.due_at) input.due_at = new Date(form.due_at).toISOString();

    setSaving(true);
    try {
      await commitments.create(input);
      setShowForm(false);
      setForm(emptyForm);
    } catch {
      setFormError(commitments.error ?? "Could not save that commitment.");
    } finally {
      setSaving(false);
    }
  };

  const act = async (id: string, work: () => Promise<void>) => {
    setBusyId(id);
    try {
      await work();
    } catch {
      /* the hook surfaces the error banner */
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  };

  return (
    <div className="page-content foundation-view commitments-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow muted-eyebrow">COMMITMENTS</div>
          <h1>What you’re on the hook for.</h1>
          <p>
            Open loops — things you said you’d do, with a deadline and a state your companion
            follows up on. Say “I need to finish this by Friday” to the assistant and it lands
            here too. {liveCount > 0 ? `${liveCount} live right now.` : "Nothing live right now."}
          </p>
        </div>
        <button className="primary-button" onClick={() => setShowForm((open) => !open)}>
          {showForm ? <X size={17} /> : <Plus size={17} />}
          {showForm ? "Close" : "New commitment"}
        </button>
      </header>

      {commitments.error && (
        <div className="data-banner data-banner-error" role="alert">
          {commitments.error}
        </div>
      )}
      {commitments.loading && !commitments.error && (
        <div className="data-banner" aria-live="polite">
          Loading your commitments…
        </div>
      )}
      {!commitments.configured && (
        <div className="data-banner" role="status">
          Commitments need the backend configured — set VITE_API_URL.
        </div>
      )}

      {showForm && (
        <section className="glass-card schedule-form">
          <div className="schedule-form-head">
            <span className="section-kicker">NEW COMMITMENT</span>
            <h2>Name it, and when it’s due.</h2>
          </div>

          <label className="field-label">
            WHAT YOU COMMITTED TO
            <div className="link-input">
              <ClipboardList size={15} />
              <input
                value={form.title}
                onChange={(event) => set("title", event.target.value)}
                placeholder="Finish the project report"
              />
            </div>
          </label>

          <div className="field-label">
            KIND
            <div className="schedule-action-grid">
              {KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`schedule-action-option ${form.kind === kind ? "selected" : ""}`}
                  onClick={() => set("kind", kind)}
                >
                  <strong style={{ textTransform: "capitalize" }}>{kind}</strong>
                </button>
              ))}
            </div>
          </div>

          <label className="field-label">
            DEADLINE (OPTIONAL)
            <div className="link-input">
              <Clock3 size={15} />
              <input
                type="date"
                value={typeof form.due_at === "string" ? form.due_at.slice(0, 10) : ""}
                onChange={(event) => set("due_at", event.target.value)}
              />
            </div>
          </label>

          {formError && (
            <div className="data-banner data-banner-error" role="alert">
              {formError}
            </div>
          )}

          <button className="primary-button" onClick={submit} disabled={saving}>
            <Check size={17} />
            {saving ? "Saving…" : "Add commitment"}
          </button>
        </section>
      )}

      {!commitments.loading && commitments.configured && sorted.length === 0 && (
        <div className="data-banner" role="status">
          No open loops yet. Add one above, or tell your assistant what you’ve promised.
        </div>
      )}

      <div className="commitments-list" style={{ display: "grid", gap: 12 }}>
        {sorted.map((c) => {
          const resolved = c.state === "done" || c.state === "slipped" || c.state === "abandoned";
          const busy = busyId === c.id;
          return (
            <section
              key={c.id}
              className="glass-card"
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                opacity: resolved ? 0.6 : 1,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    className="section-kicker"
                    style={{ textTransform: "uppercase", letterSpacing: ".06em" }}
                  >
                    {c.kind}
                  </span>
                  <span className="section-kicker">· {STATE_LABEL[c.state]}</span>
                  <span className="section-kicker">· {dueLabel(c.due_at)}</span>
                </div>
                <h3
                  style={{
                    margin: "4px 0 0",
                    textDecoration: c.state === "done" ? "line-through" : "none",
                  }}
                >
                  {c.title}
                </h3>
                {c.detail && (
                  <p style={{ margin: "4px 0 0", opacity: 0.75 }}>{c.detail}</p>
                )}
              </div>

              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {!resolved && (
                  <>
                    <button
                      className="icon-button"
                      title="Mark done"
                      disabled={busy}
                      onClick={() => act(c.id, () => commitments.update(c.id, { state: "done" }))}
                    >
                      <CheckCircle2 size={16} />
                    </button>
                    {c.state !== "at_risk" && (
                      <button
                        className="icon-button"
                        title="Flag at risk"
                        disabled={busy}
                        onClick={() => act(c.id, () => commitments.update(c.id, { state: "at_risk" }))}
                      >
                        <Clock3 size={16} />
                      </button>
                    )}
                  </>
                )}
                {resolved && (
                  <button
                    className="icon-button"
                    title="Reopen"
                    disabled={busy}
                    onClick={() => act(c.id, () => commitments.update(c.id, { state: "open" }))}
                  >
                    <Clock3 size={16} />
                  </button>
                )}
                {confirmDelete === c.id ? (
                  <button
                    className="icon-button danger"
                    title="Confirm delete"
                    disabled={busy}
                    onClick={() => act(c.id, () => commitments.remove(c.id))}
                  >
                    <Check size={16} />
                  </button>
                ) : (
                  <button
                    className="icon-button danger"
                    title="Delete"
                    disabled={busy}
                    onClick={() => setConfirmDelete(c.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
