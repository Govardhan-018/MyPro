/**
 * Calendar — the web app's calendar at phone width.
 *
 * The browser swaps its week grid for a different layout below 760px, and
 * this is that layout: the Day / Week / Month segmented control, a five-day
 * strip of tall day buttons for Day and Week, the month grid with its event
 * dots for Month, and the agenda beneath either one as `.mobile-agenda-event`
 * rows.
 *
 * Creating, editing and deleting all go through the same `/calendar/events`
 * endpoints the web uses, with the same payload.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { client } from '../lib/client';
import {
  Card, DashedNote, DataBanner, FadeIn, GhostButton, Loading, PrimaryButton, Segmented,
  Sheet, ToggleRow, useToast,
} from '../components/ui';
import { colors, radius, shared, space, type, useTheme } from '../theme';

interface EventItem {
  id: string;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
}

type Mode = 'Day' | 'Week' | 'Month';

function keyOfDate(d: Date): string {
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Local date key — never `toISOString().slice(0, 10)`.
 *
 * That takes the **UTC** date, which is a different day for most of the
 * evening east of Greenwich: a 02:00 event on the 16th is stored as
 * `…T20:30:00Z` on the 15th and lands under the wrong heading. The web app
 * shipped exactly that bug; this is the same fix (`dateKeyOf`).
 */
function dateKeyOf(iso: string, allDay: boolean): string {
  if (allDay) return iso.slice(0, 10); // stored as a plain date, no zone to shift
  return keyOfDate(new Date(iso));
}

function dateOfKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

const timeLabel = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';

/** `.month-weekdays span` — Monday first, as the web's grid is. */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_INITIALS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

interface Draft {
  id: string | null;
  dateKey: string;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  start: string;
  end: string;
}

