/**
 * Schedules — the recurring instructions that drive the Phase 11 clock.
 *
 * Each card says what a schedule does, when it fires next, its recurrence and
 * timezone, and whether it is active. Pause, resume and delete act on the
 * real rows through `/schedules`, and each change re-arms this device's local
 * notifications so the phone's clock agrees immediately.
 *
 * Creating and editing the richer action payloads stays in the web app, and
 * the footer says so rather than offering a button that cannot finish.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../components/Typography';
import { Ionicons } from '@expo/vector-icons';
import type { ScheduleRow } from '@mypro/shared';
import { client } from '../lib/client';
import { armUpcoming } from '../lib/notifications';
import {
  Card, DataBanner, EmptyState, FadeIn, Loading, MetaRow, PageHeading, useToast,
} from '../components/ui';
import { colors, radius, shared, space, type, useTheme } from '../theme';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function recurrenceLabel(row: ScheduleRow): string {
  const time = row.time_of_day ? ` at ${row.time_of_day.slice(0, 5)}` : '';
  switch (row.recurrence) {
    case 'once':
      return row.run_at
        ? `Once — ${new Date(row.run_at).toLocaleString(undefined, {
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}`
        : 'Once';
    case 'daily':
      return `Daily${time}`;
    case 'weekly': {
      const days = (row.assistant_schedule_days ?? [])
        .map((d) => DAY_NAMES[d.day_of_week] ?? '')
        .filter(Boolean);
      return days.length ? `Weekly on ${days.join(', ')}${time}` : `Weekly${time}`;
    }
    case 'monthly':
      return `Monthly${row.day_of_month ? ` on day ${row.day_of_month}` : ''}${time}`;
    case 'cron':
      return row.cron_expr ? `Cron · ${row.cron_expr}` : 'Custom schedule';
    default:
      return row.recurrence;
  }
}

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000);
  const clock = date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  if (diffMinutes > 0 && diffMinutes < 60) return `in ${diffMinutes} min — ${clock}`;
  if (diffMinutes > 0 && diffMinutes < 60 * 24) {
    return `in ${Math.round(diffMinutes / 60)} h — ${clock}`;
  }
  return clock;
}

const ACTION_LABEL: Record<ScheduleRow['action_type'], string> = {
  notify: 'Notification',
  report: 'Report',
  email: 'Email',
  chat_message: 'Assistant message',
};

export function SchedulesScreen() {
  const toast = useToast();
  const { accent, colorMode } = useTheme();
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await client.api.schedules.list());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your schedules.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setEnabled = async (row: ScheduleRow, enabled: boolean) => {
    setBusyId(row.id);
    // Optimistic, so the control answers the thumb immediately.
    setRows((current) => current.map((r) => (r.id === row.id ? { ...r, enabled } : r)));
    try {
      await client.api.schedules.update(row.id, { enabled });
      toast.show(enabled ? `Resumed "${row.name}"` : `Paused "${row.name}"`);
      // The local clock must agree with the change straight away.
      void armUpcoming();
    } catch (caught) {
      setRows((current) =>
        current.map((r) => (r.id === row.id ? { ...r, enabled: !enabled } : r)),
      );
      toast.show(caught instanceof Error ? caught.message : 'Could not update that.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = (row: ScheduleRow) => {
    Alert.alert(
      'Delete schedule?',
      `"${row.name}" will stop firing on every device. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setRows((current) => current.filter((r) => r.id !== row.id));
            try {
              await client.api.schedules.remove(row.id);
              toast.show('Schedule deleted');
              void armUpcoming();
            } catch {
              toast.show('Could not delete that.');
              void load();
            }
          },
        },
      ],
    );
  };

  if (loading) return <Loading />;

  const activeCount = rows.filter((r) => r.enabled).length;

  return (
    <View style={shared.screen}>
      <ScrollView
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
          eyebrow="Schedules"
          title="What happens without you."
          lede={
            rows.length
              ? `${activeCount} active of ${rows.length} — reminders and check-ins this phone fires on time.`
              : 'Recurring reminders and automated check-ins.'
          }
        />

        {!!error && <DataBanner message={error} error />}

        {rows.length === 0 ? (
          <FadeIn index={1}>
            <Card>
              <EmptyState
                icon="alarm-outline"
                title="No schedules yet"
                body="Create one in the web app or ask your assistant — a morning brief, a weekly review, a medication reminder."
              />
            </Card>
          </FadeIn>
        ) : (
          <View style={{ gap: 10 }}>
            {rows.map((item, index) => {
              const next = whenLabel(item.next_run_at);
              const last = whenLabel(item.last_run_at);
              return (
                <FadeIn key={item.id} index={Math.min(index + 1, 7)}>
                  <Card style={{ gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={type.h3}>{item.name}</Text>
                        {!!item.description && (
                          <Text style={type.meta}>{item.description}</Text>
                        )}
                      </View>
                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: radius.pill,
                          borderWidth: 1,
                          borderColor: item.enabled
                            ? colorMode
                              ? colors.violetLine
                              : 'rgba(255,255,255,0.22)'
                            : colors.divider,
                          backgroundColor: item.enabled
                            ? colorMode
                              ? 'rgba(182,154,245,0.1)'
                              : 'rgba(255,255,255,0.1)'
                            : 'transparent',
                        }}
                      >
                        <Text
                          style={{
                            color: item.enabled
                              ? colorMode
                                ? accent
                                : colors.text
                              : colors.textFaint,
                            fontSize: 11.5,
                            fontWeight: '600',
                          }}
                        >
                          {item.enabled ? 'Active' : 'Paused'}
                        </Text>
                      </View>
                    </View>

                    <View style={{ gap: 6 }}>
                      <MetaRow icon="repeat-outline">{recurrenceLabel(item)}</MetaRow>
                      {item.enabled && !!next && (
                        <MetaRow icon="alarm-outline" tone={colors.textMuted}>
                          Next {next}
                        </MetaRow>
                      )}
                      {!!last && (
                        <MetaRow icon="checkmark-done-outline">Last ran {last}</MetaRow>
                      )}
                      <MetaRow icon="globe-outline">
                        {item.timezone} · {ACTION_LABEL[item.action_type] ?? item.action_type}
                      </MetaRow>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
                      <Pressable
                        onPress={() => void setEnabled(item, !item.enabled)}
                        disabled={busyId === item.id}
                        accessibilityRole="button"
                        accessibilityLabel={
                          item.enabled ? `Pause ${item.name}` : `Resume ${item.name}`
                        }
                        style={[
                          shared.ghostButton,
                          { flex: 1, height: 44, opacity: busyId === item.id ? 0.6 : 1 },
                        ]}
                      >
                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
                          {item.enabled ? 'Pause' : 'Resume'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => confirmDelete(item)}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${item.name}`}
                        style={[
                          shared.ghostButton,
                          { width: 52, height: 44, paddingHorizontal: 0 },
                        ]}
                      >
                        <Ionicons name="trash-outline" size={17} color={colors.danger} />
                      </Pressable>
                    </View>
                  </Card>
                </FadeIn>
              );
            })}

            <Text style={[type.meta, { textAlign: 'center', marginTop: 6 }]}>
              Creating and editing schedules lives in the web app — the action payloads need a
              bigger form than a phone wants to hold.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
