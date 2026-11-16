/**
 * Health Records — the web app's health view, as a phone screen.
 *
 * Same words and same anatomy as `HealthView` in `frontend/src/App.tsx`: the
 * privacy note, the three count tiles, then the illness history as a
 * timeline with its search and filters, and a record's full detail behind a
 * tap.
 *
 * `/health/records` already embeds `health_symptoms`, `health_medications`
 * and `health_documents`, so the detail sheet shows the same nested data the
 * browser does rather than a thinner summary.
 *
 * Creating and editing stay on the web. These are the most sensitive rows in
 * the database — they sit behind an extra RLS gate the assistant cannot pass
 * without a time-boxed grant — and editing a medical record on a phone in a
 * hurry is how a wrong dose gets written down. There is no Add button here
 * rather than a button that cannot finish the job.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text, TextInput } from '../components/Typography';
import { Ionicons } from '@expo/vector-icons';
import { client } from '../lib/client';
import {
  Card, CardHeading, DataBanner, EmptyState, FadeIn, FilterChip, GhostButton, Kicker,
  Loading, PageHeading, PrimaryButton, Sheet, Tag, useToast, type IconName,
} from '../components/ui';
import { colors, radius, shared, space, type, useTheme } from '../theme';

const str = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/** Supabase returns a to-many embed as an array; be tolerant anyway. */
function many(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === 'object') return [raw as Record<string, unknown>];
  return [];
}

interface Medication {
  name: string;
  dosage: string | null;
  frequency: string | null;
  startedOn: string | null;
  endedOn: string | null;
  reason: string | null;
  notes: string | null;
}

interface Document {
  name: string;
  kind: string;
}

interface Record_ {
  id: string;
  name: string;
  status: string;
  severity: string | null;
  startedOn: string | null;
  endedOn: string | null;
  doctor: string | null;
  diagnosis: string | null;
  consultationOn: string | null;
  notes: string | null;
  symptoms: string[];
  symptomStart: string | null;
  symptomSeverity: string | null;
  symptomNotes: string | null;
  medications: Medication[];
  documents: Document[];
}

/** The web's `displayHealthDate`. */
const dateLabel = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'Not recorded';

/** The web's `illnessDuration`. */
function duration(start: string | null, end: string | null): string {
  if (!start) return 'Not recorded';
  const from = new Date(start);
  const to = end ? new Date(end) : new Date();
  const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  if (!end) return `${days} days so far`;
  if (days === 0) return 'Same day';
  if (days === 1) return '1 day';
  if (days < 14) return `${days} days`;
  return `${Math.round(days / 7)} weeks`;
}

function toRecord(row: Record<string, unknown>): Record_ {
  const symptoms = many(row.health_symptoms);
  const first = symptoms[0] ?? {};
  return {
    id: String(row.id),
    name: str(row.name) ?? 'Untitled illness record',
    status: str(row.status) ?? 'Incomplete record',
    severity: str(row.severity),
    startedOn: str(row.started_on),
    endedOn: str(row.ended_on),
    doctor: str(row.doctor),
    diagnosis: str(row.diagnosis),
    consultationOn: str(row.consultation_on),
    notes: str(row.notes),
    symptoms: symptoms.map((s) => str(s.name) ?? '').filter(Boolean),
    symptomStart: str(first.started_on),
    symptomSeverity: str(first.severity),
    symptomNotes: str(first.notes),
    medications: many(row.health_medications).map((m) => ({
      name: str(m.name) ?? 'Medication',
      dosage: str(m.dosage),
      frequency: str(m.frequency),
      startedOn: str(m.started_on),
      endedOn: str(m.ended_on),
      reason: str(m.reason),
      notes: str(m.notes) ?? str(m.observations),
    })),
    documents: many(row.health_documents).map((d) => ({
      name: str(d.filename) ?? 'Document',
      kind: str(d.kind) ?? 'Document',
    })),
  };
}