export function CalendarScreen() {
  const toast = useToast();
  const { accent, colorMode } = useTheme();
  const [mode, setMode] = useState<Mode>('Day');
  const [refDate, setRefDate] = useState(() => new Date());
  const [selectedKey, setSelectedKey] = useState(() => keyOfDate(new Date()));
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * A month either side of the reference date, so moving between days and
   * weeks does not refetch on every tap.
   */
  const windowKey = `${refDate.getFullYear()}-${refDate.getMonth()}`;
  const load = useCallback(async () => {
    setError(null);
    const anchor = new Date(refDate);
    const from = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 2, 0);
    try {
      const rows = await client.api.calendar.events({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      setEvents(
        rows.map((row) => ({
          id: String(row.id),
          title: typeof row.title === 'string' ? row.title : 'Untitled',
          description: typeof row.description === 'string' ? row.description : null,
          startsAt: typeof row.starts_at === 'string' ? row.starts_at : null,
          endsAt: typeof row.ends_at === 'string' ? row.ends_at : null,
          allDay: row.all_day === true,
          location: typeof row.location === 'string' ? row.location : null,
        })),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your calendar.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // `windowKey` rather than `refDate`: only a change of month refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const event of events) {
      if (!event.startsAt) continue;
      const key = dateKeyOf(event.startsAt, event.allDay);
      const bucket = map.get(key);
      if (bucket) bucket.push(event);
      else map.set(key, [event]);
    }
    for (const bucket of map.values()) {
      // All-day events sit above the timed ones, as they do on the web.
      bucket.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return (a.startsAt ?? '').localeCompare(b.startsAt ?? '');
      });
    }
    return map;
  }, [events]);

  const todayKey = keyOfDate(new Date());
  const selectedDate = useMemo(() => dateOfKey(selectedKey), [selectedKey]);
  const selectedEvents = byDay.get(selectedKey) ?? [];

  /** The five-day strip: the selected day with two either side. */
  const strip = useMemo(() => {
    const days: Date[] = [];
    for (let offset = -2; offset <= 2; offset++) {
      const date = new Date(selectedDate);
      date.setDate(date.getDate() + offset);
      days.push(date);
    }
    return days;
  }, [selectedDate]);

  /** The month grid: leading blanks (Monday first) then the days. */
  const grid = useMemo(() => {
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let day = 1; day <= count; day++) cells.push(new Date(year, month, day));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [refDate]);

  /** The web's heading, per mode. */
  const headingTitle = useMemo(() => {
    if (mode === 'Day') {
      return selectedDate.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
    }
    if (mode === 'Week') {
      const first = strip[0];
      const last = strip[strip.length - 1];
      return `${first.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })} - ${last.toLocaleDateString(undefined, { day: 'numeric' })}`;
    }
    return refDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }, [mode, selectedDate, strip, refDate]);

  const shift = (direction: number) => {
    if (mode === 'Month') {
      setRefDate(new Date(refDate.getFullYear(), refDate.getMonth() + direction, 1));
      return;
    }
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + (mode === 'Week' ? 7 : 1) * direction);
    setSelectedKey(keyOfDate(next));
    setRefDate(next);
  };

  const goToday = () => {
    const now = new Date();
    setSelectedKey(keyOfDate(now));
    setRefDate(now);
  };

  const openCreate = () => {
    setDraft({
      id: null,
      dateKey: selectedKey,
      title: '',
      description: '',
      location: '',
      allDay: false,
      start: '09:00',
      end: '',
    });
  };

  const openEdit = (event: EventItem) => {
    const hhmm = (iso: string | null) => {
      if (!iso) return '';
      const d = new Date(iso);
      return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
    };
    setDraft({
      id: event.id,
      dateKey: event.startsAt ? dateKeyOf(event.startsAt, event.allDay) : selectedKey,
      title: event.title,
      description: event.description ?? '',
      location: event.location ?? '',
      allDay: event.allDay,
      start: event.allDay ? '09:00' : hhmm(event.startsAt) || '09:00',
      end: event.allDay ? '' : hhmm(event.endsAt),
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) {
      toast.show('Give the event a title.');
      return;
    }
    if (!draft.allDay && !TIME_RE.test(draft.start)) {
      toast.show('Start time should look like 14:30.');
      return;
    }
    if (!draft.allDay && draft.end && !TIME_RE.test(draft.end)) {
      toast.show('End time should look like 15:30.');
      return;
    }

    const base = dateOfKey(draft.dateKey);
    const at = (hhmm: string): string => {
      const [h, m] = hhmm.split(':').map(Number);
      const d = new Date(base);
      d.setHours(h ?? 0, m ?? 0, 0, 0);
      return d.toISOString();
    };

    const body: Record<string, unknown> = {
      title,
      starts_at: draft.allDay
        ? new Date(new Date(base).setHours(0, 0, 0, 0)).toISOString()
        : at(draft.start),
      all_day: draft.allDay,
    };
    if (draft.description.trim()) body.description = draft.description.trim();
    if (draft.location.trim()) body.location = draft.location.trim();
    if (!draft.allDay && draft.end) body.ends_at = at(draft.end);

    setSaving(true);
    try {
      if (draft.id) await client.api.calendar.updateEvent(draft.id, body);
      else await client.api.calendar.createEvent(body);
      setDraft(null);
      toast.show(draft.id ? 'Event updated' : 'Event added');
      await load();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Could not save the event.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!draft?.id) return;
    const id = draft.id;
    const name = draft.title;
    Alert.alert('Delete event?', `"${name}" will be removed. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDraft(null);
          try {
            await client.api.calendar.deleteEvent(id);
            toast.show('Event deleted');
            await load();
          } catch {
            toast.show('Could not delete that.');
          }
        },
      },
    ]);
  };

  if (loading) return <Loading />;

  const agendaRows = (
    <View style={{ gap: 10 }}>
      {selectedEvents.map((event) => (
        <AgendaEventRow
          key={event.id}
          event={event}
          accent={colorMode ? accent : colors.text}
          onPress={() => openEdit(event)}
        />
      ))}
    </View>
  );

  return (
    <View style={shared.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: 22,
          paddingBottom: 28,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.textMuted}
          />
        }
      >
        {/* `.calendar-heading` — stacked on mobile. */}
        <FadeIn index={0} style={{ marginBottom: 20 }}>
          <Text style={type.eyebrow}>Calendar</Text>
          <Text style={[type.h1, { marginTop: 6, marginBottom: 14 }]}>{headingTitle}</Text>

          {/* `.calendar-actions` — the segmented control spans the row, the
              rest sits beneath it. */}
          <Segmented<Mode>
            options={[
              { key: 'Day', label: 'Day' },
              { key: 'Week', label: 'Week' },
              { key: 'Month', label: 'Month' },
            ]}
            value={mode}
            onChange={setMode}
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Pressable
              onPress={goToday}
              accessibilityRole="button"
              accessibilityLabel="Go to today"
              style={[shared.ghostButton, { height: 44, paddingHorizontal: 16 }]}
            >
              <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: '600' }}>Today</Text>
            </Pressable>
            <IconSquare
              icon="arrow-back"
              label={`Previous ${mode.toLowerCase()}`}
              onPress={() => shift(-1)}
            />
            <IconSquare
              icon="arrow-forward"
              label={`Next ${mode.toLowerCase()}`}
              onPress={() => shift(1)}
            />
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={openCreate}
              accessibilityRole="button"
              accessibilityLabel="New event"
              style={{
                height: 44,
                paddingHorizontal: 18,
                borderRadius: radius.md,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: colorMode ? accent : colors.text,
              }}
            >
              <Ionicons name="add" size={17} color="#000000" />
              <Text style={{ color: '#000000', fontSize: 13.5, fontWeight: '700' }}>New</Text>
            </Pressable>
          </View>
        </FadeIn>

        {!!error && <DataBanner message={error} error />}

        {mode === 'Month' ? (
          <FadeIn index={1}>
            <Card style={{ paddingHorizontal: 8, paddingTop: 8, paddingBottom: 0 }}>
              {/* `.month-weekdays` */}
              <View style={{ flexDirection: 'row', height: 34, alignItems: 'center' }}>
                {WEEKDAYS.map((day, index) => (
                  <Text
                    key={`${day}-${index}`}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      color: colors.textFaint,
                      fontSize: 10,
                      letterSpacing: 0.4,
                    }}
                  >
                    {day}
                  </Text>
                ))}
              </View>

              {/* `.month-grid` — 54px rows, a 36px day disc, 5px event dots. */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {grid.map((date, index) => {
                  if (!date) {
                    return (
                      <View key={`blank-${index}`} style={{ width: '14.285%', height: 54 }} />
                    );
                  }
                  const key = keyOfDate(date);
                  const isToday = key === todayKey;
                  const isSelected = key === selectedKey;
                  const dayEvents = byDay.get(key) ?? [];
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setSelectedKey(key)}
                      accessibilityRole="button"
                      accessibilityLabel={date.toDateString()}
                      accessibilityState={{ selected: isSelected }}
                      style={{
                        width: '14.285%',
                        height: 54,
                        paddingTop: 5,
                        alignItems: 'center',
                      }}
                    >
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: isSelected && !isToday
                            ? colorMode
                              ? colors.violetLine
                              : 'rgba(255,255,255,0.55)'
                            : 'transparent',
                          backgroundColor: isToday
                            ? colorMode
                              ? accent
                              : colors.text
                            : isSelected
                              ? colorMode
                                ? 'rgba(145,104,220,0.12)'
                                : 'rgba(255,255,255,0.06)'
                              : 'transparent',
                        }}
                      >
                        <Text
                          style={{
                            color: isToday ? '#000000' : colors.text,
                            fontSize: 15,
                            fontWeight: isToday ? '700' : '500',
                          }}
                        >
                          {date.getDate()}
                        </Text>
                      </View>
                      {/* `.month-day-events` — up to three dots. */}
                      <View style={{ flexDirection: 'row', gap: 3, height: 6, marginTop: 4 }}>
                        {dayEvents.slice(0, 3).map((event) => (
                          <View
                            key={event.id}
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: 3,
                              backgroundColor: colorMode ? accent : 'rgba(255,255,255,0.6)',
                            }}
                          />
                        ))}
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {/* `.mobile-month-agenda` — the selected day, in the same card. */}
              <View
                style={{
                  marginTop: 8,
                  marginHorizontal: -8,
                  paddingHorizontal: 14,
                  paddingTop: 4,
                  paddingBottom: 16,
                  borderTopWidth: 1,
                  borderTopColor: 'rgba(255,255,255,0.07)',
                }}
              >
                <AgendaSummary
                  date={selectedDate}
                  count={selectedEvents.length}
                  isToday={selectedKey === todayKey}
                />
                {selectedEvents.length === 0 ? (
                  <DashedNote>Nothing scheduled on this day.</DashedNote>
                ) : (
                  agendaRows
                )}
              </View>
            </Card>
          </FadeIn>
        ) : (
          <>
            {/* `.mobile-day-strip` — five tall day buttons. */}
            <FadeIn index={1}>
              <View style={{ flexDirection: 'row', gap: 7 }}>
                {strip.map((date) => {
                  const key = keyOfDate(date);
                  const isSelected = key === selectedKey;
                  const dayEvents = byDay.get(key) ?? [];
                  return (
                    <Pressable
                      key={key}
                      onPress={() => {
                        setSelectedKey(key);
                        setRefDate(date);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={date.toDateString()}
                      accessibilityState={{ selected: isSelected }}
                      style={{
                        flex: 1,
                        height: 82,
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        borderWidth: 1,
                        borderRadius: radius.xl,
                        borderColor: isSelected
                          ? colorMode
                            ? colors.violetLine
                            : colors.text
                          : colors.border,
                        backgroundColor: isSelected
                          ? colorMode
                            ? colors.violetFill
                            : colors.text
                          : colors.surface,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 10.5,
                          fontWeight: '600',
                          letterSpacing: 0.8,
                          color: isSelected
                            ? colorMode
                              ? accent
                              : 'rgba(0,0,0,0.6)'
                            : colors.textMuted,
                        }}
                      >
                        {DAY_INITIALS[date.getDay()]}
                      </Text>
                      <Text
                        style={{
                          fontSize: 21,
                          fontWeight: '600',
                          color: isSelected
                            ? colorMode
                              ? colors.text
                              : '#000000'
                            : colors.text,
                        }}
                      >
                        {date.getDate()}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 3, height: 5 }}>
                        {dayEvents.slice(0, 3).map((event) => (
                          <View
                            key={event.id}
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: 3,
                              backgroundColor: isSelected
                                ? colorMode
                                  ? accent
                                  : 'rgba(0,0,0,0.5)'
                                : 'rgba(255,255,255,0.55)',
                            }}
                          />
                        ))}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </FadeIn>

            {/* `.mobile-agenda-summary` + `.mobile-agenda-list` */}
            <FadeIn index={2}>
              <AgendaSummary
                date={selectedDate}
                count={selectedEvents.length}
                isToday={selectedKey === todayKey}
              />
              {selectedEvents.length === 0 ? (
                <DashedNote>Nothing scheduled. Tap New to put something on this day.</DashedNote>
              ) : (
                agendaRows
              )}
            </FadeIn>
          </>
        )}
      </ScrollView>

      {/* `.event-modal`, which becomes a bottom sheet on mobile. */}
      <Sheet
        visible={!!draft}
        onClose={() => setDraft(null)}
        kicker={draft?.id ? 'Edit event' : 'New event'}
        title={
          draft
            ? dateOfKey(draft.dateKey).toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })
            : undefined
        }
      >
        {draft && (
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
            <View style={{ gap: 14 }}>
              <View style={{ gap: 7 }}>
                <Text style={type.label}>Title</Text>
                <TextInput
                  style={shared.input}
                  placeholder="What is it?"
                  placeholderTextColor="rgba(255,255,255,0.44)"
                  value={draft.title}
                  onChangeText={(title) => setDraft({ ...draft, title })}
                  accessibilityLabel="Event title"
                />
              </View>

              <View style={{ gap: 7 }}>
                <Text style={type.label}>Description</Text>
                <TextInput
                  style={[shared.input, { minHeight: 76, textAlignVertical: 'top' }]}
                  placeholder="Optional"
                  placeholderTextColor="rgba(255,255,255,0.44)"
                  value={draft.description}
                  onChangeText={(description) => setDraft({ ...draft, description })}
                  multiline
                  accessibilityLabel="Description"
                />
              </View>

              <View style={{ gap: 7 }}>
                <Text style={type.label}>Location</Text>
                <TextInput
                  style={shared.input}
                  placeholder="Optional"
                  placeholderTextColor="rgba(255,255,255,0.44)"
                  value={draft.location}
                  onChangeText={(location) => setDraft({ ...draft, location })}
                  accessibilityLabel="Location"
                />
              </View>

              <ToggleRow
                title="All day"
                value={draft.allDay}
                onChange={(allDay) => setDraft({ ...draft, allDay })}
              />

              {!draft.allDay && (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, gap: 7 }}>
                    <Text style={type.label}>Starts</Text>
                    <TextInput
                      style={shared.input}
                      placeholder="09:00"
                      placeholderTextColor="rgba(255,255,255,0.44)"
                      value={draft.start}
                      onChangeText={(start) => setDraft({ ...draft, start })}
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      accessibilityLabel="Start time"
                    />
                  </View>
                  <View style={{ flex: 1, gap: 7 }}>
                    <Text style={type.label}>Ends</Text>
                    <TextInput
                      style={shared.input}
                      placeholder="10:00"
                      placeholderTextColor="rgba(255,255,255,0.44)"
                      value={draft.end}
                      onChangeText={(end) => setDraft({ ...draft, end })}
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      accessibilityLabel="End time"
                    />
                  </View>
                </View>
              )}

              {/* `.modal-footer` — two equal columns on mobile. */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <GhostButton label="Cancel" onPress={() => setDraft(null)} style={{ flex: 1 }} />
                <PrimaryButton
                  label={draft.id ? 'Save' : 'Add event'}
                  onPress={() => void saveDraft()}
                  busy={saving}
                  disabled={!draft.title.trim()}
                  style={{ flex: 1 }}
                />
              </View>

              {!!draft.id && (
                <Pressable
                  onPress={confirmDelete}
                  accessibilityRole="button"
                  accessibilityLabel="Delete event"
                  style={{ alignItems: 'center', minHeight: 44, justifyContent: 'center' }}
                >
                  <Text style={{ color: colors.danger, fontSize: 14 }}>Delete event</Text>
                </Pressable>
              )}
            </View>
          </ScrollView>
        )}
      </Sheet>
    </View>
  );
}

/** `.mobile-agenda-summary` — the day's name and its event count. */
function AgendaSummary({
  date,
  count,
  isToday,
}: {
  date: Date;
  count: number;
  isToday: boolean;
}) {
  const heading = isToday
    ? 'Today'
    : date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginTop: 24,
        marginBottom: 12,
        paddingHorizontal: 2,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 19, fontWeight: '600', letterSpacing: -0.4 }}>
        {heading}
      </Text>
      <Text style={{ color: colors.textSoft, fontSize: 13 }}>
        {count} {count === 1 ? 'event' : 'events'}
      </Text>
    </View>
  );
}

/** `.mobile-agenda-event` — time column, title, and a leading accent bar. */
function AgendaEventRow({
  event,
  accent,
  onPress,
}: {
  event: EventItem;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${event.title}`}
      style={({ pressed }) => ({
        minHeight: 74,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 14,
        paddingRight: 16,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.xl,
        backgroundColor: pressed ? '#161616' : colors.surface,
        overflow: 'hidden',
      })}
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 14,
          bottom: 14,
          width: 3,
          borderTopRightRadius: 3,
          borderBottomRightRadius: 3,
          backgroundColor: accent,
        }}
      />
      <View style={{ width: 54, paddingLeft: 6 }}>
        {event.allDay ? (
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>All day</Text>
        ) : (
          <>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>
              {timeLabel(event.startsAt)}
            </Text>
            {!!event.endsAt && (
              <Text style={{ color: colors.textFaint, fontSize: 11 }}>
                {timeLabel(event.endsAt)}
              </Text>
            )}
          </>
        )}
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {event.title}
        </Text>
        <Text style={{ color: colors.textFaint, fontSize: 12.5 }} numberOfLines={1}>
          {event.location || 'Event'}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
    </Pressable>
  );
}

/** `.calendar-actions .icon-button` — a 44px square. */
function IconSquare({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.borderStrong,
        backgroundColor: pressed ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
      })}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
    </Pressable>
  );
}
