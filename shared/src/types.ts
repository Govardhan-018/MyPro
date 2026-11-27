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
  /** Attempts made at the current occurrence; > 0 while a retry is pending. */
  deferred_count?: number;
  assistant_schedule_days?: { day_of_week: number }[];
  /** The most recent run, when the API includes it (`GET /schedules`). */
  last_run?: {
    status: 'success' | 'failed' | 'skipped' | 'pending_confirmation' | 'deferred' | 'retrying';
    detail: string | null;
    ran_at: string;
  } | null;
}

export type CommitmentKind = 'promise' | 'goal' | 'decision' | 'intention';
export type CommitmentState = 'open' | 'at_risk' | 'done' | 'slipped' | 'abandoned';

/**
 * An open loop (Phase 16.1) — a thing the user said they'd do, with a believed
 * deadline and a state the companion follows up on. Distinct from a task.
 */
export interface CommitmentRow {
  id: string;
  title: string;
  detail: string | null;
  kind: CommitmentKind;
  due_at: string | null;
  confidence: number;
  state: CommitmentState;
  source_message_id: string | null;
  next_checkin_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface AssistantMessageRow {
  /** Present on stored assistant turns once migration 0017 is applied. */
  blocks?: DisplayBlock[] | null;
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
  /** How hard the agent thinks. Optional: absent until migration 0012 lands. */
  effort_mode?: EffortMode;
}

/**
 * Light is one cheap pass, Default is the everyday companion, Deep plans
 * explicitly and reads more of your history. Budgets live on the agent
 * (`backend-local/src/agent/effort.ts`); this is just the dial.
 */
export type EffortMode = 'light' | 'default' | 'deep';

/**
 * What the agent set out to do this turn, and what the receipt trail says
 * actually happened. `status` is settled against `skill_invocations`, never
 * against the model's own account — so `verified` means verified.
 */
export interface AgentPlanStepSummary {
  id: string;
  goal: string;
  capability: string;
  status: 'pending' | 'verified' | 'queued' | 'failed' | 'not_attempted';
}

/**
 * A card rendered under a reply. Built on the agent from what the tools
 * actually returned, never from the model's prose — so a source shown here
 * was genuinely fetched, and a date shown here came from the provider.
 */
export type DisplayBlock =
  | {
      kind: 'sources';
      from: string;
      items: {
        title: string;
        url: string;
        publisher?: string;
        published_at?: string;
        snippet?: string;
      }[];
    }
  | {
      kind: 'fixtures';
      from: string;
      resolved?: { kind: string; name: string; team: string; sport?: string };
      items: {
        home: string;
        away: string;
        starts_at?: string;
        /** No confirmed kickoff — never render midnight as a time. */
        time_unknown?: boolean;
        venue?: string;
        status?: string;
        score?: string;
        league?: string;
      }[];
    }
  | {
      kind: 'weather';
      from: string;
      place: string;
      timezone?: string;
      now?: { temperature_c?: number; summary?: string; wind_kph?: number };
      days: {
        date: string;
        min_c?: number;
        max_c?: number;
        precipitation_chance?: number;
        summary?: string;
      }[];
    };

export interface AgentTurnSummary {
  mode: EffortMode;
  /** The capabilities offered to the model this turn, strongest first. */
  capabilities: string[];
  model_calls: number;
  /** Null when the request did not warrant an agenda. */
  plan: { intent: string; steps: AgentPlanStepSummary[] } | null;
  /** Cards to render under the reply. Empty for a plain conversational turn. */
  blocks?: DisplayBlock[];
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

/**
 * Something the companion watches for you (Phase 20.6).
 *
 * Distinct from a remembered fact: memory records that something is true
 * about you, an interest is a standing instruction to go and look.
 */
export interface InterestRow {
  id: string;
  entity: string;
  category: 'team' | 'player' | 'company' | 'technology' | 'person' | 'topic' | 'other';
  aliases: string[];
  /** 1 mildly curious … 5 tell me quickly. */
  interest_level: number;
  importance_threshold: number;
  /** push interrupts, chat waits in the thread, none just collects. */
  notify: 'push' | 'chat' | 'none';
  check_every_hours: number;
  active: boolean;
  last_checked_at: string | null;
  created_at: string;
}

/** What one check turned up — the "why am I being told this?" trail. */
export interface InterestFindingRow {
  id: string;
  interest_id: string;
  title: string;
  url: string | null;
  publisher: string | null;
  published_at: string | null;
  importance: number | null;
  outcome: 'delivered' | 'suppressed' | 'stored';
  reason: string | null;
  created_at: string;
}

export interface StravaStatus {
  /** False when the server has no Strava app configured at all. */
  configured: boolean;
  account: {
    id: string;
    athlete_name: string | null;
    scopes: string | null;
    created_at: string;
    last_synced_at: string | null;
  } | null;
}

/** One research kind and which external services would answer it right now. */
export interface ResearchProviderRow {
  /** search | news | sports | extract | weather */
  kind: string;
  /** Tried left to right; a failure falls through to the next. */
  active: { id: string; free: boolean; note: string }[];
  /** Installed but switched off, usually for want of a key. */
  inactive: string[];
}

/** `GET /assistant/capabilities` — the registry readout, derived from code. */
export interface AgentCapabilityReadout {
  effort: {
    current: EffortMode;
    modes: readonly EffortMode[];
    /** The active budget. Shape follows the agent; treat as advisory. */
    budget: Record<string, unknown>;
  };
  /** Absent on an agent older than Phase 20. */
  research_providers?: ResearchProviderRow[];
  capabilities: {
    name: string;
    version: string;
    category: string;
    description: string;
    permission: 'read' | 'write' | 'outward';
    requires_grant: string | null;
    enabled: boolean;
  }[];
}

/** `GET /assistant/plans` — one planned turn and how each step landed. */
export interface AgentPlanRow {
  id: string;
  request: string;
  intent: string | null;
  mode: EffortMode;
  status: 'running' | 'completed' | 'partial' | 'failed';
  step_count: number;
  created_at: string;
  completed_at: string | null;
  steps: {
    step_key: string;
    ordinal: number;
    goal: string;
    capability: string;
    status: AgentPlanStepSummary['status'];
    detail: string | null;
  }[];
}

export interface SendResult {
  message: AssistantMessageRow;
  receipts: ReceiptRow[];
  /** Added in Phase 19. Absent from older agents, so always optional. */
  agent?: AgentTurnSummary;
}

export interface PendingActionRow {
  id: string;
  skill: string;
  args: Record<string, unknown>;
  summary: string | null;
  state: string;
  created_at: string;
  expires_at: string;
  /** Why the last attempt did not go through (shown so it can be fixed and retried). */
  result?: string | null;
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
  /** In-app route a tap opens, e.g. '/assistant'. */
  deeplink?: string | null;
  /** The schedule that produced it, if any. */
  schedule_id?: string | null;
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
  /** `<source id>:<ISO instant>` — stable, so a re-arm replaces rather than duplicates. */
  id: string;
  /** The source row's id. A schedule id for `kind:'schedule'`, an event id for `kind:'calendar'`. */
  schedule_id: string;
  name: string;
  action_type: 'notify' | 'report' | 'email' | 'chat_message';
  title: string;
  body: string | null;
  /** ISO 8601, UTC. */
  at: string;
  /**
   * What produced this moment. `'schedule'` is a standing assistant schedule;
   * `'calendar'` is a calendar event's reminder (1h before and at the start,
   * plus any custom reminders). Optional for back-compat — absent means
   * `'schedule'`.
   */
  kind?: 'schedule' | 'calendar';
  /** Which app section tapping the notification should open. */
  deeplink?: 'today' | 'calendar' | 'assistant' | 'schedules';
  /** The specific row to focus on tap (a calendar event id), if any. */
  deeplink_id?: string;
  /** The focused item's instant, so the app can jump to the right day. */
  deeplink_at?: string;
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
  /**
   * The space-separated OAuth scopes this mailbox was connected with. Presence
   * of `gmail.send` is what distinguishes a read-only mailbox from one MyPro
   * may reply from. Null on rows connected before scopes were recorded.
   */
  scopes: string | null;
  sync_state: 'idle' | 'syncing' | 'error' | string;
  sync_error: string | null;
  /** Non-null once a first backfill has completed. */
  history_id: string | null;
  created_at: string;
}

/** The access a mailbox is connected with (mirror of the server's union). */
export type GmailAccessLevel = 'read' | 'send';

/** Whether a stored scope string grants send. Shared by client and server. */
export function gmailScopesGrantSend(scopes: string | null | undefined): boolean {
  return (scopes ?? '').split(/\s+/).filter(Boolean).includes(
    'https://www.googleapis.com/auth/gmail.send',
  );
}
