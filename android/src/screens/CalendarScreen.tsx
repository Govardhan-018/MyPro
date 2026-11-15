import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, SectionList, Text, View,
} from 'react-native';
import { client } from '../lib/client';
import { colors, shared } from '../theme';

interface EventItem {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
}

/** How far forward the agenda reaches. Four weeks is a scroll, not a wall. */
const WINDOW_DAYS = 28;

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

function headingFor(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

const timeLabel = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';

/** Your week ahead, as an agenda — Phase 8.3. */
export function CalendarScreen() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + WINDOW_DAYS * 86_400_000);
    try {
      const rows = await client.api.calendar.events({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      setEvents(
        rows.map((row) => ({
          id: String(row.id),
          title: typeof row.title === 'string' ? row.title : 'Untitled',
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo(() => {
    const byDay = new Map<string, EventItem[]>();
    for (const event of events) {
      if (!event.startsAt) continue;
      const key = dateKeyOf(event.startsAt, event.allDay);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(event);
      else byDay.set(key, [event]);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, data]) => ({
        key,
        title: headingFor(key),
        // All-day events sit above the timed ones, as they do on the web.
        data: data.sort((a, b) => {
          if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
          return (a.startsAt ?? '').localeCompare(b.startsAt ?? '');
        }),
      }));
  }, [events]);

  if (loading) {
    return (
      <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <SectionList
      style={shared.screen}
      sections={sections}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 20, paddingTop: 56, paddingBottom: 40 }}
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
      ListHeaderComponent={
        <View style={{ gap: 4, marginBottom: 18 }}>
          <Text style={shared.title}>Calendar</Text>
          <Text style={shared.muted}>The next four weeks</Text>
          {error && (
            <Text style={{ color: colors.textMuted, fontSize: 12.5, marginTop: 8 }}>{error}</Text>
          )}
        </View>
      }
      ListEmptyComponent={
        !error ? (
          <View style={shared.card}>
            <Text style={shared.muted}>Nothing scheduled in the next four weeks.</Text>
          </View>
        ) : null
      }
      renderSectionHeader={({ section }) => (
        <Text
          style={{
            color: colors.textFaint,
            fontSize: 11,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            marginTop: 20,
            marginBottom: 8,
          }}
        >
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <View style={[shared.card, { marginBottom: 8, gap: 4 }]}>
          <Text style={{ color: colors.text, fontSize: 15.5 }}>{item.title}</Text>
          <Text style={{ color: colors.textFaint, fontSize: 12 }}>
            {item.allDay
              ? 'All day'
              : `${timeLabel(item.startsAt)}${item.endsAt ? ` – ${timeLabel(item.endsAt)}` : ''}`}
            {item.location ? ` · ${item.location}` : ''}
          </Text>
        </View>
      )}
    />
  );
}
