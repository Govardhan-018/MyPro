/**
 * Schedules — three things, at a time you choose:
 *
 *  1. **Remind me** — a notification with your words (fired by the phone's own
 *     alarm clock in the app, so it arrives with the app closed).
 *  2. **AI message** — the AI carries out your instructions at that moment and
 *     replies in your chat; a notification says it's done.
 *  3. **Email** — the AI writes the email from your instructions and sends it
 *     from your connected Gmail. Only offered once Gmail can send.
 *
 * Mobile first: one column, only the fields the chosen mode needs, native
 * date and time pickers, and every field scrolled into view above the keyboard.
 */
import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { Loading } from "../ui";
import {
  Bell,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  History,
  Mail,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import type { ScheduleRow } from "@mypro/shared";
import {
  buildScheduleInput,
  emptyScheduleForm,
  formFromRow,
  isFormEditable,
  useSchedules,
  type ScheduleForm,
  type ScheduleMode,
  type ScheduleRunRow,
} from "../../lib/useSchedules";
import { useGmail } from "../../lib/useGmail";
import { gmailScopesGrantSend } from "../../lib/api";
import { inShell } from "../../lib/shell";
import { useShellNotifications } from "../../lib/useShellNotifications";

const MODES: {
  id: ScheduleMode;
  label: string;
  hint: string;
  Icon: typeof Bell;
}[] = [
  { id: "notify", label: "Remind me", hint: "A notification at that time", Icon: Bell },
  { id: "chat_message", label: "AI message", hint: "The AI does it and replies in chat", Icon: Bot },
  { id: "email", label: "Email", hint: "The AI writes and sends it", Icon: Mail },
];

const TYPE_META: Record<ScheduleRow["action_type"], { label: string; Icon: typeof Bell }> = {
  notify: { label: "Reminder", Icon: Bell },
  chat_message: { label: "AI message", Icon: Bot },
  email: { label: "Email", Icon: Mail },
  report: { label: "Brief", Icon: CalendarClock },
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];

const RUN_LABEL: Record<string, string> = {
  success: "Done",
  failed: "Failed",
  skipped: "Missed",
  pending_confirmation: "Waiting for approval",
  deferred: "Retrying",
  retrying: "Retrying",
};

const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** "Thu 15 Nov, 08:30" — short, local, no library. */
function when(iso: string | null | undefined): string {
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
      const weekdaysOnly = days.length === 5 && WEEKDAYS.every((day) => days.includes(day));
      return `${weekdaysOnly ? "Weekdays" : days.map((d) => DAYS[d]).join(", ") || "No days"} at ${time}`;
    }
    case "monthly":
      return `Day ${row.day_of_month} of each month at ${time}`;
    case "once":
      return when(row.run_at);
    case "cron":
      return `Cron: ${row.cron_expr}`;
    default:
      return "—";
  }
}

/** What the row is about, in the user's own words. */
function summary(row: ScheduleRow): string {
  const p = row.action_payload ?? {};
  const text = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  if (row.action_type === "notify") return text("body") || text("text") || text("prompt") || row.name;
  if (row.action_type === "email") return text("prompt");
  return text("prompt") || text("text") || row.name;
}

/** The status chip: what happened last, or what will happen next. */
function status(row: ScheduleRow): { label: string; tone: string; detail?: string | null } {
  const last = row.last_run;
  if ((row.deferred_count ?? 0) > 0 && row.enabled) {
    return { label: `Retrying · ${when(row.next_run_at)}`, tone: "warn", detail: last?.detail };
  }
  if (row.enabled && row.next_run_at) {
    if (last?.status === "failed") return { label: "Last run failed", tone: "bad", detail: last.detail };
    return { label: "Scheduled", tone: "ok" };
  }
  if (!last) {
    if (row.enabled) return { label: "Scheduled", tone: "ok" };
    return { label: row.recurrence === "once" ? "Cancelled" : "Paused", tone: "muted" };
  }
  const tone =
    last.status === "success" ? "ok" : last.status === "failed" ? "bad" : last.status === "skipped" ? "muted" : "warn";
  if (!row.enabled && row.recurrence !== "once") return { label: "Paused", tone: "muted" };
  return { label: RUN_LABEL[last.status] ?? last.status, tone, detail: last.status === "success" ? null : last.detail };
}

/** Keep a focused field visible above the on-screen keyboard. */
const keepInView = (event: FocusEvent<HTMLElement>) => {
  const el = event.currentTarget;
  window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
};

