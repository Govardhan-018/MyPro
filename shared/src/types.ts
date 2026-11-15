/**
 * Row/DTO shapes. These mirror the database rows and the backend-render /
 * backend-local responses; widen them as the backends grow. Shared verbatim by
 * the web app and the Android app.
 */

export type AnnotationKind = 'note' | 'quote' | 'summary' | 'question' | 'highlight';
export type LibraryType = 'book' | 'podcast' | 'article' | 'note';

export interface LibraryItemRow {
  id: string;
  type: LibraryType;
  title: string;
  creator: string | null;
  status: string;
  progress: number;
  cover_url: string | null;
  tone: string | null;
  accessed_at: string | null;
  book_details?: Record<string, unknown> | null;
  podcast_details?: Record<string, unknown> | null;
  article_details?: Record<string, unknown> | null;
  note_details?: Record<string, unknown> | null;
}

export interface AnnotationRow {
  id: string;
  library_item_id: string;
  kind: AnnotationKind;
  page: number | null;
  paragraph: number | null;
  anchor_text: string | null;
  title: string | null;
  body: string | null;
  color: string | null;
  chapter: string | null;
  created_at: string;
}

export interface ScheduleRow {
  id: string;
  name: string;
  description?: string | null;
  action_type: 'notify' | 'report' | 'email' | 'chat_message';
  action_payload: Record<string, unknown>;
  channel: string;
  recurrence: 'once' | 'daily' | 'weekly' | 'monthly' | 'cron';
  run_at: string | null;
  time_of_day: string | null;
  day_of_month: number | null;
  cron_expr: string | null;
  timezone: string;
  enabled: boolean;
  requires_confirmation: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  assistant_schedule_days?: { day_of_week: number }[];
}

export interface AssistantMessageRow {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | null;
  created_at: string;
}

export interface AssistantSettingsRow {
  context_message_limit: number;
  model: string | null;
  temperature: number;
  allow_auto_send_email: boolean;
}

/** A thing the companion actually did, rendered as a card in the chat. */
export interface ReceiptRow {
  id: string;
  skill: string;
  side_effect: 'read' | 'write' | 'outward';
  args: Record<string, unknown>;
  status: 'success' | 'failed' | 'needs_approval' | 'denied';
  summary: string;
  error?: string;
}

export interface SendResult {
  message: AssistantMessageRow;
  receipts: ReceiptRow[];
}

export interface PendingActionRow {
  id: string;
  skill: string;
  args: Record<string, unknown>;
  summary: string | null;
  state: string;
  created_at: string;
  expires_at: string;
}

export interface SkillRow {
  name: string;
  description: string;
  side_effect: 'read' | 'write' | 'outward';
  requires_grant: string | null;
}

export interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  kind: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NodeStatus {
  agent: {
    online: boolean;
    last_heartbeat_at: string | null;
    base_url: string | null;
  };
}

/**
 * One moment a schedule will fire, expanded server-side (Phase 11.2).
 *
 * The phone registers a local notification per occurrence and re-arms on
 * every launch, so the OS fires it whether or not the laptop is open and
 * whether or not render is awake. Flat on purpose: a notification needs a
 * time, something to say, and a stable id to deduplicate against.
 */
export interface ScheduleOccurrence {
  /** `<schedule id>:<ISO instant>` — stable, so a re-arm replaces rather than duplicates. */
  id: string;
  schedule_id: string;
  name: string;
  action_type: 'notify' | 'report' | 'email' | 'chat_message';
  title: string;
  body: string | null;
  /** ISO 8601, UTC. */
  at: string;
}

/**
 * A connected mailbox, as the client sees it (Phase 7.2).
 *
 * Token columns are never selected, let alone sent. `sync_error` carries the
 * one thing the user can act on — most often "reconnect this mailbox", which
 * is what the 7-day Testing-mode trap looks like from the outside.
 */
export interface GmailAccountRow {
  id: string;
  email: string;
  sync_state: 'idle' | 'syncing' | 'error' | string;
  sync_error: string | null;
  /** Non-null once a first backfill has completed. */
  history_id: string | null;
  created_at: string;
}
