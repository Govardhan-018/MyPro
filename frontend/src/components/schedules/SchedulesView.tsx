/**
 * Schedules (Roadmap Phase 5).
 *
 * The scheduler has been running on Render all along and the assistant can
 * already create schedules through its skills — this is the screen that lets
 * you see, build, pause and delete them, and read what each run actually did.
 */
import { useState } from "react";
import {
  AlarmClock,
  Bell,
  CalendarClock,
  Check,
  ChevronDown,
  History,
  Loader2,
  Mail,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { ScheduleRow } from "@mypro/shared";
import {
  rowToInput,
  useSchedules,
  type ScheduleInput,
  type ScheduleRunRow,
} from "../../lib/useSchedules";

const ACTION_META: Record<
  ScheduleRow["action_type"],
  { label: string; hint: string; Icon: typeof Bell }
> = {
  notify: { label: "Notification", hint: "A message in the app", Icon: Bell },
  report: { label: "Report", hint: "The assistant writes you a brief", Icon: CalendarClock },
  chat_message: { label: "Chat message", hint: "Lands in your conversation", Icon: MessageSquare },
  email: { label: "Email", hint: "Needs Gmail (Phase 7)", Icon: Mail },
};

const RECURRENCES: { id: ScheduleRow["recurrence"]; label: string }[] = [
  { id: "daily", label: "Every day" },
  { id: "weekly", label: "Certain weekdays" },
  { id: "monthly", label: "Monthly" },
  { id: "once", label: "Once" },
  { id: "cron", label: "Cron" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];

const RUN_LABEL: Record<string, string> = {
  success: "Ran",
  failed: "Failed",
  skipped: "Skipped",
  pending_confirmation: "Waiting for you",
  deferred: "Waited for your laptop",
};

const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** "Thu 15 Nov, 08:30" — short, local, no library. */
function when(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The one-line account of when a schedule fires. */
function cadence(row: ScheduleRow): string {
  const time = row.time_of_day?.slice(0, 5);
  switch (row.recurrence) {
    case "daily":
      return `Every day at ${time}`;
    case "weekly": {
      const days = (row.assistant_schedule_days ?? [])
        .map((day) => day.day_of_week)
        .sort((a, b) => a - b);
      const names = days.map((day) => DAYS[day]).join(", ");
      const weekdaysOnly =
        days.length === 5 && WEEKDAYS.every((day) => days.includes(day));
      return `${weekdaysOnly ? "Weekdays" : names || "No days"} at ${time}`;
    }
    case "monthly":
      return `Day ${row.day_of_month} of each month at ${time}`;
    case "once":
      return `Once, ${when(row.run_at)}`;
    case "cron":
      return `Cron: ${row.cron_expr}`;
    default:
      return "—";
  }
}

const emptyForm = {
  name: "",
  action_type: "report" as ScheduleRow["action_type"],
  prompt: "",
  recurrence: "daily" as ScheduleRow["recurrence"],
  time_of_day: "08:30",
  days: [...WEEKDAYS],
  day_of_month: 1,
  run_at: "",
  cron_expr: "",
  requires_confirmation: false,
};

export function SchedulesView() {
  const schedules = useSchedules(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [openRuns, setOpenRuns] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, ScheduleRunRow[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const toggleDay = (day: number) =>
    setForm((current) => ({
      ...current,
      days: current.days.includes(day)
        ? current.days.filter((d) => d !== day)
        : [...current.days, day].sort((a, b) => a - b),
    }));

  const submit = async () => {
    setFormError(null);
    const name = form.name.trim();
    if (!name) {
      setFormError("Give it a name you'll recognise.");
      return;
    }
    if (form.recurrence === "weekly" && !form.days.length) {
      setFormError("Pick at least one weekday.");
      return;
    }
    if (form.recurrence === "once" && !form.run_at) {
      setFormError("Choose when it should run.");
      return;
    }
    if (form.recurrence === "cron" && !form.cron_expr.trim()) {
      setFormError("A cron expression is required.");
      return;
    }

    const input: ScheduleInput = {
      name,
      action_type: form.action_type,
      // What the agent is asked to do when the action needs words.
      action_payload: form.prompt.trim() ? { prompt: form.prompt.trim() } : {},
      channel: "in_app",
      recurrence: form.recurrence,
      timezone: browserTimezone(),
      enabled: true,
      requires_confirmation: form.requires_confirmation,
    };
    if (form.recurrence === "once") input.run_at = new Date(form.run_at).toISOString();
    else input.time_of_day = form.time_of_day;
    if (form.recurrence === "weekly") input.days = form.days;
    if (form.recurrence === "monthly") input.day_of_month = form.day_of_month;
    if (form.recurrence === "cron") input.cron_expr = form.cron_expr.trim();

    setSaving(true);
    try {
      await schedules.create(input);
      setShowForm(false);
      setForm(emptyForm);
    } catch {
      setFormError(schedules.error ?? "Could not create that schedule.");
    } finally {
      setSaving(false);
    }
  };

  const showRuns = async (id: string) => {
    if (openRuns === id) {
      setOpenRuns(null);
      return;
    }
    setOpenRuns(id);
    if (!runs[id]) {
      try {
        const rows = await schedules.runs(id);
        setRuns((current) => ({ ...current, [id]: rows }));
      } catch {
        setRuns((current) => ({ ...current, [id]: [] }));
      }
    }
  };

  const active = schedules.items.filter((row) => row.enabled);

  return (
    <div className="page-content foundation-view schedules-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow muted-eyebrow">SCHEDULES</div>
          <h1>What reaches you, and when.</h1>
          <p>
            Standing instructions your companion runs on its own — briefs, reminders and
            check-ins. Your assistant can create these too; they all land here.
          </p>
        </div>
        <button className="primary-button" onClick={() => setShowForm((open) => !open)}>
          {showForm ? <X size={17} /> : <Plus size={17} />}
          {showForm ? "Close" : "New schedule"}
        </button>
      </header>

      {schedules.error && (
        <div className="data-banner data-banner-error" role="alert">
          {schedules.error}
        </div>
      )}
      {schedules.loading && !schedules.error && (
        <div className="data-banner" aria-live="polite">
          Loading your schedules…
        </div>
      )}
      {!schedules.configured && (
        <div className="data-banner" role="status">
          Schedules need the backend configured — set VITE_API_URL.
        </div>
      )}

      {showForm && (
        <section className="glass-card schedule-form">
          <div className="schedule-form-head">
            <span className="section-kicker">NEW SCHEDULE</span>
            <h2>Tell it what to do, and when.</h2>
          </div>

          <label className="field-label">
            NAME
            <div className="link-input">
              <AlarmClock size={15} />
              <input
                value={form.name}
                onChange={(event) => set("name", event.target.value)}
                placeholder="Morning brief"
              />
            </div>
          </label>

          <div className="field-label">
            WHAT HAPPENS
            <div className="schedule-action-grid">
              {(Object.keys(ACTION_META) as ScheduleRow["action_type"][]).map((type) => {
                const meta = ACTION_META[type];
                return (
                  <button
                    key={type}
                    type="button"
                    className={`schedule-action-option ${
                      form.action_type === type ? "selected" : ""
                    }`}
                    onClick={() => set("action_type", type)}
                  >
                    <meta.Icon size={16} />
                    <strong>{meta.label}</strong>
                    <small>{meta.hint}</small>
                  </button>
                );
              })}
            </div>
          </div>

          {(form.action_type === "report" ||
            form.action_type === "chat_message" ||
            form.action_type === "notify") && (
            <label className="field-label">
              {form.action_type === "notify" ? "MESSAGE" : "WHAT TO WRITE"}
              <textarea
                className="schedule-textarea"
                rows={3}
                value={form.prompt}
                onChange={(event) => set("prompt", event.target.value)}
                placeholder={
                  form.action_type === "notify"
                    ? "Stretch and look away from the screen."
                    : "Summarise my day: calendar, open commitments, anything I said I'd do."
                }
              />
            </label>
          )}

          <div className="field-label">
            HOW OFTEN
            <div className="type-switch schedule-recurrence">
              {RECURRENCES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className={form.recurrence === id ? "active" : ""}
                  onClick={() => set("recurrence", id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="schedule-when-row">
            {form.recurrence === "once" ? (
              <label className="field-label">
                WHEN
                <div className="link-input">
                  <input
                    type="datetime-local"
                    value={form.run_at}
                    onChange={(event) => set("run_at", event.target.value)}
                  />
                </div>
              </label>
            ) : form.recurrence === "cron" ? (
              <label className="field-label">
                CRON EXPRESSION
                <div className="link-input">
                  <input
                    value={form.cron_expr}
                    onChange={(event) => set("cron_expr", event.target.value)}
                    placeholder="30 8 * * 1-5"
                  />
                </div>
              </label>
            ) : (
              <label className="field-label">
                AT
                <div className="link-input">
                  <input
                    type="time"
                    value={form.time_of_day}
                    onChange={(event) => set("time_of_day", event.target.value)}
                  />
                </div>
              </label>
            )}

            {form.recurrence === "monthly" && (
              <label className="field-label">
                DAY OF MONTH
                <div className="link-input">
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={form.day_of_month}
                    onChange={(event) =>
                      set("day_of_month", Math.min(31, Math.max(1, Number(event.target.value) || 1)))
                    }
                  />
                </div>
              </label>
            )}
          </div>

          {form.recurrence === "weekly" && (
            <div className="field-label">
              ON THESE DAYS
              <div className="schedule-day-pills">
                {DAYS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    className={form.days.includes(day) ? "selected" : ""}
                    onClick={() => toggleDay(day)}
                    aria-pressed={form.days.includes(day)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  className="schedule-day-preset"
                  onClick={() => set("days", [...WEEKDAYS])}
                >
                  Weekdays
                </button>
              </div>
            </div>
          )}

          <label className="schedule-confirm-row">
            <input
              type="checkbox"
              checked={form.requires_confirmation}
              onChange={(event) => set("requires_confirmation", event.target.checked)}
            />
            <span>
              <strong>Ask me before it acts</strong>
              <small>
                Runs land in your approvals queue instead of happening straight away.
              </small>
            </span>
          </label>

          <p className="schedule-timezone-note">
            Times are in <strong>{browserTimezone()}</strong>.
          </p>

          {formError && (
            <div className="data-banner data-banner-error" role="alert">
              {formError}
            </div>
          )}

          <div className="schedule-form-actions">
            <button className="secondary-button" onClick={() => setShowForm(false)} disabled={saving}>
              Cancel
            </button>
            <button className="primary-button" onClick={submit} disabled={saving}>
              {saving ? <Loader2 size={16} className="schedule-spin" /> : <Check size={16} />}
              {saving ? "Creating…" : "Create schedule"}
            </button>
          </div>
        </section>
      )}

      <section className="glass-card schedule-list-card">
        <div className="illness-history-heading">
          <div>
            <span className="section-kicker">STANDING INSTRUCTIONS</span>
            <h2>Your schedules</h2>
          </div>
          <span>
            {schedules.items.length
              ? `${active.length} active of ${schedules.items.length}`
              : ""}
          </span>
        </div>

        {!schedules.loading && !schedules.items.length && (
          <div className="schedule-empty">
            <CalendarClock size={20} />
            <div>
              <strong>Nothing scheduled yet</strong>
              <p>
                A good first one: a report every weekday at 08:30 that tells you what the day
                holds. Or just ask your assistant for it.
              </p>
            </div>
          </div>
        )}

        <div className="schedule-rows">
          {schedules.items.map((row) => {
            const meta = ACTION_META[row.action_type] ?? ACTION_META.notify;
            const rowRuns = runs[row.id];
            return (
              <article
                key={row.id}
                className={`schedule-row ${row.enabled ? "" : "paused"}`}
              >
                <div className="schedule-row-main">
                  <span className="schedule-row-icon">
                    <meta.Icon size={16} />
                  </span>
                  <div className="schedule-row-text">
                    <strong>{row.name}</strong>
                    <small>{cadence(row)}</small>
                    <span className="schedule-row-meta">
                      {row.enabled ? `Next: ${when(row.next_run_at)}` : "Paused"}
                      {row.last_run_at ? ` · Last: ${when(row.last_run_at)}` : ""}
                      {row.requires_confirmation ? " · asks first" : ""}
                    </span>
                  </div>
                </div>

                <div className="schedule-row-actions">
                  <button
                    type="button"
                    className="icon-button schedule-icon-button"
                    title={row.enabled ? "Pause" : "Resume"}
                    aria-label={row.enabled ? `Pause ${row.name}` : `Resume ${row.name}`}
                    disabled={busyId === row.id}
                    onClick={async () => {
                      setBusyId(row.id);
                      try {
                        await schedules.setEnabled(row, !row.enabled);
                      } catch {
                        /* surfaced by the hook's error banner */
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    {row.enabled ? <Pause size={15} /> : <Play size={15} />}
                  </button>

                  <button
                    type="button"
                    className="icon-button schedule-icon-button"
                    title="Run history"
                    aria-label={`Run history for ${row.name}`}
                    onClick={() => void showRuns(row.id)}
                  >
                    <History size={15} />
                    <ChevronDown
                      size={13}
                      className={openRuns === row.id ? "rotated" : ""}
                    />
                  </button>

                  {confirmDelete === row.id ? (
                    <span className="schedule-delete-confirm">
                      <button
                        type="button"
                        className="icon-button schedule-icon-button danger"
                        aria-label={`Confirm deleting ${row.name}`}
                        onClick={async () => {
                          setBusyId(row.id);
                          try {
                            await schedules.remove(row.id);
                          } catch {
                            /* surfaced by the hook's error banner */
                          } finally {
                            setBusyId(null);
                            setConfirmDelete(null);
                          }
                        }}
                      >
                        <Check size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button schedule-icon-button"
                        aria-label="Keep it"
                        onClick={() => setConfirmDelete(null)}
                      >
                        <X size={15} />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="icon-button schedule-icon-button"
                      title="Delete"
                      aria-label={`Delete ${row.name}`}
                      onClick={() => setConfirmDelete(row.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                {openRuns === row.id && (
                  <div className="schedule-runs">
                    {!rowRuns && <small>Loading runs…</small>}
                    {rowRuns && !rowRuns.length && <small>It hasn’t run yet.</small>}
                    {rowRuns?.map((run) => (
                      <div className={`schedule-run status-${run.status}`} key={run.id}>
                        <span className="schedule-run-dot" aria-hidden="true" />
                        <span className="schedule-run-when">{when(run.ran_at)}</span>
                        <span className="schedule-run-status">
                          {RUN_LABEL[run.status] ?? run.status}
                        </span>
                        {run.detail && <span className="schedule-run-detail">{run.detail}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
