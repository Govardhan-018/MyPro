/**
 * The Calendar: one Month view, with the selected day's schedule beneath it.
 *
 * Day and Week used to be separate views; their jobs now live here — the grid
 * says *which* days are busy (colour-coded dots), and tapping a day lists
 * everything on it in order, with its reminder and quick actions.
 *
 * Everything shown comes from one list (`useAgenda`): calendar events and
 * reminders (one table, `kind`), plus one-off "Remind me" reminders made in
 * Schedules, which can be edited or deleted from here too.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  MapPin,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { Loading } from "../ui";
import {
  ALL_DAY_LEAD_OPTIONS,
  LEAD_OPTIONS,
  dateKeyOf,
  describeEventTime,
  effectiveLead,
  eventActionState,
  eventPhaseOf,
  groupByDate,
  isoDate,
  leadLabel,
  remindAt,
  timeInputValue,
  timeLabel,
  type CalEvent,
  type CalKind,
  type NewEventInput,
} from "../../lib/useCalendar";
import { dayOrder, useAgenda } from "../../lib/useAgenda";
import { buildScheduleInput, formFromRow } from "../../lib/useSchedules";
import type { DeepLinkFocus } from "../../App";

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** Tone → accent colour, used only under Color Mode (monochrome otherwise). */
const TONE_COLORS: Record<string, string> = {
  lavender: "#b69af5",
  mint: "#83d9b0",
  blue: "#71b7f5",
  peach: "#f5b266",
  cyan: "#70dce5",
  coral: "#f28b82",
};
const toneVar = (tone: string) => ({ ["--tone" as string]: TONE_COLORS[tone] ?? "#b69af5" });

/** The sheet's form — one shape for both kinds. */
interface ItemForm {
  kind: CalKind;
  title: string;
  date: string;
  time: string;
  endTime: string;
  allDay: boolean;
  lead: number;
  /** Location for an event, note for a reminder. */
  extra: string;
}

type SheetState =
  | { open: false }
  | { open: true; mode: "create" }
  | { open: true; mode: "edit"; item: CalEvent };

const pad2 = (n: number) => String(n).padStart(2, "0");
const nowTime = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** A new item's default time: the next quarter hour, an hour out, today. */
function defaultTime(now = new Date()): string {
  const at = new Date(now.getTime() + 60 * 60_000);
  at.setMinutes(Math.ceil(at.getMinutes() / 15) * 15, 0, 0);
  return nowTime(at);
}

function blankForm(date: string, kind: CalKind = "reminder"): ItemForm {
  return {
    kind,
    title: "",
    date,
    time: date === isoDate(new Date()) ? defaultTime() : "09:00",
    endTime: "",
    allDay: false,
    lead: kind === "event" ? 60 : 0,
    extra: "",
  };
}

function formFromItem(item: CalEvent): ItemForm {
  return {
    kind: item.kind ?? "event",
    title: item.title,
    date: dateKeyOf(item),
    time: item.allDay ? "09:00" : timeInputValue(item.startsAt),
    endTime: item.allDay ? "" : timeInputValue(item.endsAt),
    allDay: item.allDay,
    lead: effectiveLead(item),
    extra: (item.kind === "reminder" ? item.note : item.location) ?? "",
  };
}

function toInput(form: ItemForm): NewEventInput {
  return {
    kind: form.kind,
    title: form.title,
    date: form.date,
    startTime: form.allDay ? undefined : form.time,
    endTime: form.kind === "event" && !form.allDay ? form.endTime || undefined : undefined,
    allDay: form.allDay,
    location: form.kind === "event" ? form.extra : undefined,
    note: form.kind === "reminder" ? form.extra : undefined,
    leadMinutes: form.lead,
  };
}

