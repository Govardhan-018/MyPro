import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';

export type IllnessMedication = {
  name: string;
  dosage?: string;
  frequency?: string;
  startDate?: string;
  endDate?: string;
  reason?: string;
  observations?: string;
};

export type IllnessDocument = {
  name: string;
  type: string;
};

export type IllnessRecord = {
  id: number;
  /** Server UUID when the record is persisted (used for update). */
  serverId?: string;
  name: string;
  startDate?: string;
  endDate?: string;
  status: 'Recovered' | 'Recovery ongoing' | 'Incomplete record';
  severity?: string;
  symptoms: string[];
  symptomStart?: string;
  symptomSeverity?: string;
  symptomNotes?: string;
  doctor?: string;
  diagnosis?: string;
  consultationDate?: string;
  medicalNotes?: string;
  medications: IllnessMedication[];
  documents: IllnessDocument[];
  recoveryDate?: string;
  recoveryHelp?: string;
  recoveryNotes?: string;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
const isoDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

function clean(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

/** Stable numeric key from a UUID (for React keys; local records keep Date.now()). */
function hashNum(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

function rowToRecord(row: Record<string, unknown>): IllnessRecord {
  const symptoms = arr(row.health_symptoms);
  const meds = arr(row.health_medications);
  const docs = arr(row.health_documents);
  const first = symptoms[0] ?? {};
  return {
    id: hashNum(String(row.id)),
    serverId: String(row.id),
    name: str(row.name) ?? 'Untitled illness record',
    startDate: str(row.started_on),
    endDate: str(row.ended_on),
    status: (str(row.status) as IllnessRecord['status']) ?? 'Incomplete record',
    severity: str(row.severity),
    symptoms: symptoms.map((s) => str(s.name) ?? '').filter(Boolean),
    symptomStart: str(first.started_on),
    symptomSeverity: str(first.severity),
    symptomNotes: str(first.notes),
    doctor: str(row.doctor),
    diagnosis: str(row.diagnosis),
    consultationDate: str(row.consultation_on),
    medicalNotes: str(row.notes),
    medications: meds.map((m) => ({
      name: str(m.name) ?? '',
      dosage: str(m.dosage),
      frequency: str(m.frequency),
      startDate: str(m.started_on),
      endDate: str(m.ended_on),
      reason: str(m.reason),
      observations: str(m.observations),
    })),
    documents: docs.map((d) => ({ name: str(d.filename) ?? '', type: str(d.kind) ?? 'Document' })),
  };
}

function recordToBody(record: IllnessRecord): Record<string, unknown> {
  return clean({
    name: record.name,
    status: record.status,
    severity: record.severity,
    started_on: isoDate(record.startDate),
    ended_on: isoDate(record.endDate ?? record.recoveryDate),
    diagnosis: record.diagnosis,
    doctor: record.doctor,
    consultation_on: isoDate(record.consultationDate),
    notes: record.medicalNotes,
  });
}

function symptomBodies(record: IllnessRecord): Record<string, unknown>[] {
  return record.symptoms.map((name, i) =>
    clean({
      name,
      started_on: i === 0 ? isoDate(record.symptomStart) : undefined,
      severity: i === 0 ? record.symptomSeverity : undefined,
      notes: i === 0 ? record.symptomNotes : undefined,
    }),
  );
}

export interface HealthState {
  records: IllnessRecord[];
  loading: boolean;
  error: string | null;
  configured: boolean;
  /** Create or update; persists the record (+ children on create) when configured. */
  saveRecord: (record: IllnessRecord, editing: boolean) => Promise<IllnessRecord>;
}

export function useHealth(seed: IllnessRecord[]): HealthState {
  const configured = isApiConfigured;
  const [records, setRecords] = useState<IllnessRecord[]>(configured ? [] : seed);
  const [loading, setLoading] = useState<boolean>(configured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    api.health
      .records()
      .then((rows) => {
        if (!active) return;
        setRecords(rows.map(rowToRecord));
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof ApiError ? caught.message : 'Could not load your records.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [configured]);

  const saveRecord = async (record: IllnessRecord, editing: boolean) => {
    if (!configured) {
      setRecords((cur) =>
        editing ? cur.map((r) => (r.id === record.id ? record : r)) : [record, ...cur],
      );
      return record;
    }
    if (editing && record.serverId) {
      await api.health.update(record.serverId, recordToBody(record));
      // Note: child rows (symptoms/meds/docs) aren't re-synced on edit yet.
      setRecords((cur) => cur.map((r) => (r.id === record.id ? record : r)));
      return record;
    }
    const row = (await api.health.create(recordToBody(record))) as { id: string };
    const id = String(row.id);
    for (const body of symptomBodies(record)) api.health.addSymptom(id, body).catch(() => {});
    for (const m of record.medications) {
      api.health
        .addMedication(
          id,
          clean({
            name: m.name,
            dosage: m.dosage,
            frequency: m.frequency,
            started_on: isoDate(m.startDate),
            ended_on: isoDate(m.endDate),
            reason: m.reason,
            observations: m.observations,
          }),
        )
        .catch(() => {});
    }
    for (const d of record.documents) {
      api.health.addDocument(id, clean({ filename: d.name, kind: d.type })).catch(() => {});
    }
    const saved = { ...record, serverId: id };
    setRecords((cur) => [saved, ...cur]);
    return saved;
  };

  return { records, loading, error, configured, saveRecord };
}
