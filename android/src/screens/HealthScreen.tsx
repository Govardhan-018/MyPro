/**
 * Health — private, calm, functional. MYPRO 2.0.
 *
 * Read-only here on purpose. These are the most sensitive rows in the
 * database: they sit behind an extra RLS gate that the assistant cannot pass
 * without a time-boxed grant, and editing a medical record on a phone in a
 * hurry is how a wrong dose gets written down. The web app owns creation and
 * editing; this is for looking something up — so search and filters are what
 * the phone adds. No gamification, no decoration: records.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { client } from '../lib/client';
import { Card, Chip, EmptyState, FadeIn, MetaRow } from '../components/ui';
import { colors, shared, space, type } from '../theme';

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
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';

export function HealthScreen() {
  const [records, setRecords] = useState<Record_[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);

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

  const statuses = useMemo(() => {
    const set = new Set<string>();
    for (const record of records) if (record.status) set.add(record.status);
    return [...set].sort();
  }, [records]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      if (status && record.status !== status) return false;
      if (!needle) return true;
      return (
        record.name.toLowerCase().includes(needle) ||
        (record.doctor ?? '').toLowerCase().includes(needle) ||
        (record.notes ?? '').toLowerCase().includes(needle)
      );
    });
  }, [records, query, status]);

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
      data={visible}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        padding: space.gutter,
        paddingTop: 8,
        paddingBottom: 48,
        gap: 10,
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
        <View style={{ gap: 14, marginBottom: 6 }}>
          <FadeIn index={0} style={{ gap: 4 }}>
            <Text style={type.title}>Health</Text>
            <Text style={type.support}>
              Yours alone — the assistant cannot read any of this without a grant you give it,
              and that is enforced in the database, not in app code. A personal reference, not
              medical advice.
            </Text>
            {error && (
              <Text style={{ color: colors.danger, fontSize: 12.5, marginTop: 6 }}>{error}</Text>
            )}
          </FadeIn>

          {records.length > 0 && (
            <FadeIn index={1} style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingHorizontal: 14,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: 'rgba(255,255,255,0.04)',
                }}
              >
                <Ionicons name="search" size={16} color={colors.textFaint} />
                <TextInput
                  style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11 }}
                  placeholder="Search records"
                  placeholderTextColor={colors.textFaint}
                  value={query}
                  onChangeText={setQuery}
                  accessibilityLabel="Search health records"
                />
              </View>
              {statuses.length > 1 && (
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  data={['all', ...statuses]}
                  keyExtractor={(s) => s}
                  contentContainerStyle={{ gap: 8 }}
                  renderItem={({ item }) => (
                    <Chip
                      label={item === 'all' ? 'All' : item.replaceAll('_', ' ')}
                      active={item === 'all' ? status === null : status === item}
                      onPress={() => setStatus(item === 'all' ? null : item)}
                    />
                  )}
                />
              )}
            </FadeIn>
          )}
        </View>
      }
      ListEmptyComponent={
        !error ? (
          records.length ? (
            <EmptyState icon="search-outline" title="No matches" body="No record fits that search." />
          ) : (
            <EmptyState
              icon="heart-outline"
              title="No records yet"
              body="Add illnesses, medications and documents in the web app; they will be here to look up."
            />
          )
        ) : null
      }
      renderItem={({ item, index }) => (
        <FadeIn index={Math.min(index + 2, 8)}>
          <Card style={{ gap: 7 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={[type.cardTitle, { flex: 1 }]}>{item.name}</Text>
              {!!item.status && (
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                    borderRadius: 999,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.borderStrong,
                  }}
                >
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                    {item.status.replaceAll('_', ' ')}
                  </Text>
                </View>
              )}
            </View>
            {(item.severity || item.startedOn) && (
              <MetaRow icon="pulse-outline">
                {[item.severity, dateLabel(item.startedOn)].filter(Boolean).join(' · ')}
              </MetaRow>
            )}
            {item.doctor && <MetaRow icon="medkit-outline">{item.doctor}</MetaRow>}
            {item.notes && <Text style={type.support}>{item.notes}</Text>}
          </Card>
        </FadeIn>
      )}
    />
  );
}
