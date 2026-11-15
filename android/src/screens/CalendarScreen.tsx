/**
 * Calendar — MYPRO 2.0.
 *
 * A month grid with event indicators and a selected-day agenda beneath it,
 * plus quick event creation and editing in a bottom sheet. All of it drives
 * the same `calendar_events` rows as the web app, through Render.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { client } from '../lib/client';
import {
  Card, EmptyState, FadeIn, GhostButton, PrimaryButton, SectionLabel, Sheet,
  ToggleRow, useToast,
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

/**
 * Local date key — never `toISOString().slice(0, 10)`.
 *
 * That takes the **UTC** date, which is a different day for most of the
 * evening east of Greenwich: a 02:00 event on the 16th is stored as
 * `…T20:30:00Z` on the 15th and lands under the wrong heading. The web app
 * shipped exactly that bug; this is the same fix (`dateKeyOf`).
 */
function dateKeyOf(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (allDay) return iso.slice(0, 10); // stored as a plain date, no zone to shift
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

const keyOfDate = (d: Date): string => {
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};

const timeLabel = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Draft being created or edited in the sheet. */
interface Draft {
  id: string | null;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  start: string; // HH:MM
  end: string; // HH:MM, may be empty
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function CalendarScreen() {
  const toast = useToast();
  const { accent, colorMode } = useTheme();
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedKey, setSelectedKey] = useState(() => keyOfDate(today));
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    // The visible month, padded a week either side so edge days have dots.
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), -7);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 8);
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
  }, [cursor]);

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
      bucket.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return (a.startsAt ?? '').localeCompare(b.startsAt ?? '');
      });
    }
    return map;
  }, [events]);

  /** The month grid: leading blanks (Monday-first) then the days. */
  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7; // Monday = 0
    const count = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let day = 1; day <= count; day++) cells.push(new Date(year, month, day));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const selectedEvents = byDay.get(selectedKey) ?? [];
  const todayKey = keyOfDate(today);
  const selectedDate = useMemo(() => {
    const [y, m, d] = selectedKey.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }, [selectedKey]);

  const moveMonth = (delta: number) => {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  const openCreate = () => {
    setDraft({
      id: null,
      title: '',
      description: '',
      location: '',
      allDay: false,
      start: '09:00',
      end: '',
    });
  };

  const openEdit = (event: EventItem) => {
    const starts = event.startsAt ? new Date(event.startsAt) : null;
    const ends = event.endsAt ? new Date(event.endsAt) : null;
    const hhmm = (d: Date | null) =>
      d
        ? `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`
        : '';
    setDraft({
      id: event.id,
      title: event.title,
      description: event.description ?? '',
      location: event.location ?? '',
      allDay: event.allDay,
      start: event.allDay ? '09:00' : hhmm(starts) || '09:00',
      end: event.allDay ? '' : hhmm(ends),
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

    const at = (hhmm: string): string => {
      const [h, m] = hhmm.split(':').map(Number);
      const d = new Date(selectedDate);
      d.setHours(h ?? 0, m ?? 0, 0, 0);
      return d.toISOString();
    };
    const startsAt = draft.allDay
      ? new Date(new Date(selectedDate).setHours(0, 0, 0, 0)).toISOString()
      : at(draft.start);
    const endsAt = !draft.allDay && draft.end ? at(draft.end) : undefined;

    const body: Record<string, unknown> = {
      title,
      starts_at: startsAt,
      all_day: draft.allDay,
    };
    if (draft.description.trim()) body.description = draft.description.trim();
    if (draft.location.trim()) body.location = draft.location.trim();
    if (endsAt) body.ends_at = endsAt;

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
    Alert.alert('Delete event?', `“${draft.title}” will be removed. This cannot be undone.`, [
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

  if (loading) {
    return (
      <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <View style={shared.screen}>
      <ScrollView
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: 8,
          paddingBottom: 48,
          gap: space.md,
        }}
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
        <FadeIn index={0}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.title}>Calendar</Text>
              {error && <Text style={type.support}>{error}</Text>}
            </View>
            <Pressable
              onPress={openCreate}
              accessibilityRole="button"
              accessibilityLabel="Add event"
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colorMode ? accent : colors.text,
              }}
            >
              <Ionicons name="add" size={22} color={colors.background} />
            </Pressable>
          </View>
        </FadeIn>

        <FadeIn index={1}>
          <Card style={{ gap: 12 }}>
            {/* Month switcher */}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable
                onPress={() => moveMonth(-1)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                style={{ padding: 6 }}
              >
                <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
              </Pressable>
              <Text style={[type.cardTitle, { flex: 1, textAlign: 'center' }]}>
                {monthLabel}
              </Text>
              <Pressable
                onPress={() => moveMonth(1)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Next month"
                style={{ padding: 6 }}
              >
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            </View>

            {/* Weekday header */}
            <View style={{ flexDirection: 'row' }}>
              {WEEKDAYS.map((day, i) => (
                <Text
                  key={`${day}-${i}`}
                  style={[type.label, { flex: 1, textAlign: 'center' }]}
                >
                  {day}
                </Text>
              ))}
            </View>

            {/* Day grid */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {grid.map((date, index) => {
                if (!date) {
                  return <View key={`blank-${index}`} style={{ width: '14.28%', height: 44 }} />;
                }
                const key = keyOfDate(date);
                const isToday = key === todayKey;
                const isSelected = key === selectedKey;
                const hasEvents = byDay.has(key);
                return (
                  <Pressable
                    key={key}
                    onPress={() => setSelectedKey(key)}
                    accessibilityRole="button"
                    accessibilityLabel={date.toDateString()}
                    accessibilityState={{ selected: isSelected }}
                    style={{
                      width: '14.28%',
                      height: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isSelected
                          ? colorMode
                            ? accent
                            : colors.text
                          : 'transparent',
                        borderWidth: isToday && !isSelected ? 1 : 0,
                        borderColor: colorMode ? accent : colors.borderStrong,
                      }}
                    >
                      <Text
                        style={{
                          color: isSelected
                            ? colors.background
                            : isToday
                              ? colorMode
                                ? accent
                                : colors.text
                              : colors.textStrong,
                          fontSize: 14,
                          fontWeight: isSelected || isToday ? '700' : '400',
                        }}
                      >
                        {date.getDate()}
                      </Text>
                    </View>
                    <View
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: 2,
                        marginTop: 1,
                        backgroundColor: hasEvents
                          ? isSelected
                            ? colors.textMuted
                            : colorMode
                              ? accent
                              : colors.textMuted
                          : 'transparent',
                      }}
                    />
                  </Pressable>
                );
              })}
            </View>
          </Card>
        </FadeIn>

        <FadeIn index={2} style={{ gap: 10 }}>
          <SectionLabel>
            {selectedKey === todayKey
              ? 'Today'
              : selectedDate.toLocaleDateString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
          </SectionLabel>

          {selectedEvents.length ? (
            <View style={{ gap: 8 }}>
              {selectedEvents.map((event) => (
                <Card
                  key={event.id}
                  onPress={() => openEdit(event)}
                  accessibilityLabel={`Edit ${event.title}`}
                  style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}
                >
                  <View
                    style={{
                      width: 3,
                      alignSelf: 'stretch',
                      borderRadius: 2,
                      backgroundColor: colorMode ? accent : 'rgba(255,255,255,0.25)',
                    }}
                  />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ color: colors.text, fontSize: 15.5, fontWeight: '500' }}>
                      {event.title}
                    </Text>
                    <Text style={type.label}>
                      {event.allDay
                        ? 'All day'
                        : `${timeLabel(event.startsAt)}${
                            event.endsAt ? ` – ${timeLabel(event.endsAt)}` : ''
                          }`}
                      {event.location ? ` · ${event.location}` : ''}
                    </Text>
                    {!!event.description && (
                      <Text style={type.support} numberOfLines={2}>
                        {event.description}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
                </Card>
              ))}
            </View>
          ) : (
            <EmptyState
              icon="calendar-clear-outline"
              title="Nothing here yet"
              body="This day is open."
              action={
                <Pressable
                  onPress={openCreate}
                  accessibilityRole="button"
                  accessibilityLabel="Add an event"
                  style={[shared.ghostButton, { paddingHorizontal: 20 }]}
                >
                  <Text style={shared.ghostLabel}>Add an event</Text>
                </Pressable>
              }
            />
          )}
        </FadeIn>
      </ScrollView>

      {/* Create / edit sheet */}
      <Sheet
        visible={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit event' : 'New event'}
      >
        {draft && (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 12 }}
            style={{ flexGrow: 0 }}
          >
            <Text style={type.support}>
              {selectedDate.toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </Text>
            <TextInput
              style={shared.input}
              placeholder="Title"
              placeholderTextColor={colors.textFaint}
              value={draft.title}
              onChangeText={(title) => setDraft({ ...draft, title })}
            />
            <TextInput
              style={[shared.input, { minHeight: 70, textAlignVertical: 'top' }]}
              placeholder="Description (optional)"
              placeholderTextColor={colors.textFaint}
              value={draft.description}
              onChangeText={(description) => setDraft({ ...draft, description })}
              multiline
            />
            <TextInput
              style={shared.input}
              placeholder="Location (optional)"
              placeholderTextColor={colors.textFaint}
              value={draft.location}
              onChangeText={(location) => setDraft({ ...draft, location })}
            />
            <ToggleRow
              title="All day"
              value={draft.allDay}
              onChange={(allDay) => setDraft({ ...draft, allDay })}
            />
            {!draft.allDay && (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={type.label}>Starts</Text>
                  <TextInput
                    style={shared.input}
                    placeholder="09:00"
                    placeholderTextColor={colors.textFaint}
                    value={draft.start}
                    onChangeText={(start) => setDraft({ ...draft, start })}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={type.label}>Ends (optional)</Text>
                  <TextInput
                    style={shared.input}
                    placeholder="10:00"
                    placeholderTextColor={colors.textFaint}
                    value={draft.end}
                    onChangeText={(end) => setDraft({ ...draft, end })}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                  />
                </View>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <View style={{ flex: 1 }}>
                <GhostButton label="Cancel" onPress={() => setDraft(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={draft.id ? 'Save' : 'Add event'}
                  onPress={() => void saveDraft()}
                  busy={saving}
                  disabled={!draft.title.trim()}
                />
              </View>
            </View>
            {draft.id && (
              <Pressable
                onPress={confirmDelete}
                accessibilityRole="button"
                accessibilityLabel="Delete event"
                style={{ alignItems: 'center', paddingVertical: 10 }}
              >
                <Text style={{ color: colors.danger, fontSize: 14 }}>Delete event</Text>
              </Pressable>
            )}
          </ScrollView>
        )}
      </Sheet>
    </View>
  );
}
