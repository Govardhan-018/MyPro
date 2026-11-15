/**
 * Today — the daily workspace. MYPRO 2.0.
 *
 * Greeting and date, the companion's brief (honest about whether the laptop
 * wrote it), today's focus as an agenda with a time rail, open tasks, and a
 * premium continue-reading card with cover and progress. Sections enter
 * top-to-bottom with the shared stagger.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LibraryItemRow } from '@mypro/shared';
import { client } from '../lib/client';
import { loadBrief, type Brief } from '../lib/brief';
import {
  Card, EmptyState, FadeIn, PlaceholderCover, ProgressBar, SectionLabel,
} from '../components/ui';
import { colors, shared, space, type, useTheme } from '../theme';
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

export function TodayScreen({
  onOpenBook,
  onOpenCalendar,
}: {
  onOpenBook: (book: BookSummary) => void;
  onOpenCalendar: () => void;
}) {
  const { accent, colorMode } = useTheme();
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
      contentContainerStyle={{
        padding: space.gutter,
        paddingTop: 8,
        paddingBottom: 48,
        gap: space.md + 4,
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
      <FadeIn index={0} style={{ gap: 4 }}>
        <Text style={type.title}>{greeting()}</Text>
        <Text style={type.support}>
          {new Date().toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </Text>
      </FadeIn>

      {error && (
        <FadeIn index={1}>
          <Card>
            <Text style={type.body}>{error}</Text>
          </Card>
        </FadeIn>
      )}

      {brief && (
        <FadeIn index={1}>
          <Card elevated style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons
                name="sparkles"
                size={14}
                color={colorMode ? accent : colors.textMuted}
              />
              <Text style={type.eyebrow}>MyPro insight</Text>
            </View>
            <Text style={{ color: colors.text, fontSize: 16.5, lineHeight: 25 }}>
              {brief.text}
            </Text>
            <Text style={type.label}>
              {brief.source === 'generated'
                ? `Written by your companion${brief.at ? ` at ${timeLabel(brief.at)}` : ''}`
                : 'Composed on this phone — your laptop has not written one today'}
            </Text>
          </Card>
        </FadeIn>
      )}

      <FadeIn index={2} style={{ gap: 10 }}>
        <SectionLabel>Today's focus</SectionLabel>
        {brief?.events.length ? (
          <Card style={{ gap: 14 }}>
            {brief.events.map((event, index) => (
              <View
                key={`${event.title}-${index}`}
                style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}
              >
                <View style={{ width: 64, alignItems: 'flex-start' }}>
                  <Text
                    style={{
                      color: colorMode ? accent : colors.textMuted,
                      fontSize: 12.5,
                      fontWeight: '600',
                    }}
                    numberOfLines={1}
                  >
                    {event.allDay ? 'All day' : timeLabel(event.startsAt)}
                  </Text>
                </View>
                <View
                  style={{
                    width: 3,
                    alignSelf: 'stretch',
                    borderRadius: 2,
                    backgroundColor: colorMode ? accent : 'rgba(255,255,255,0.18)',
                    opacity: 0.7,
                  }}
                />
                <Text style={[type.body, { flex: 1, color: colors.text }]}>{event.title}</Text>
              </View>
            ))}
          </Card>
        ) : (
          <EmptyState
            icon="calendar-clear-outline"
            title="A clear day"
            body="Nothing scheduled yet. Plan something, or enjoy the room to think."
            action={
              <Pressable
                onPress={onOpenCalendar}
                accessibilityRole="button"
                accessibilityLabel="Open calendar"
                style={[shared.ghostButton, { paddingHorizontal: 20 }]}
              >
                <Text style={shared.ghostLabel}>Open calendar</Text>
              </Pressable>
            }
          />
        )}
      </FadeIn>

      {brief && brief.openTasks > 0 && (
        <FadeIn index={3} style={{ gap: 10 }}>
          <SectionLabel>Open tasks</SectionLabel>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Ionicons name="checkbox-outline" size={18} color={colors.textMuted} />
            <Text style={[type.body, { flex: 1, color: colors.text }]}>
              {brief.openTasks} task{brief.openTasks === 1 ? '' : 's'} waiting on you
            </Text>
          </Card>
        </FadeIn>
      )}

      {reading.length > 0 && (
        <FadeIn index={4} style={{ gap: 10 }}>
          <SectionLabel>Continue reading</SectionLabel>
          <View style={{ gap: 10 }}>
            {reading.map((row) => {
              const details = (row.book_details ?? {}) as Record<string, unknown>;
              const total = typeof details.total_pages === 'number' ? details.total_pages : 0;
              const current =
                typeof details.current_page === 'number' ? details.current_page : 1;
              const fraction = total ? current / total : 0;
              return (
                <Card
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
                  accessibilityLabel={`Resume ${row.title}`}
                  style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}
                >
                  <PlaceholderCover title={row.title} width={52} height={72} />
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={type.cardTitle} numberOfLines={2}>
                      {row.title}
                    </Text>
                    <Text style={type.label} numberOfLines={1}>
                      {row.creator || 'Book'}
                      {total ? ` · Page ${current} of ${total}` : ''}
                    </Text>
                    {total > 0 && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <ProgressBar value={fraction} style={{ flex: 1 }} />
                        <Text style={type.label}>{Math.round(fraction * 100)}%</Text>
                      </View>
                    )}
                  </View>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.surfaceHigh,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: colors.borderStrong,
                    }}
                  >
                    <Ionicons name="play" size={14} color={colorMode ? accent : colors.text} />
                  </View>
                </Card>
              );
            })}
          </View>
        </FadeIn>
      )}
    </ScrollView>
  );
}
