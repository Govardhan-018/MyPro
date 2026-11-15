/**
 * Today — the web app's dashboard, as a phone screen.
 *
 * Same shape and same words as `TodayView` in `frontend/src/App.tsx`: the
 * date eyebrow over a greeting, the day's flow as an agenda, the MyPro
 * insight card, and Continue learning beneath. The agenda rows use the
 * `.mobile-agenda-event` treatment the web switches to at phone width.
 *
 * The one thing the browser has no counterpart for is the brief: on the phone
 * the insight card carries what the laptop wrote this morning, or the plain
 * version this device composed when the laptop was shut (Phase 11.3). It says
 * which, because a companion that quietly substitutes a lesser answer is a
 * companion you stop trusting.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LibraryItemRow } from '@mypro/shared';
import { client } from '../lib/client';
import { loadBrief, type Brief } from '../lib/brief';
import {
  Card, CardHeading, DataBanner, FadeIn, Kicker, Loading, PageHeading, Progress, Thumbnail,
} from '../components/ui';
import type { View_ } from '../components/TabBar';
import { colors, radius, space, type, useTheme } from '../theme';
import type { BookSummary } from './LibraryScreen';

/** The web's greetings, full stops included. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

const timeLabel = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : 'All day';

export function TodayScreen({
  onOpenBook,
  onNavigate,
}: {
  onOpenBook: (book: BookSummary) => void;
  onNavigate: (view: View_) => void;
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

  if (loading) return <Loading />;

  const events = brief?.events ?? [];
  const dateEyebrow = new Date()
    .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingHorizontal: space.gutter,
        paddingTop: 22,
        paddingBottom: 28,
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
      <PageHeading
        eyebrow={dateEyebrow}
        title={greeting()}
        lede="Here’s a calm look at what’s ahead."
      />

      {!!error && <DataBanner message={error} error />}

      {/* Today's flow */}
      <FadeIn index={1}>
        <Card>
          <CardHeading
            kicker="Today’s flow"
            title="Your day at a glance"
            actionLabel="Open calendar"
            onAction={() => onNavigate('calendar')}
          />

          {events.length === 0 ? (
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, paddingVertical: 8 }}>
              Nothing scheduled today. Enjoy the open day.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {events.map((event, index) => (
                <AgendaEvent
                  key={`${event.title}-${index}`}
                  time={event.allDay ? 'All day' : timeLabel(event.startsAt)}
                  title={event.title}
                  accent={colorMode ? accent : colors.text}
                />
              ))}
            </View>
          )}

          {(events.length > 0 || (brief?.openTasks ?? 0) > 0) && (
            <View
              style={{
                marginTop: 14,
                paddingTop: 13,
                borderTopWidth: 1,
                borderTopColor: colors.divider,
                gap: 8,
              }}
            >
              {events.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                    {events.length} {events.length === 1 ? 'event' : 'events'} scheduled today
                  </Text>
                </View>
              )}
              {(brief?.openTasks ?? 0) > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Ionicons name="checkbox-outline" size={14} color={colors.textMuted} />
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                    {brief?.openTasks} open {brief?.openTasks === 1 ? 'task' : 'tasks'} waiting on
                    you
                  </Text>
                </View>
              )}
            </View>
          )}
        </Card>
      </FadeIn>

      {/* MyPro insight — the brief lives here. */}
      <FadeIn index={2} style={{ marginTop: 12 }}>
        <Card>
          <Orb />
          <Kicker>MyPro insight</Kicker>
          <Text
            style={{
              color: colors.text,
              fontSize: 21,
              lineHeight: 27,
              fontWeight: '600',
              letterSpacing: -0.5,
              marginTop: 6,
              marginBottom: 8,
            }}
          >
            {brief?.text ?? 'Plan your day with me.'}
          </Text>
          <Text style={{ color: colors.textBody, fontSize: 14, lineHeight: 21 }}>
            {brief
              ? brief.source === 'generated'
                ? `Written by your companion${brief.at ? ` at ${timeLabel(brief.at)}` : ''}.`
                : 'Composed on this phone — your laptop has not written one today.'
              : 'I can organize your schedule, reading, and reminders around what matters.'}
          </Text>
          <Pressable
            onPress={() => onNavigate('assistant')}
            accessibilityRole="button"
            accessibilityLabel="Plan it with me"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              marginTop: 19,
              minHeight: 46,
            }}
          >
            <Text style={{ color: accent, fontSize: 14, fontWeight: '600' }}>
              Plan it with me
            </Text>
            <Ionicons name="arrow-forward" size={15} color={accent} />
          </Pressable>
        </Card>
      </FadeIn>

      {/* Continue learning */}
      <FadeIn index={3} style={{ marginTop: 12 }}>
        <Card>
          <CardHeading
            kicker="Library"
            title="Continue learning"
            actionLabel="View all"
            onAction={() => onNavigate('library')}
          />

          {reading.length === 0 ? (
            <View style={{ gap: 10, paddingVertical: 4 }}>
              <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
                Nothing in progress yet.
              </Text>
              <Pressable
                onPress={() => onNavigate('library')}
                accessibilityRole="button"
                accessibilityLabel="Add to your library"
                style={{ minHeight: 36, justifyContent: 'center' }}
              >
                <Text style={{ color: accent, fontSize: 13, fontWeight: '600' }}>
                  Add to your library
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              {reading.map((row) => {
                const details = (row.book_details ?? {}) as Record<string, unknown>;
                const total = typeof details.total_pages === 'number' ? details.total_pages : 0;
                const current =
                  typeof details.current_page === 'number' ? details.current_page : 1;
                const percent = total
                  ? Math.round((current / total) * 100)
                  : Math.round(row.progress ?? 0);
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
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${row.title}`}
                    style={{ flexDirection: 'row', gap: 14 }}
                  >
                    <Thumbnail title={row.title} width={62} height={82} rounded={10} />
                    <View style={{ flex: 1, gap: 4, justifyContent: 'center' }}>
                      <Text style={type.label}>Book</Text>
                      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }} numberOfLines={2}>
                        {row.title}
                      </Text>
                      <Text style={{ color: colors.textMuted, fontSize: 13 }} numberOfLines={1}>
                        {row.creator || 'In your library'}
                      </Text>
                      <Progress value={percent / 100} style={{ marginTop: 4 }} />
                      <Text style={{ color: colors.textSoft, fontSize: 12 }}>
                        {percent}% completed
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Card>
      </FadeIn>
    </ScrollView>
  );
}

/**
 * `.mobile-agenda-event` — a #111111 row with a 3px accent bar, the time in
 * its own column and the title beside it.
 */
function AgendaEvent({
  time,
  title,
  accent,
}: {
  time: string;
  title: string;
  accent: string;
}) {
  return (
    <View
      style={{
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
        backgroundColor: colors.surface,
        overflow: 'hidden',
      }}
    >
      {/* The leading accent bar. */}
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
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {time}
        </Text>
      </View>
      <Text
        style={{ flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' }}
        numberOfLines={1}
      >
        {title}
      </Text>
    </View>
  );
}

/**
 * `.orb` — the web draws a conic gradient, which React Native has no
 * equivalent for without a native gradient module. This is its flat cousin:
 * a ringed disc that picks up the accent in Color Mode.
 */
function Orb() {
  const { colorMode, accent } = useTheme();
  return (
    <View
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        marginBottom: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colorMode ? 'rgba(182,154,245,0.45)' : 'rgba(255,255,255,0.22)',
        backgroundColor: colorMode ? 'rgba(145,104,220,0.16)' : 'rgba(255,255,255,0.07)',
      }}
    >
      <Ionicons name="sparkles" size={18} color={colorMode ? accent : colors.text} />
    </View>
  );
}
