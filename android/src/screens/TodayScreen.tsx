import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View,
} from 'react-native';
import type { LibraryItemRow } from '@mypro/shared';
import { client } from '../lib/client';
import { loadBrief, type Brief } from '../lib/brief';
import { colors, shared } from '../theme';
import type { BookSummary } from './LibraryScreen';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const timeLabel = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : 'All day';

/**
 * Today — Phase 8.3, and where Phase 11.3 shows its face.
 *
 * The brief at the top is either the one the laptop generated or the plain one
 * this device composed from the calendar and tasks it can still reach. It says
 * which, because a companion that quietly substitutes a lesser answer is a
 * companion you stop trusting.
 */
export function TodayScreen({ onOpenBook }: { onOpenBook: (book: BookSummary) => void }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [reading, setReading] = useState<LibraryItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [next, books] = await Promise.all([
        loadBrief(),
        client.api.library.list({ type: 'book', status: 'in_progress' }).catch(() => []),
      ]);
      setBrief(next);
      setReading(books.slice(0, 3));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load today.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={{ padding: 20, paddingTop: 56, paddingBottom: 40, gap: 18 }}
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
      <View style={{ gap: 4 }}>
        <Text style={shared.title}>{greeting()}</Text>
        <Text style={shared.muted}>
          {new Date().toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </Text>
      </View>

      {error && (
        <View style={shared.card}>
          <Text style={{ color: colors.text, fontSize: 14 }}>{error}</Text>
        </View>
      )}

      {brief && (
        <View style={shared.card}>
          <Text style={{ color: colors.text, fontSize: 16, lineHeight: 23 }}>{brief.text}</Text>
          <Text style={{ color: colors.textFaint, fontSize: 11.5, marginTop: 4 }}>
            {brief.source === 'generated'
              ? `Written by your companion${brief.at ? ` at ${timeLabel(brief.at)}` : ''}`
              : 'Composed on this phone — your laptop has not written one today'}
          </Text>
        </View>
      )}

      <Section title="Agenda">
        {brief?.events.length ? (
          brief.events.map((event, index) => (
            <View
              key={`${event.title}-${index}`}
              style={{ flexDirection: 'row', gap: 14, alignItems: 'baseline' }}
            >
              <Text
                style={{ color: colors.textMuted, fontSize: 12.5, width: 64 }}
                numberOfLines={1}
              >
                {event.allDay ? 'All day' : timeLabel(event.startsAt)}
              </Text>
              <Text style={{ color: colors.text, fontSize: 15, flex: 1 }}>{event.title}</Text>
            </View>
          ))
        ) : (
          <Text style={shared.muted}>Nothing scheduled.</Text>
        )}
      </Section>

      {brief && brief.openTasks > 0 && (
        <Section title="Open tasks">
          <Text style={{ color: colors.text, fontSize: 15 }}>
            {brief.openTasks} task{brief.openTasks === 1 ? '' : 's'} waiting on you.
          </Text>
        </Section>
      )}

      {reading.length > 0 && (
        <Section title="Continue reading">
          {reading.map((row) => {
            const details = (row.book_details ?? {}) as Record<string, unknown>;
            const total = typeof details.total_pages === 'number' ? details.total_pages : 0;
            const current =
              typeof details.current_page === 'number' ? details.current_page : 1;
            return (
              <Pressable
                key={row.id}
                onPress={() =>
                  onOpenBook({
                    id: row.id,
                    title: row.title,
                    creator: row.creator ?? '',
                    currentPage: current,
                    totalPages: total,
                    hasText:
                      typeof details.pdf_json_path === 'string' && !!details.pdf_json_path,
                  })
                }
                style={{ gap: 2 }}
              >
                <Text style={{ color: colors.text, fontSize: 15 }}>{row.title}</Text>
                <Text style={{ color: colors.textFaint, fontSize: 12 }}>
                  {total ? `Page ${current} of ${total}` : row.creator || 'Book'}
                </Text>
              </Pressable>
            );
          })}
        </Section>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text
        style={{
          color: colors.textFaint,
          fontSize: 11,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
        }}
      >
        {title}
      </Text>
      <View style={[shared.card, { gap: 12 }]}>{children}</View>
    </View>
  );
}
