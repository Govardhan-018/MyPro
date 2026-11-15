/**
 * Schedules — the phone-side view of the recurring instructions that drive
 * the Phase 11 clock.
 *
 * Each card shows what a schedule does, when it fires next, its recurrence
 * and timezone, and whether it is active. Pause/resume and delete act on the
 * real rows through Render; creating and editing the richer action payloads
 * stays on the web, and the screen says so instead of pretending.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ScheduleRow } from '@mypro/shared';
import { client } from '../lib/client';
import { armUpcoming } from '../lib/notifications';
import { Card, EmptyState, FadeIn, MetaRow, useToast } from '../components/ui';
import { colors, shared, space, type, useTheme } from '../theme';

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
  const now = Date.now();
  const diffMinutes = Math.round((date.getTime() - now) / 60_000);
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

export function SchedulesScreen({ onClose }: { onClose: () => void }) {
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
      const list = await client.api.schedules.list();
      setRows(list);
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
    // Optimistic, so the toggle answers the thumb immediately.
    setRows((current) => current.map((r) => (r.id === row.id ? { ...r, enabled } : r)));
    try {
      await client.api.schedules.update(row.id, { enabled });
      toast.show(enabled ? `Resumed “${row.name}”` : `Paused “${row.name}”`);
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
      `“${row.name}” will stop firing on every device. This cannot be undone.`,
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

  if (loading) {
    return (
      <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <FlatList
      style={shared.screen}
      data={rows}
      keyExtractor={(row) => row.id}
      contentContainerStyle={{
        padding: space.gutter,
        paddingTop: 56,
        paddingBottom: 48,
        gap: 12,
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
      ListHeaderComponent={
        <FadeIn index={0} style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.border,
              }}
            >
              <Ionicons name="chevron-back" size={19} color={colors.text} />
            </Pressable>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.title}>Schedules</Text>
              <Text style={type.support}>
                {rows.length
                  ? `${rows.filter((r) => r.enabled).length} active of ${rows.length}`
                  : 'Recurring reminders and check-ins'}
              </Text>
            </View>
          </View>
          {error && <Text style={[type.support, { marginTop: 10 }]}>{error}</Text>}
        </FadeIn>
      }
      ListEmptyComponent={
        !error ? (
          <EmptyState
            icon="repeat-outline"
            title="No schedules yet"
            body="Create one in the web app or ask your assistant — a morning brief, a weekly review, a medication reminder."
          />
        ) : null
      }
      renderItem={({ item, index }) => {
        const next = whenLabel(item.next_run_at);
        const last = whenLabel(item.last_run_at);
        return (
          <FadeIn index={Math.min(index + 1, 6)}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={type.cardTitle}>{item.name}</Text>
                  {!!item.description && <Text style={type.support}>{item.description}</Text>}
                </View>
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                    backgroundColor: item.enabled
                      ? colorMode
                        ? 'rgba(168,140,242,0.16)'
                        : 'rgba(255,255,255,0.1)'
                      : 'transparent',
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: item.enabled
                      ? colorMode
                        ? accent
                        : colors.borderStrong
                      : colors.border,
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

              <View style={{ gap: 6, marginTop: 2 }}>
                <MetaRow icon="repeat-outline">{recurrenceLabel(item)}</MetaRow>
                {item.enabled && next && (
                  <MetaRow icon="alarm-outline" tone={colors.textMuted}>
                    Next {next}
                  </MetaRow>
                )}
                {last && <MetaRow icon="checkmark-done-outline">Last ran {last}</MetaRow>}
                <MetaRow icon="globe-outline">
                  {item.timezone} · {ACTION_LABEL[item.action_type] ?? item.action_type}
                </MetaRow>
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
                <Pressable
                  onPress={() => void setEnabled(item, !item.enabled)}
                  disabled={busyId === item.id}
                  accessibilityRole="button"
                  accessibilityLabel={item.enabled ? 'Pause schedule' : 'Resume schedule'}
                  style={[shared.ghostButton, { flex: 1, paddingVertical: 10 }]}
                >
                  <Text style={shared.ghostLabel}>{item.enabled ? 'Pause' : 'Resume'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(item)}
                  accessibilityRole="button"
                  accessibilityLabel="Delete schedule"
                  style={[shared.ghostButton, { paddingHorizontal: 14, paddingVertical: 10 }]}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                </Pressable>
              </View>
            </Card>
          </FadeIn>
        );
      }}
      ListFooterComponent={
        rows.length ? (
          <Text style={[type.label, { textAlign: 'center', marginTop: 8 }]}>
            Creating and editing schedules lives in the web app for now — the richer
            action payloads need a bigger form than a phone wants to hold.
          </Text>
        ) : null
      }
    />
  );
}