export function SchedulesView({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const schedules = useSchedules(true);
  const gmail = useGmail(true);
  const canEmail = gmail.accounts.some((account) => gmailScopesGrantSend(account.scopes));
  // In the app, reminders are the phone's own notifications: say so plainly
  // when Android is blocking them, rather than letting a reminder vanish.
  const phone = useShellNotifications(inShell);
  const phoneBlocked = inShell && phone.status !== null && phone.status.permission !== "granted";

  const [editing, setEditing] = useState<ScheduleRow | "new" | null>(null);
  const [form, setForm] = useState<ScheduleForm>(() => emptyScheduleForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<{ field?: string; message: string } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [openRuns, setOpenRuns] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, ScheduleRunRow[] | "error">>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const formRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 4000);
    return () => window.clearTimeout(timer);
  }, [success]);

  const set = <K extends keyof ScheduleForm>(key: K, value: ScheduleForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (formError?.field === key || (formError?.field === "when" && (key === "date" || key === "time"))) {
      setFormError(null);
    }
  };

  const openNew = () => {
    setForm(emptyScheduleForm());
    setFormError(null);
    setEditing("new");
    window.setTimeout(() => formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  };
  const openEdit = (row: ScheduleRow) => {
    setForm(formFromRow(row));
    setFormError(null);
    setEditing(row);
    window.setTimeout(() => formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  };
  const close = () => {
    setEditing(null);
    setFormError(null);
  };

  const toggleDay = (day: number) =>
    set(
      "days",
      form.days.includes(day) ? form.days.filter((d) => d !== day) : [...form.days, day].sort((a, b) => a - b),
    );

  const submit = async () => {
    if (saving) return;
    if (form.mode === "email" && !canEmail) {
      setFormError({ message: "Connect Gmail with send access first (Settings → Mail)." });
      return;
    }
    const built = buildScheduleInput(form, browserTimezone());
    if ("error" in built) {
      setFormError({ field: built.field, message: built.error });
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing && editing !== "new") await schedules.update(editing.id, built.input);
      else await schedules.create(built.input);
      setSuccess(editing && editing !== "new" ? "Schedule updated." : "Scheduled.");
      setEditing(null);
    } catch (caught) {
      setFormError({
        message: caught instanceof Error ? caught.message : "Could not save that schedule.",
      });
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
    try {
      const rows = await schedules.runs(id);
      setRuns((current) => ({ ...current, [id]: rows }));
    } catch {
      setRuns((current) => ({ ...current, [id]: "error" }));
    }
  };

  const sorted = useMemo(
    () =>
      [...schedules.items].sort((a, b) => {
        // Upcoming first (soonest on top), then finished/paused, newest last run first.
        const an = a.enabled && a.next_run_at ? Date.parse(a.next_run_at) : Infinity;
        const bn = b.enabled && b.next_run_at ? Date.parse(b.next_run_at) : Infinity;
        if (an !== bn) return an - bn;
        return Date.parse(b.last_run_at ?? "0") - Date.parse(a.last_run_at ?? "0");
      }),
    [schedules.items],
  );
  const activeCount = schedules.items.filter((row) => row.enabled).length;
  const isEdit = Boolean(editing && editing !== "new");

  return (
    <div className="page-content foundation-view schedules-view sched">
      <header className="page-heading sched-heading">
        <div>
          <div className="eyebrow muted-eyebrow">SCHEDULES</div>
          <h1>Later, handled.</h1>
          <p>A reminder, an AI task or an email — at the time you pick.</p>
        </div>
        {!editing && (
          <button className="primary-button sched-new" onClick={openNew} disabled={!schedules.configured}>
            <Plus size={17} />
            New
          </button>
        )}
      </header>

      {!schedules.configured && (
        <div className="data-banner" role="status">
          Schedules need the backend configured — set VITE_API_URL.
        </div>
      )}
      {schedules.error && !editing && (
        <div className="data-banner data-banner-error" role="alert">
          {schedules.error}
          <button type="button" className="sched-link" onClick={schedules.reload}>
            Try again
          </button>
        </div>
      )}
      {phoneBlocked && (
        <div className="data-banner data-banner-error" role="alert">
          Notifications are turned off for MyPro on this phone, so reminders can’t appear.
          <button type="button" className="sched-link" onClick={phone.fix}>
            {phone.status?.canAskAgain ? "Allow notifications" : "Open Android settings"}
          </button>
        </div>
      )}
      {!phoneBlocked && phone.status?.lastArm?.error && (
        <div className="data-banner data-banner-error" role="alert">
          {phone.status.lastArm.error}
        </div>
      )}
      {success && (
        <div className="data-banner sched-success" role="status">
          <Check size={15} /> {success}
        </div>
      )}

      {editing && (
        <section className="glass-card sched-form" ref={formRef} aria-label={isEdit ? "Edit schedule" : "New schedule"}>
          <div className="sched-form-head">
            <h2>{isEdit ? "Edit schedule" : "New schedule"}</h2>
            <button type="button" className="icon-button" aria-label="Close" onClick={close} disabled={saving}>
              <X size={17} />
            </button>
          </div>

          <div className="sched-modes" role="radiogroup" aria-label="What should happen">
            {MODES.map((mode) => {
              const locked = mode.id === "email" && !canEmail;
              const selected = form.mode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-disabled={locked}
                  className={`sched-mode ${selected ? "selected" : ""} ${locked ? "locked" : ""}`}
                  disabled={isEdit && !selected}
                  onClick={() => {
                    if (locked) {
                      setFormError({ message: "Email needs Gmail connected with send access." });
                      return;
                    }
                    set("mode", mode.id);
                    setFormError(null);
                  }}
                >
                  <mode.Icon size={18} />
                  <strong>{mode.label}</strong>
                  <small>{locked ? (gmail.loading ? "Checking Gmail…" : "Connect Gmail first") : mode.hint}</small>
                </button>
              );
            })}
          </div>

          {form.mode === "email" && !canEmail && !gmail.loading && (
            <div className="data-banner sched-inline-banner" role="status">
              Email schedules send from your Gmail, which isn’t connected with send access yet.
              {onOpenSettings && (
                <button type="button" className="sched-link" onClick={onOpenSettings}>
                  Open Settings → Mail
                </button>
              )}
            </div>
          )}

          {form.mode === "email" && (
            <label className={`sched-field ${formError?.field === "to" ? "invalid" : ""}`}>
              <span>Send to</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="name@example.com"
                value={form.to}
                onChange={(event) => set("to", event.target.value)}
                onFocus={keepInView}
                aria-invalid={formError?.field === "to"}
              />
            </label>
          )}

          <label className={`sched-field ${formError?.field === "text" ? "invalid" : ""}`}>
            <span>
              {form.mode === "notify"
                ? "Remind me to…"
                : form.mode === "chat_message"
                  ? "What should the AI do?"
                  : "What should the email say?"}
            </span>
            <textarea
              rows={form.mode === "notify" ? 2 : 3}
              maxLength={2000}
              value={form.text}
              onChange={(event) => set("text", event.target.value)}
              onFocus={keepInView}
              aria-invalid={formError?.field === "text"}
              placeholder={
                form.mode === "notify"
                  ? "Call the dentist"
                  : form.mode === "chat_message"
                    ? "Summarise today's top tech news in five bullets"
                    : "Thank Priya for the interview and ask about next steps"
              }
            />
          </label>

          <div className="sched-field">
            <span>Repeat</span>
            <div className="sched-segment" role="radiogroup" aria-label="Repeat">
              {(
                [
                  ["once", "Once"],
                  ["daily", "Daily"],
                  ["weekly", "Weekly"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={form.repeat === id}
                  className={form.repeat === id ? "selected" : ""}
                  onClick={() => set("repeat", id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={`sched-when ${form.repeat === "once" ? "" : "time-only"}`}>
            {form.repeat === "once" && (
              <label className={`sched-field ${formError?.field === "when" ? "invalid" : ""}`}>
                <span>Date</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => set("date", event.target.value)}
                  aria-invalid={formError?.field === "when"}
                />
              </label>
            )}
            <label className={`sched-field ${formError?.field === "when" ? "invalid" : ""}`}>
              <span>Time</span>
              <input
                type="time"
                value={form.time}
                onChange={(event) => set("time", event.target.value)}
                aria-invalid={formError?.field === "when"}
              />
            </label>
          </div>

          {form.repeat === "weekly" && (
            <div className={`sched-field ${formError?.field === "days" ? "invalid" : ""}`}>
              <span>On</span>
              <div className="sched-days">
                {DAYS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    className={form.days.includes(day) ? "selected" : ""}
                    onClick={() => toggleDay(day)}
                    aria-pressed={form.days.includes(day)}
                    aria-label={label}
                  >
                    {label.slice(0, 2)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {form.mode === "email" && (
            <label className="sched-check">
              <input
                type="checkbox"
                checked={form.askFirst}
                onChange={(event) => set("askFirst", event.target.checked)}
              />
              <span>
                <strong>Let me approve it first</strong>
                <small>The AI drafts it at that time and waits in your approvals instead of sending.</small>
              </span>
            </label>
          )}

          <p className="sched-note">
            Times are in {browserTimezone()}.
            {form.mode === "chat_message" && " The reply appears in your AI chat and you’ll get a notification."}
            {form.mode === "email" && canEmail && " Sent from your connected Gmail."}
          </p>

          {formError && (
            <div className="data-banner data-banner-error" role="alert">
              {formError.message}
            </div>
          )}

          <div className="sched-actions">
            <button className="secondary-button" onClick={close} disabled={saving}>
              Cancel
            </button>
            <button
              className="primary-button"
              onClick={submit}
              disabled={saving || (form.mode === "email" && !canEmail)}
            >
              {saving ? <Loading variant="inline" size={16} /> : <Check size={16} />}
              {saving ? "Saving…" : isEdit ? "Save" : "Schedule"}
            </button>
          </div>
        </section>
      )}

      <section className="glass-card sched-list" aria-busy={schedules.loading}>
        <div className="sched-list-head">
          <h2>Your schedules</h2>
          {schedules.items.length > 0 && (
            <span>
              {activeCount} upcoming
              <button
                type="button"
                className="icon-button sched-refresh"
                aria-label="Refresh"
                onClick={schedules.reload}
              >
                <RotateCw size={14} />
              </button>
            </span>
          )}
        </div>

        {schedules.loading && (
          <div className="sched-empty" aria-live="polite">
            <Loading variant="inline" size={18} text="Loading your schedules…" />
          </div>
        )}

        {!schedules.loading && !schedules.error && !schedules.items.length && (
          <div className="sched-empty">
            <CalendarClock size={20} />
            <div>
              <strong>Nothing scheduled yet</strong>
              <p>Set a reminder, have the AI do something later, or schedule an email.</p>
              {!editing && schedules.configured && (
                <button type="button" className="secondary-button" onClick={openNew}>
                  <Plus size={15} /> New schedule
                </button>
              )}
            </div>
          </div>
        )}

        <ul className="sched-rows">
          {sorted.map((row) => {
            const meta = TYPE_META[row.action_type] ?? TYPE_META.notify;
            const chip = status(row);
            const rowRuns = runs[row.id];
            const busy = busyId === row.id;
            const finishedOnce = row.recurrence === "once" && !row.next_run_at;
            return (
              <li key={row.id} className={`sched-row ${row.enabled ? "" : "paused"}`}>
                <div className="sched-row-top">
                  <span className={`sched-type type-${row.action_type}`}>
                    <meta.Icon size={13} />
                    {meta.label}
                  </span>
                  <span className={`sched-chip tone-${chip.tone}`}>{chip.label}</span>
                </div>
                <p className="sched-row-text">{summary(row)}</p>
                <div className="sched-row-meta">
                  <span>
                    {row.recurrence === "once" ? (finishedOnce ? `Was ${cadence(row)}` : cadence(row)) : cadence(row)}
                  </span>
                  {row.recurrence !== "once" && row.enabled && row.next_run_at && (
                    <span>Next {when(row.next_run_at)}</span>
                  )}
                  {row.action_type === "email" && typeof row.action_payload?.to === "string" && (
                    <span>To {row.action_payload.to as string}</span>
                  )}
                </div>
                {chip.detail && <p className="sched-row-detail">{chip.detail}</p>}

                <div className="sched-row-actions">
                  {isFormEditable(row) && (
                    <button type="button" className="sched-action" onClick={() => openEdit(row)} disabled={busy}>
                      <Pencil size={14} /> {finishedOnce ? "Reschedule" : "Edit"}
                    </button>
                  )}
                  {!finishedOnce && (
                    <button
                      type="button"
                      className="sched-action"
                      disabled={busy}
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
                      {row.enabled ? <Pause size={14} /> : <Play size={14} />}
                      {row.enabled ? (row.recurrence === "once" ? "Cancel" : "Pause") : "Resume"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="sched-action"
                    aria-expanded={openRuns === row.id}
                    onClick={() => void showRuns(row.id)}
                  >
                    <History size={14} /> History
                    <ChevronDown size={13} className={openRuns === row.id ? "rotated" : ""} />
                  </button>
                  {confirmDelete === row.id ? (
                    <span className="sched-confirm">
                      <button
                        type="button"
                        className="sched-action danger"
                        disabled={busy}
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
                        {busy ? <Loading variant="inline" size={13} /> : <Trash2 size={14} />} Delete
                      </button>
                      <button type="button" className="sched-action" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="sched-action"
                      aria-label={`Delete ${row.name}`}
                      onClick={() => setConfirmDelete(row.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {openRuns === row.id && (
                  <div className="sched-runs">
                    {!rowRuns && <Loading variant="inline" size={14} text="Loading…" />}
                    {rowRuns === "error" && <small>Could not load the history.</small>}
                    {Array.isArray(rowRuns) && !rowRuns.length && <small>It hasn’t run yet.</small>}
                    {Array.isArray(rowRuns) &&
                      rowRuns.map((run) => (
                        <div className={`sched-run status-${run.status}`} key={run.id}>
                          <span className="sched-run-dot" aria-hidden="true" />
                          <span className="sched-run-when">{when(run.ran_at)}</span>
                          <span className="sched-run-status">{RUN_LABEL[run.status] ?? run.status}</span>
                          {(run.detail || run.result) && (
                            <span className="sched-run-detail">
                              {[run.result, run.detail].filter(Boolean).join(" — ")}
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