const fmtWhen = (d: Date) =>
  d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function CalendarView({ focus }: { focus?: DeepLinkFocus }) {
  const [refDate, setRefDate] = useState(() => new Date());
  const agenda = useAgenda(refDate);
  const { items, loading, error, calendar, schedules } = agenda;
  const todayIso = isoDate(new Date());
  const [selectedIso, setSelectedIso] = useState(todayIso);
  const byDate = useMemo(() => groupByDate(items), [items]);

  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const monthTitle = refDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  /** Page a month; keep the selection inside the month on screen. */
  const shiftMonth = (dir: 1 | -1) => {
    const next = new Date(year, month + dir, 1);
    setRefDate(next);
    const prefix = isoDate(next).slice(0, 7);
    setSelectedIso(todayIso.startsWith(prefix) ? todayIso : isoDate(next));
  };
  const goToday = () => {
    setRefDate(new Date());
    setSelectedIso(todayIso);
  };

  // --- The sheet: Quick Add, edit, or details ------------------------------
  const [sheet, setSheet] = useState<SheetState>({ open: false });
  const [form, setForm] = useState<ItemForm>(() => blankForm(todayIso));
  const [busy, setBusy] = useState<null | "save" | "delete" | "done">(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // The sheet's "now" ticks while open, so an item that starts while you look
    // at it switches to its started state on its own.
    if (!sheet.open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [sheet.open]);

  const openCreate = () => {
    const date = selectedIso < todayIso ? todayIso : selectedIso;
    setForm(blankForm(date));
    setFormError(null);
    setSheet({ open: true, mode: "create" });
  };
  const openItem = (item: CalEvent) => {
    setForm(formFromItem(item));
    setFormError(null);
    setSheet({ open: true, mode: "edit", item });
  };
  const closeSheet = () => {
    if (busy) return;
    setSheet({ open: false });
  };
  const setField = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const editing = sheet.open && sheet.mode === "edit" ? sheet.item : null;
  // Keep the sheet's item in step with the list (e.g. after "Mark done").
  const live = editing ? (items.find((i) => i.id === editing.id) ?? editing) : null;
  const fromSchedule = live?.source === "schedule";
  const scheduleRow = live ? agenda.scheduleFor(live) : undefined;
  const action = live && !fromSchedule ? eventActionState(live, now) : null;
  const phase = live ? eventPhaseOf(live, now) : null;
  const scheduleSent = Boolean(fromSchedule && live && (live.completedAt || new Date(live.startsAt).getTime() <= now));
  const locked = Boolean(live) && (fromSchedule ? scheduleSent : Boolean(action && (!action.editable || action.completed)));

  // --- Validation ----------------------------------------------------------
  const nowDate = new Date(now);
  const isCreate = sheet.open && sheet.mode === "create";
  const isPastDate = isCreate && !!form.date && form.date < todayIso;
  const timeNeeded = !form.allDay;
  const timeMissing = timeNeeded && !form.time;
  const timeInPast =
    timeNeeded && !!form.time && form.date === todayIso && form.time <= nowTime(nowDate) && (isCreate || fromSchedule);
  const endBeforeStart =
    form.kind === "event" && !form.allDay && !!form.endTime && !!form.time && form.endTime <= form.time;
  const validation = isPastDate
    ? "Pick today or a future date."
    : timeInPast
      ? "That time has already passed today."
      : endBeforeStart
        ? "The end time has to be after the start."
        : null;
  const invalid = !form.title.trim() || timeMissing || Boolean(validation);

  /** When the alert will actually fire, for the hint under "Remind before". */
  const alertAt = useMemo(() => {
    if (!form.date || (!form.allDay && !form.time)) return null;
    const startsAt = form.allDay ? `${form.date}T00:00:00.000Z` : new Date(`${form.date}T${form.time}:00`).toISOString();
    return remindAt({ startsAt, allDay: form.allDay, leadMinutes: form.lead, kind: form.kind });
  }, [form.date, form.time, form.allDay, form.lead, form.kind]);
  const leadAlreadyPassed = alertAt !== null && form.lead > 0 && alertAt.getTime() <= now;

  const run = async (kind: "save" | "delete" | "done", work: () => Promise<void>, fallback: string) => {
    setBusy(kind);
    setFormError(null);
    try {
      await work();
      setSheet({ open: false });
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run(
      "save",
      async () => {
        if (fromSchedule && scheduleRow) {
          // A Schedules reminder keeps living in Schedules: rebuild its whole
          // row from the form (PATCH validates the full schedule).
          const base = formFromRow(scheduleRow);
          const built = buildScheduleInput(
            { ...base, text: form.title, date: form.date, time: form.time, repeat: "once" },
            scheduleRow.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          );
          if ("error" in built) throw new Error(built.error);
          await schedules.update(scheduleRow.id, built.input);
        } else if (live) {
          await calendar.updateEvent(live.id, toInput(form));
        } else {
          await calendar.createEvent(toInput(form));
          setSelectedIso(form.date);
        }
      },
      "Could not save that.",
    );

  const remove = (item: CalEvent) =>
    item.source === "schedule" && item.scheduleId
      ? schedules.remove(item.scheduleId)
      : calendar.deleteEvent(item.id);

  const toggleDone = (item: CalEvent) =>
    item.completedAt ? calendar.uncompleteEvent(item.id) : calendar.completeEvent(item.id);

  // --- Deep link: open the item a notification was tapped on ---------------
  const focusHandled = useRef(-1);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!focus?.event || focus.token === focusHandled.current) return;
    focusHandled.current = focus.token;
    const when = focus.at ? new Date(focus.at) : null;
    if (when && !Number.isNaN(when.getTime())) {
      setRefDate(when);
      setSelectedIso(isoDate(when));
    }
    setPendingFocus(focus.event);
  }, [focus]);
  useEffect(() => {
    if (!pendingFocus || loading) return;
    const match = items.find((i) => i.id === pendingFocus || i.scheduleId === pendingFocus);
    if (match) {
      setSelectedIso(dateKeyOf(match));
      openItem(match);
    }
    // Found or not, stop after the first settled load.
    setPendingFocus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loading, pendingFocus]);

  const selectedItems = dayOrder(byDate.get(selectedIso) ?? []);
  const selectedDate = new Date(`${selectedIso}T00:00:00`);
  const leadOptions = form.allDay ? ALL_DAY_LEAD_OPTIONS : LEAD_OPTIONS;
  const leadChoices = leadOptions.some((o) => o.minutes === form.lead)
    ? leadOptions
    : [...leadOptions, { minutes: form.lead, label: leadLabel(form.lead, form.allDay) }];

  return (
    <div className="page-content calendar-view cal-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow muted-eyebrow">CALENDAR</div>
          <h1>{monthTitle}</h1>
        </div>
      </header>

      <div className="cal-toolbar" role="toolbar" aria-label="Calendar navigation">
        <div className="cal-nav">
          <button type="button" className="cal-tool cal-tool-icon" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
            <ArrowLeft size={18} />
          </button>
          <button type="button" className="cal-tool cal-tool-today" onClick={goToday}>
            Today
          </button>
          <button type="button" className="cal-tool cal-tool-icon" aria-label="Next month" onClick={() => shiftMonth(1)}>
            <ArrowRight size={18} />
          </button>
        </div>
        <button type="button" className="cal-tool cal-tool-new" onClick={openCreate}>
          <Plus size={17} /> New
        </button>
      </div>

      {error && (
        <div className="data-banner data-banner-error" role="alert">
          {error}
        </div>
      )}
      {loading && !error && (
        <div className="data-banner" aria-live="polite">
          <Loading variant="inline" size={18} text="Loading your calendar…" />
        </div>
      )}

      <div className="cal-layout">
        <MonthGrid
          year={year}
          month={month}
          byDate={byDate}
          todayIso={todayIso}
          selectedIso={selectedIso}
          onSelect={setSelectedIso}
        />
        <DayPanel
          date={selectedDate}
          isToday={selectedIso === todayIso}
          items={selectedItems}
          onOpen={openItem}
          onAdd={openCreate}
          onDelete={remove}
          onToggleDone={toggleDone}
        />
      </div>

      {sheet.open && (
        <div className="modal-backdrop" onMouseDown={closeSheet}>
          <div
            className="event-modal cal-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={isCreate ? "Quick add" : "Edit item"}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="section-kicker">
                  {isCreate
                    ? "QUICK ADD"
                    : fromSchedule
                      ? "FROM SCHEDULES"
                      : action?.completed
                        ? "COMPLETED"
                        : phase === "live"
                          ? "HAPPENING NOW"
                          : phase === "ended"
                            ? "ENDED"
                            : form.kind === "reminder"
                              ? "EDIT REMINDER"
                              : "EDIT EVENT"}
                </span>
                <h2>
                  {isCreate
                    ? form.kind === "reminder"
                      ? "New reminder"
                      : "New event"
                    : locked
                      ? live?.title || "Item"
                      : form.kind === "reminder"
                        ? "Change this reminder"
                        : "Change this event"}
                </h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={closeSheet}>
                <X size={18} />
              </button>
            </div>

            {locked && live ? (
              <ItemDetails item={live} sent={scheduleSent} action={action} phase={phase} />
            ) : (
              <>
                {!fromSchedule && (
                  <div className="cal-kind-switch" role="radiogroup" aria-label="Type">
                    {(["reminder", "event"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={form.kind === k}
                        className={form.kind === k ? "selected" : ""}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            kind: k,
                            // Switching kind on a fresh form adopts that kind's usual lead.
                            lead: isCreate ? (k === "event" ? 60 : 0) : f.lead,
                          }))
                        }
                      >
                        {k === "reminder" ? <AlarmClock size={15} /> : <CalendarDays size={15} />}
                        {k === "reminder" ? "Reminder" : "Event"}
                      </button>
                    ))}
                  </div>
                )}
                <label className="field-label">
                  TITLE
                  <input
                    value={form.title}
                    onChange={(e) => setField("title", e.target.value)}
                    placeholder={form.kind === "reminder" ? "What should I remind you about?" : "Event title"}
                    autoFocus={isCreate}
                    maxLength={300}
                  />
                </label>
                <div className="field-grid">
                  <label className="field-label">
                    DATE
                    <input
                      type="date"
                      value={form.date}
                      min={isCreate || fromSchedule ? todayIso : undefined}
                      onChange={(e) => setField("date", e.target.value)}
                    />
                  </label>
                  <label className={`field-label ${form.allDay ? "is-disabled" : ""}`}>
                    {form.kind === "event" ? "STARTS" : "TIME"}
                    <input
                      type="time"
                      value={form.allDay ? "" : form.time}
                      disabled={form.allDay}
                      onChange={(e) => setField("time", e.target.value)}
                    />
                  </label>
                </div>
                {!fromSchedule && (
                  <label className="cal-switch-row">
                    <span>
                      <strong>All day</strong>
                      <small>{form.allDay ? "Reminds the morning of, at 9 AM" : "No specific time"}</small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      className="cal-switch"
                      checked={form.allDay}
                      onChange={(e) => {
                        const allDay = e.target.checked;
                        setForm((f) => ({
                          ...f,
                          allDay,
                          // Sub-day leads mean nothing all day: snap to morning-of / day before.
                          lead: allDay ? (f.lead >= 1440 ? 1440 : 0) : f.lead,
                        }));
                      }}
                    />
                  </label>
                )}
                {form.kind === "event" && !form.allDay && (
                  <label className="field-label">
                    ENDS (OPTIONAL)
                    <input
                      type="time"
                      value={form.endTime}
                      min={form.time || undefined}
                      onChange={(e) => setField("endTime", e.target.value)}
                    />
                  </label>
                )}
                {!fromSchedule && (
                  <label className="field-label">
                    REMIND BEFORE
                    <select value={form.lead} onChange={(e) => setField("lead", Number(e.target.value))}>
                      {leadChoices.map((o) => (
                        <option key={o.minutes} value={o.minutes}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!fromSchedule && (
                  <label className="field-label">
                    {form.kind === "event" ? "LOCATION (OPTIONAL)" : "NOTE (OPTIONAL)"}
                    <input
                      value={form.extra}
                      onChange={(e) => setField("extra", e.target.value)}
                      placeholder={form.kind === "event" ? "Where is it?" : "Anything to remember with it"}
                      maxLength={300}
                    />
                  </label>
                )}
                {alertAt && !validation && (
                  <p className={`cal-alert-hint ${leadAlreadyPassed ? "warn" : ""}`}>
                    <Bell size={14} />
                    {leadAlreadyPassed
                      ? "That lead time has already passed — you’ll be alerted at the time itself."
                      : `You’ll be reminded ${fmtWhen(alertAt)}.`}
                  </p>
                )}
                {fromSchedule && (
                  <p className="cal-alert-hint">
                    <AlarmClock size={14} /> Set in Schedules — changes here update it there.
                  </p>
                )}
              </>
            )}

            {validation && !locked && (
              <p className="composer-error" role="alert">
                {validation}
              </p>
            )}
            {formError && <p className="composer-error">{formError}</p>}

            <div className={`modal-footer ${locked ? "event-footer-readonly" : ""}`}>
              {live && (
                <button
                  type="button"
                  className="secondary-button event-delete-button"
                  onClick={() => run("delete", () => remove(live), "Could not delete that.")}
                  disabled={busy !== null}
                  aria-busy={busy === "delete"}
                >
                  <Trash2 size={15} /> {busy === "delete" ? "Deleting…" : "Delete"}
                </button>
              )}
              <button type="button" className="secondary-button" onClick={closeSheet} disabled={busy !== null}>
                {locked ? "Close" : "Cancel"}
              </button>
              {live && action && (action.completed || action.canComplete) && (
                <button
                  type="button"
                  className={`${action.completed ? "secondary-button" : "primary-button"} event-done-button`}
                  onClick={() => run("done", () => toggleDone(live), "Could not update that.")}
                  disabled={busy !== null}
                  aria-busy={busy === "done"}
                >
                  {action.completed ? "Mark not done" : (
                    <>
                      <Check size={15} /> Mark done
                    </>
                  )}
                </button>
              )}
              {!locked && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={save}
                  disabled={busy !== null || invalid}
                  aria-busy={busy === "save"}
                >
                  {busy === "save" ? "Saving…" : live ? "Save changes" : form.kind === "reminder" ? "Add reminder" : "Add event"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function MonthGrid({
  year,
  month,
  byDate,
  todayIso,
  selectedIso,
  onSelect,
}: {
  year: number;
  month: number;
  byDate: Map<string, CalEvent[]>;
  todayIso: string;
  selectedIso: string;
  onSelect: (iso: string) => void;
}) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Only as many rows as the month needs — no trailing blank week.
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;

  return (
    <div className="glass-card cal-month">
      <div className="cal-weekdays" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="cal-grid" role="grid">
        {Array.from({ length: cells }, (_, index) => {
          const dayNum = index - offset + 1;
          if (dayNum < 1 || dayNum > daysInMonth) return <span key={index} className="cal-cell cal-cell-empty" />;
          const date = new Date(year, month, dayNum);
          const iso = isoDate(date);
          const dayItems = dayOrder(byDate.get(iso) ?? []);
          const open = dayItems.filter((i) => !i.completedAt);
          const label = `${date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}${
            dayItems.length ? `, ${dayItems.length} ${dayItems.length === 1 ? "item" : "items"}` : ""
          }`;
          return (
            <button
              type="button"
              key={iso}
              role="gridcell"
              aria-selected={iso === selectedIso}
              aria-label={label}
              className={`cal-cell ${iso === todayIso ? "is-today" : ""} ${iso === selectedIso ? "is-selected" : ""} ${
                iso < todayIso ? "is-past" : ""
              }`}
              onClick={() => onSelect(iso)}
            >
              <span className="cal-day-num">{dayNum}</span>
              <span className="cal-dots" aria-hidden="true">
                {(open.length ? open : dayItems).slice(0, 3).map((item) => (
                  <i
                    key={item.id}
                    className={`cal-dot ${item.kind === "reminder" ? "is-reminder" : ""} ${item.completedAt ? "is-done" : ""}`}
                    style={toneVar(item.tone)}
                  />
                ))}
              </span>
              <span className="cal-cell-titles" aria-hidden="true">
                {dayItems.slice(0, 2).map((item) => (
                  <span key={item.id} className={item.completedAt ? "is-done" : ""} style={toneVar(item.tone)}>
                    {item.title}
                  </span>
                ))}
                {dayItems.length > 2 && <small>+{dayItems.length - 2} more</small>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="cal-legend" aria-hidden="true">
        <span>
          <i className="cal-dot" style={toneVar("lavender")} /> Event
        </span>
        <span>
          <i className="cal-dot is-reminder" style={toneVar("cyan")} /> Reminder
        </span>
      </div>
    </div>
  );
}

function DayPanel({
  date,
  isToday,
  items,
  onOpen,
  onAdd,
  onDelete,
  onToggleDone,
}: {
  date: Date;
  isToday: boolean;
  items: CalEvent[];
  onOpen: (item: CalEvent) => void;
  onAdd: () => void;
  onDelete: (item: CalEvent) => Promise<void>;
  onToggleDone: (item: CalEvent) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  // A pending "Delete?" expires on its own.
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const act = async (item: CalEvent, work: () => Promise<void>) => {
    setWorking(item.id);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn’t work. Try again.");
    } finally {
      setWorking(null);
      setConfirming(null);
    }
  };

  const heading = isToday
    ? "Today"
    : date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <section className="glass-card cal-day" aria-live="polite">
      <div className="cal-day-head">
        <div>
          <span className="section-kicker">{isToday ? date.toLocaleDateString(undefined, { weekday: "long" }).toUpperCase() : "SELECTED DAY"}</span>
          <h2>{heading}</h2>
        </div>
        <span className="cal-day-count">
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <button type="button" className="cal-day-empty" onClick={onAdd}>
          <span>Nothing scheduled.</span>
          <strong>
            <Plus size={15} /> Add a reminder or event
          </strong>
        </button>
      ) : (
        <ul className="cal-day-list">
          {items.map((item) => {
            const state = item.source === "schedule" ? null : eventActionState(item, now);
            const canToggle = Boolean(state && (state.completed || state.canComplete));
            const lead = effectiveLead(item);
            const extra = item.kind === "reminder" ? item.note : item.location;
            const busy = working === item.id;
            return (
              <li
                key={item.id}
                className={`cal-item ${item.completedAt ? "is-done" : ""} ${item.kind === "reminder" ? "is-reminder" : ""}`}
                style={toneVar(item.tone)}
              >
                <button type="button" className="cal-item-main" onClick={() => onOpen(item)}>
                  <time className="cal-item-time">
                    {item.allDay ? (
                      <strong>All day</strong>
                    ) : (
                      <>
                        <strong>{timeLabel(item.startsAt).replace(/\s?[AP]M$/i, "")}</strong>
                        <span>{(timeLabel(item.startsAt).match(/[AP]M$/i) ?? [""])[0]}</span>
                      </>
                    )}
                  </time>
                  <span className="cal-item-body">
                    <strong>
                      {item.completedAt ? <Check size={13} className="event-done-tick" /> : null}
                      {item.title}
                    </strong>
                    <span className="cal-item-meta">
                      <span className={`cal-badge ${item.kind === "reminder" ? "is-reminder" : ""}`}>
                        {item.kind === "reminder" ? "Reminder" : "Event"}
                      </span>
                      {item.source === "schedule" && <span className="cal-badge is-source">Schedules</span>}
                      {item.paused && <span className="cal-badge is-source">Paused</span>}
                      <span className="cal-lead">
                        <Bell size={12} /> {leadLabel(lead, item.allDay)}
                      </span>
                    </span>
                    {extra && (
                      <span className="cal-item-extra">
                        {item.kind === "reminder" ? <StickyNote size={12} /> : <MapPin size={12} />} {extra}
                      </span>
                    )}
                  </span>
                </button>
                <span className="cal-item-actions">
                  {canToggle && (
                    <button
                      type="button"
                      className={`cal-action ${item.completedAt ? "is-on" : ""}`}
                      aria-label={item.completedAt ? "Mark not done" : "Mark done"}
                      aria-pressed={Boolean(item.completedAt)}
                      disabled={busy}
                      onClick={() => act(item, () => onToggleDone(item))}
                    >
                      <Check size={16} />
                    </button>
                  )}
                  {confirming === item.id ? (
                    <button
                      type="button"
                      className="cal-action cal-action-confirm"
                      disabled={busy}
                      onClick={() => act(item, () => onDelete(item))}
                    >
                      {busy ? "…" : "Delete?"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="cal-action"
                      aria-label={`Delete ${item.title}`}
                      disabled={busy}
                      onClick={() => setConfirming(item.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                  {!canToggle && confirming !== item.id && (
                    <ChevronRight size={16} className="cal-item-chevron" aria-hidden="true" />
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ItemDetails({
  item,
  sent,
  action,
  phase,
}: {
  item: CalEvent;
  sent: boolean;
  action: ReturnType<typeof eventActionState> | null;
  phase: ReturnType<typeof eventPhaseOf> | null;
}) {
  const lead = effectiveLead(item);
  const fires = remindAt(item);
  return (
    <div className="event-details">
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{item.kind === "reminder" ? "Reminder" : "Event"}{item.source === "schedule" ? " · from Schedules" : ""}</dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{describeEventTime(item)}</dd>
        </div>
        <div>
          <dt>Alert</dt>
          <dd>
            {leadLabel(lead, item.allDay)}
            {fires ? ` · ${fmtWhen(fires)}` : ""}
          </dd>
        </div>
        {item.location && (
          <div>
            <dt>Where</dt>
            <dd>{item.location}</dd>
          </div>
        )}
        {item.note && (
          <div>
            <dt>Note</dt>
            <dd>{item.note}</dd>
          </div>
        )}
        <div>
          <dt>Status</dt>
          <dd>
            <span
              className={`event-status-pill ${
                action?.completed || sent ? "done" : phase === "live" ? "live" : "past"
              }`}
            >
              {action?.completed || sent ? <Check size={13} /> : null}
              {sent
                ? "Sent"
                : action?.completed
                  ? `Done${item.completedAt ? ` · ${new Date(item.completedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}`
                  : phase === "live"
                    ? "In progress"
                    : "Ended"}
            </span>
          </dd>
        </div>
      </dl>
      <p className="event-state-note">
        {sent
          ? "This reminder has gone off. You can delete it."
          : action?.completed
            ? "Marked done. Unmark it if that was a mistake."
            : action?.canComplete
              ? "This has started, so its details are locked. Mark it done when you’ve finished, or delete it."
              : action?.completionMissed
                ? "The window to mark this done has passed. You can still delete it."
                : "This has started, so its details are locked. You can delete it."}
      </p>
    </div>
  );
}