/** A date the API will accept: `z.string().date()`. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** What the add/edit sheet holds while you fill it in. */
interface Draft {
  id: string | null;
  name: string;
  status: string;
  severity: string;
  startedOn: string;
  endedOn: string;
  doctor: string;
  diagnosis: string;
  notes: string;
  /** Comma-separated; each becomes its own `health_symptoms` row. */
  symptoms: string;
  medication: string;
  dosage: string;
}

/** The web's three status options. */
const STATUSES = ['All statuses', 'Recovered', 'Recovery ongoing', 'Incomplete record'] as const;

export function HealthScreen() {
  const toast = useToast();
  const { accent, colorMode } = useTheme();
  const [records, setRecords] = useState<Record_[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string>('All statuses');
  const [year, setYear] = useState<string>('All years');
  const [selected, setSelected] = useState<Record_ | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await client.api.health.records();
      setRecords(rows.map(toRecord));
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

  const openCreate = () =>
    setDraft({
      id: null,
      name: '',
      status: 'Recovery ongoing',
      severity: '',
      startedOn: '',
      endedOn: '',
      doctor: '',
      diagnosis: '',
      notes: '',
      symptoms: '',
      medication: '',
      dosage: '',
    });

  const openEdit = (record: Record_) => {
    setSelected(null);
    setDraft({
      id: record.id,
      name: record.name,
      status: record.status,
      severity: record.severity ?? '',
      startedOn: record.startedOn ?? '',
      endedOn: record.endedOn ?? '',
      doctor: record.doctor ?? '',
      diagnosis: record.diagnosis ?? '',
      notes: record.notes ?? '',
      // Symptoms and medications are their own rows; editing them here would
      // mean reconciling deletions, so an edit leaves the existing ones alone
      // and these add to them.
      symptoms: '',
      medication: '',
      dosage: '',
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      toast.show('Give the record a name.');
      return;
    }
    for (const [label, value] of [
      ['Start date', draft.startedOn],
      ['End date', draft.endedOn],
    ] as const) {
      if (value.trim() && !DATE_RE.test(value.trim())) {
        toast.show(`${label} should look like 2025-11-16.`);
        return;
      }
    }

    const body: Record<string, unknown> = { name };
    if (draft.status.trim()) body.status = draft.status.trim();
    if (draft.severity.trim()) body.severity = draft.severity.trim();
    if (draft.startedOn.trim()) body.started_on = draft.startedOn.trim();
    if (draft.endedOn.trim()) body.ended_on = draft.endedOn.trim();
    if (draft.doctor.trim()) body.doctor = draft.doctor.trim();
    if (draft.diagnosis.trim()) body.diagnosis = draft.diagnosis.trim();
    if (draft.notes.trim()) body.notes = draft.notes.trim();

    setSaving(true);
    try {
      const saved = draft.id
        ? ((await client.api.health.update(draft.id, body)) as Record<string, unknown>)
        : ((await client.api.health.create(body)) as Record<string, unknown>);
      const id = draft.id ?? (typeof saved?.id === 'string' ? saved.id : null);

      if (id) {
        // Each symptom is its own row; the field takes a comma-separated list.
        const symptoms = draft.symptoms
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
        for (const symptom of symptoms) {
          await client.api.health.addSymptom(id, { name: symptom }).catch(() => undefined);
        }
        if (draft.medication.trim()) {
          await client.api.health
            .addMedication(id, {
              name: draft.medication.trim(),
              ...(draft.dosage.trim() ? { dosage: draft.dosage.trim() } : {}),
            })
            .catch(() => undefined);
        }
      }

      setDraft(null);
      toast.show(draft.id ? 'Record updated' : 'Record added');
      await load();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Could not save that record.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (record: Record_) => {
    Alert.alert(
      'Delete record?',
      `"${record.name}" and everything filed under it will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSelected(null);
            try {
              await client.api.health.remove(record.id);
              toast.show('Record deleted');
              await load();
            } catch {
              toast.show('Could not delete that.');
              void load();
            }
          },
        },
      ],
    );
  };

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const record of records) {
      if (record.startedOn) set.add(new Date(record.startedOn).getFullYear().toString());
    }
    return ['All years', ...[...set].sort((a, b) => b.localeCompare(a))];
  }, [records]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      if (status !== 'All statuses' && record.status !== status) return false;
      if (year !== 'All years') {
        const recordYear = record.startedOn
          ? new Date(record.startedOn).getFullYear().toString()
          : '';
        if (recordYear !== year) return false;
      }
      if (!needle) return true;
      return (
        record.name.toLowerCase().includes(needle) ||
        record.symptoms.some((symptom) => symptom.toLowerCase().includes(needle)) ||
        (record.doctor ?? '').toLowerCase().includes(needle) ||
        (record.notes ?? '').toLowerCase().includes(needle)
      );
    });
  }, [records, query, status, year]);

  const totalMedications = records.reduce((sum, r) => sum + r.medications.length, 0);
  const totalDocuments = records.reduce((sum, r) => sum + r.documents.length, 0);

  /** `healthStats` — the three tiles, with the web's labels. */
  const stats: { icon: IconName; value: number; label: string }[] = [
    { icon: 'pulse', value: records.length, label: 'Total illnesses recorded' },
    { icon: 'medical', value: totalMedications, label: 'Total medication records' },
    { icon: 'document-text', value: totalDocuments, label: 'Medical documents saved' },
  ];

  if (loading) return <Loading />;

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
        <PageHeading
          eyebrow="Personal health history"
          title="Your health, clearly organized."
          lede="A private record of past illnesses, symptoms, medications, and recovery."
          actionIcon="add"
          actionLabel="Add a record"
          onAction={openCreate}
        />

        {!!error && <DataBanner message={error} error />}

        {/* `.health-privacy-note` */}
        <FadeIn index={1}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
              marginBottom: 18,
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderWidth: 1,
              borderColor: colors.divider,
              borderRadius: radius.md,
              backgroundColor: 'rgba(255,255,255,0.035)',
            }}
          >
            <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
            <Text style={{ flex: 1, color: colors.textMuted, fontSize: 12.5, lineHeight: 18 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                Personal reference only.{' '}
              </Text>
              You decide what to record. MyPro does not provide medical advice, and the assistant
              cannot read any of this without a grant you give it.
            </Text>
          </View>
        </FadeIn>

        {/* `.health-overview` — three tiles across. */}
        <FadeIn index={2}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {stats.map((stat) => (
              <View
                key={stat.label}
                style={{
                  flex: 1,
                  minHeight: 112,
                  paddingHorizontal: 12,
                  paddingVertical: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.card,
                  backgroundColor: colors.surface,
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 11,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: colors.divider,
                    backgroundColor: 'rgba(255,255,255,0.05)',
                  }}
                >
                  <Ionicons
                    name={stat.icon}
                    size={16}
                    color={colorMode ? accent : colors.text}
                  />
                </View>
                <View>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 24,
                      fontWeight: '600',
                      letterSpacing: -1,
                    }}
                  >
                    {stat.value}
                  </Text>
                  <Text
                    style={{
                      color: colors.textSoft,
                      fontSize: 11,
                      lineHeight: 14,
                      marginTop: 5,
                    }}
                  >
                    {stat.label}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </FadeIn>

        {/* `.illness-history-card` */}
        <FadeIn index={3} style={{ marginTop: 12 }}>
          <Card>
            <CardHeading kicker="Illness history" title="Previous sickness episodes" />

            {/* `.health-history-filters` */}
            <View
              style={{
                height: 46,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 14,
                borderWidth: 1,
                borderColor: colors.borderStrong,
                borderRadius: radius.md,
                backgroundColor: 'rgba(255,255,255,0.04)',
              }}
            >
              <Ionicons name="search" size={15} color={colors.textSoft} />
              <TextInput
                style={{ flex: 1, color: colors.text, fontSize: 16, paddingVertical: 0 }}
                placeholder="Search illness or symptom"
                placeholderTextColor="rgba(255,255,255,0.44)"
                value={query}
                onChangeText={setQuery}
                accessibilityLabel="Search illness or symptom"
              />
            </View>

            {records.length > 0 && (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: 10, flexGrow: 0 }}
                  contentContainerStyle={{ gap: 6 }}
                >
                  {STATUSES.map((option) => (
                    <FilterChip
                      key={option}
                      label={option}
                      active={status === option}
                      onPress={() => setStatus(option)}
                    />
                  ))}
                </ScrollView>

                {years.length > 1 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginTop: 6, flexGrow: 0 }}
                    contentContainerStyle={{ gap: 6 }}
                  >
                    {years.map((option) => (
                      <FilterChip
                        key={option}
                        label={option}
                        active={year === option}
                        onPress={() => setYear(option)}
                      />
                    ))}
                  </ScrollView>
                )}
              </>
            )}

            {/* `.illness-timeline` */}
            <View style={{ marginTop: 16 }}>
              {visible.length === 0 ? (
                <EmptyState
                  icon="clipboard-outline"
                  title={records.length ? 'No illness records found' : 'No records yet'}
                  body={
                    records.length
                      ? 'Try a different search, status or year.'
                      : 'Add illnesses, medications and documents in the web app; they will be here to look up.'
                  }
                />
              ) : (
                visible.map((record, index) => (
                  <TimelineRow
                    key={record.id}
                    record={record}
                    first={index === 0}
                    accent={colorMode ? accent : colors.text}
                    onPress={() => setSelected(record)}
                  />
                ))
              )}
            </View>
          </Card>
        </FadeIn>
      </ScrollView>

      {/* `.health-detail-modal`, a bottom sheet on mobile. */}
      <Sheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        kicker="Illness record"
        title={selected?.name}
      >
        {selected && (
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }}>
            <Text style={[type.meta, { marginBottom: space.md }]}>
              {dateLabel(selected.startedOn)} · {selected.status}
            </Text>

            <DetailSection icon="clipboard-outline" title="Basic information">
              <DetailGrid
                items={[
                  ['Illness', selected.name],
                  ['Started', dateLabel(selected.startedOn)],
                  ['Ended', dateLabel(selected.endedOn)],
                  ['Duration', duration(selected.startedOn, selected.endedOn)],
                  ['Severity', selected.severity ?? 'Not recorded'],
                  ['Recovery status', selected.status],
                ]}
              />
            </DetailSection>

            <DetailSection icon="thermometer-outline" title="Symptoms">
              {selected.symptoms.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                  {selected.symptoms.map((symptom) => (
                    <Tag key={symptom}>{symptom}</Tag>
                  ))}
                </View>
              )}
              <DetailGrid
                items={[
                  ['Symptoms began', dateLabel(selected.symptomStart)],
                  ['Recorded severity', selected.symptomSeverity ?? 'Not recorded'],
                  ['Observations', selected.symptomNotes ?? 'Not recorded'],
                ]}
              />
            </DetailSection>

            <DetailSection icon="medkit-outline" title="Medical consultation">
              <DetailGrid
                items={[
                  ['Doctor or hospital', selected.doctor ?? 'Not recorded'],
                  ['Consultation date', dateLabel(selected.consultationOn)],
                  ['Recorded diagnosis', selected.diagnosis ?? 'Not recorded'],
                  ['Medical notes', selected.notes ?? 'Not recorded'],
                ]}
              />
            </DetailSection>

            <DetailSection icon="medical-outline" title="Medication history">
              {selected.medications.length === 0 ? (
                <Text style={type.meta}>No medications recorded.</Text>
              ) : (
                selected.medications.map((medication) => (
                  <View key={medication.name} style={{ marginBottom: 12 }}>
                    <Text style={[type.h3, { marginBottom: 6 }]}>{medication.name}</Text>
                    <DetailGrid
                      items={[
                        ['Dosage', medication.dosage ?? 'Not recorded'],
                        ['Frequency', medication.frequency ?? 'Not recorded'],
                        ['Started', dateLabel(medication.startedOn)],
                        ['Ended', dateLabel(medication.endedOn)],
                        ['Reason', medication.reason ?? 'Not recorded'],
                        ['Observations', medication.notes ?? 'Not recorded'],
                      ]}
                    />
                  </View>
                ))
              )}
            </DetailSection>

            <DetailSection icon="document-text-outline" title="Documents">
              {selected.documents.length === 0 ? (
                <Text style={type.meta}>No documents saved against this record.</Text>
              ) : (
                <View style={{ gap: 8 }}>
                  {selected.documents.map((document) => (
                    <View
                      key={document.name}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}
                    >
                      <Ionicons name="document-outline" size={15} color={colors.textMuted} />
                      <Text style={{ flex: 1, color: colors.textStrong, fontSize: 13.5 }}>
                        {document.name}
                      </Text>
                      <Text style={type.label}>{document.kind}</Text>
                    </View>
                  ))}
                </View>
              )}
            </DetailSection>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <GhostButton
                label="Edit"
                onPress={() => openEdit(selected)}
                style={{ flex: 1 }}
              />
              <GhostButton
                label="Delete"
                onPress={() => confirmDelete(selected)}
                style={{ flex: 1 }}
              />
            </View>

            <Text style={[type.meta, { marginTop: 12 }]}>
              Symptoms and medications are kept as their own entries; adding more from the
              edit sheet adds to what is already there.
            </Text>
          </ScrollView>
        )}
      </Sheet>

      {/* `.health-form-modal`, which becomes a bottom sheet on mobile. */}
      <Sheet
        visible={!!draft}
        onClose={() => setDraft(null)}
        kicker={draft?.id ? 'Edit record' : 'New record'}
        title={draft?.id ? draft.name || 'Record' : 'Add an illness'}
      >
        {draft && (
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
            <View style={{ gap: 14 }}>
              <Field
                label="Illness"
                value={draft.name}
                onChange={(name) => setDraft({ ...draft, name })}
                placeholder="What was it?"
              />

              <View style={{ gap: 8 }}>
                <Text style={type.label}>Recovery status</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {STATUSES.filter((option) => option !== 'All statuses').map((option) => (
                    <FilterChip
                      key={option}
                      label={option}
                      active={draft.status === option}
                      onPress={() => setDraft({ ...draft, status: option })}
                    />
                  ))}
                </View>
              </View>

              <Field
                label="Severity"
                value={draft.severity}
                onChange={(severity) => setDraft({ ...draft, severity })}
                placeholder="Mild, moderate, severe…"
              />

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Started"
                    value={draft.startedOn}
                    onChange={(startedOn) => setDraft({ ...draft, startedOn })}
                    placeholder="2025-11-16"
                    keyboard="numbers-and-punctuation"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Ended"
                    value={draft.endedOn}
                    onChange={(endedOn) => setDraft({ ...draft, endedOn })}
                    placeholder="Leave blank if ongoing"
                    keyboard="numbers-and-punctuation"
                  />
                </View>
              </View>

              <Field
                label="Symptoms"
                value={draft.symptoms}
                onChange={(symptoms) => setDraft({ ...draft, symptoms })}
                placeholder="Separate with commas"
              />

              <Field
                label="Doctor or hospital"
                value={draft.doctor}
                onChange={(doctor) => setDraft({ ...draft, doctor })}
                placeholder="Who you saw"
              />

              <Field
                label="Recorded diagnosis"
                value={draft.diagnosis}
                onChange={(diagnosis) => setDraft({ ...draft, diagnosis })}
                placeholder="What you were told"
              />

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Medication"
                    value={draft.medication}
                    onChange={(medication) => setDraft({ ...draft, medication })}
                    placeholder="Name"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Dosage"
                    value={draft.dosage}
                    onChange={(dosage) => setDraft({ ...draft, dosage })}
                    placeholder="e.g. 500mg"
                  />
                </View>
              </View>

              <Field
                label="Notes"
                value={draft.notes}
                onChange={(notes) => setDraft({ ...draft, notes })}
                placeholder="Anything worth remembering"
                multiline
              />

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <GhostButton
                  label="Cancel"
                  onPress={() => setDraft(null)}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label={draft.id ? 'Save' : 'Add record'}
                  onPress={() => void saveDraft()}
                  busy={saving}
                  disabled={!draft.name.trim()}
                  style={{ flex: 1 }}
                />
              </View>

              <Text style={type.meta}>
                Your own record, kept for you. MyPro gives no medical advice, and the
                assistant cannot read any of this without a grant you give it.
              </Text>
            </View>
          </ScrollView>
        )}
      </Sheet>
    </View>
  );
}

/** A labelled text field in the record form. */
function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboard,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboard?: 'default' | 'numbers-and-punctuation';
}) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={type.label}>{label}</Text>
      <TextInput
        style={[shared.input, multiline && { minHeight: 80, textAlignVertical: 'top' }]}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.44)"
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={keyboard ?? 'default'}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** `.illness-record-row` — a timeline dot, a date, and the record's panel. */
function TimelineRow({
  record,
  first,
  accent,
  onPress,
}: {
  record: Record_;
  first: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 9,
        paddingVertical: 15,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.dividerFaint,
      }}
    >
      {/* `.illness-timeline-dot`, over the timeline's hairline. */}
      <View style={{ width: 10, alignItems: 'center', paddingTop: 7 }}>
        <View
          style={{
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: accent,
          }}
        />
        <View
          style={{
            flex: 1,
            width: 1,
            marginTop: 6,
            backgroundColor: colors.divider,
          }}
        />
      </View>

      {/* `.illness-record-content` */}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Open ${record.name}`}
        style={({ pressed }) => ({
          flex: 1,
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderWidth: 1,
          borderColor: colors.divider,
          borderRadius: 15,
          backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.025)',
          gap: 8,
        })}
      >
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
            {record.name}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>
            {dateLabel(record.startedOn)}
            {record.endedOn ? ` — ${dateLabel(record.endedOn)}` : ''}
          </Text>
        </View>

        {/* `.recovery-status` */}
        <View style={{ flexDirection: 'row' }}>
          <View
            style={{
              paddingHorizontal: 9,
              paddingVertical: 5,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.divider,
            }}
          >
            <Text style={{ color: colors.textMuted, fontSize: 11.5 }}>{record.status}</Text>
          </View>
        </View>

        {/* `.symptom-tags` */}
        {record.symptoms.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {record.symptoms.slice(0, 4).map((symptom) => (
              <Tag key={symptom}>{symptom}</Tag>
            ))}
            {record.symptoms.length > 4 && <Tag>{`+${record.symptoms.length - 4}`}</Tag>}
          </View>
        )}

        {/* `.illness-record-footer` */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 2,
          }}
        >
          <Text style={{ flex: 1, color: colors.textSoft, fontSize: 12.5 }} numberOfLines={1}>
            {record.medications.length
              ? `${record.medications.length} medication${
                  record.medications.length === 1 ? '' : 's'
                }`
              : 'No medications'}
            {record.documents.length ? ` · ${record.documents.length} document(s)` : ''}
          </Text>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>View</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
        </View>
      </Pressable>
    </View>
  );
}

/** `.health-detail-section` — an icon, a title, and the section's content. */
function DetailSection({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: colors.divider,
            backgroundColor: 'rgba(255,255,255,0.05)',
          }}
        >
          <Ionicons name={icon} size={14} color={colors.textMuted} />
        </View>
        <Kicker>{title}</Kicker>
      </View>
      {children}
    </View>
  );
}

/** `DetailGrid` — label over value, one per row on a phone. */
function DetailGrid({ items }: { items: [string, string][] }) {
  return (
    <View style={{ gap: 10 }}>
      {items.map(([label, value]) => (
        <View key={label} style={{ gap: 2 }}>
          <Text style={{ color: colors.textFaint, fontSize: 11.5 }}>{label}</Text>
          <Text style={{ color: colors.textStrong, fontSize: 14, lineHeight: 20 }}>{value}</Text>
        </View>
      ))}
    </View>
  );
}
