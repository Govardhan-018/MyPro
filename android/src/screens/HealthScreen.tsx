import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { client } from '../lib/client';
import { colors, shared } from '../theme';

interface Record_ {
  id: string;
  name: string;
  status: string | null;
  severity: string | null;
  startedOn: string | null;
  doctor: string | null;
  notes: string | null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

const dateLabel = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/**
 * Health — Phase 8.3.
 *
 * Read-only here on purpose. These are the most sensitive rows in the
 * database: they sit behind an extra RLS gate that the assistant cannot pass
 * without a time-boxed grant, and editing a medical record on a phone in a
 * hurry is how a wrong dose gets written down. The web app owns creation and
 * editing; this is for looking something up.
 */
export function HealthScreen() {
  const [records, setRecords] = useState<Record_[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await client.api.health.records();
      setRecords(
        rows.map((row) => ({
          id: String(row.id),
          name: str(row.name) ?? 'Untitled',
          status: str(row.status),
          severity: str(row.severity),
          startedOn: str(row.started_on),
          doctor: str(row.doctor),
          notes: str(row.notes),
        })),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your health records.');
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
    <FlatList
      style={shared.screen}
      data={records}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 20, paddingTop: 56, paddingBottom: 40, gap: 10 }}
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
        <View style={{ gap: 4, marginBottom: 14 }}>
          <Text style={shared.title}>Health</Text>
          <Text style={shared.muted}>
            Yours alone — the assistant cannot read any of this without a grant you give it,
            and that is enforced in the database, not in app code.
          </Text>
          {error && (
            <Text style={{ color: colors.textMuted, fontSize: 12.5, marginTop: 8 }}>{error}</Text>
          )}
        </View>
      }
      ListEmptyComponent={
        !error ? (
          <View style={shared.card}>
            <Text style={shared.muted}>No records yet. Add them in the web app.</Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={[shared.card, { gap: 5 }]}>
          <Text style={{ color: colors.text, fontSize: 15.5 }}>{item.name}</Text>
          <Text style={{ color: colors.textFaint, fontSize: 12 }}>
            {[item.status, item.severity, dateLabel(item.startedOn)].filter(Boolean).join(' · ')}
          </Text>
          {item.doctor && (
            <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>{item.doctor}</Text>
          )}
          {item.notes && (
            <Text style={{ color: colors.textStrong, fontSize: 13.5, lineHeight: 19 }}>
              {item.notes}
            </Text>
          )}
        </View>
      )}
    />
  );
}
