import type { EnvConfig } from './platform';
import type { Auth } from './auth';
import { assertAgentConfigured, assertApiConfigured } from './env';
import type {
  AnnotationKind,
  AnnotationRow,
  AssistantMessageRow,
  AssistantSettingsRow,
  LibraryItemRow,
  LibraryType,
  NodeStatus,
  NotificationRow,
  PendingActionRow,
  ReceiptRow,
  ScheduleRow,
  SendResult,
  SkillRow,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AgentOfflineError extends Error {
  constructor() {
    super('Your laptop agent is offline');
    this.name = 'AgentOfflineError';
  }
}

type Query = Record<string, string | number | boolean | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** 'api' → backend-render (always on) · 'agent' → backend-local (laptop). */
type Base = 'api' | 'agent';

const AGENT_CACHE_MS = 60_000;

/** What {@link createApi} returns: the typed client plus the agent-cache reset. */
export type ApiClient = ReturnType<typeof createApi>;

/**
 * Build the typed API client. Everything host-specific is injected:
 *   - `env`    resolved configuration (which URLs, whether configured)
 *   - `auth`   source of the bearer token (and, implicitly, the session)
 *   - `fetchImpl` the fetch to use (web/RN global, or a test double)
 *
 * The laptop's URL is normally ephemeral (a Cloudflare quick tunnel changes on
 * every start), so it is discovered from node_status via render rather than
 * baked in. `env.agentUrl`, when set, wins — use it for a fixed tunnel or local
 * development.
 */
export function createApi(
  env: EnvConfig,
  auth: Pick<Auth, 'getAccessToken'>,
  fetchImpl?: typeof fetch,
) {
  const doFetch: typeof fetch =
    fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

  let agentBase: { url: string; at: number } | null = null;

  async function resolveAgentBase(): Promise<string> {
    if (env.agentUrl) return env.agentUrl;
    if (agentBase && Date.now() - agentBase.at < AGENT_CACHE_MS) return agentBase.url;

    assertApiConfigured(env);
    const status = await api.nodes.status().catch(() => null);
    const base = status?.agent?.online ? status.agent.base_url : null;
    if (!base) {
      agentBase = null;
      throw new AgentOfflineError();
    }
    const url = `${base.replace(/\/$/, '')}/api/v1`;
    agentBase = { url, at: Date.now() };
    return url;
  }

  /** Call after a failed agent request so the next one re-discovers. */
  function forgetAgentBase(): void {
    agentBase = null;
  }

  async function request<T>(
    base: Base,
    method: string,
    path: string,
    body?: unknown,
    query?: Query,
  ): Promise<T> {
    let root: string;
    if (base === 'agent') {
      // Only the Supabase half must be configured; the URL may be discovered.
      assertAgentConfigured(env);
      root = await resolveAgentBase();
    } else {
      assertApiConfigured(env);
      root = env.apiUrl;
    }

    const token = await auth.getAccessToken();
    if (!token) throw new ApiError('Not signed in', 401);

    const res = await doFetch(`${root}${withQuery(path, query)}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const parsed: unknown = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const message =
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : `Request failed (${res.status})`;
      throw new ApiError(message, res.status);
    }
    return parsed as T;
  }

  const get = <T>(path: string, query?: Query) => request<T>('api', 'GET', path, undefined, query);
  const post = <T>(path: string, body?: unknown) => request<T>('api', 'POST', path, body);
  const patch = <T>(path: string, body?: unknown) => request<T>('api', 'PATCH', path, body);
  const del = <T>(path: string) => request<T>('api', 'DELETE', path);

  // The personal agent on your laptop — assistant traffic only.
  const agentGet = <T>(path: string, query?: Query) =>
    request<T>('agent', 'GET', path, undefined, query);
  const agentPost = <T>(path: string, body?: unknown) => request<T>('agent', 'POST', path, body);
  const agentPatch = <T>(path: string, body?: unknown) => request<T>('agent', 'PATCH', path, body);

  const api = {
    profile: {
      get: () => get<Record<string, unknown>>('/me'),
      update: (patchBody: Record<string, unknown>) => patch('/me', patchBody),
      heartbeat: (client = 'web') => post('/me/activity', { client }),
    },

    library: {
      list: (q?: { type?: string; status?: string; q?: string }) =>
        get<LibraryItemRow[]>('/library', q),
      get: (id: string) => get<LibraryItemRow>(`/library/${id}`),
      create: (body: {
        type: LibraryType;
        title: string;
        creator?: string;
        status?: string;
        progress?: number;
        cover_url?: string;
        tone?: string;
        details?: Record<string, unknown>;
      }) => post<LibraryItemRow>('/library', body),
      update: (id: string, body: Record<string, unknown>) =>
        patch<LibraryItemRow>(`/library/${id}`, body),
      remove: (id: string) => del(`/library/${id}`),
    },

    collections: {
      list: () => get<Record<string, unknown>[]>('/collections'),
      create: (name: string, sort_order = 0) => post('/collections', { name, sort_order }),
      update: (id: string, body: { name?: string; sort_order?: number }) =>
        patch(`/collections/${id}`, body),
      remove: (id: string) => del(`/collections/${id}`),
      addItem: (id: string, itemId: string) => post(`/collections/${id}/items/${itemId}`),
      removeItem: (id: string, itemId: string) => del(`/collections/${id}/items/${itemId}`),
    },

    reader: {
      annotations: (itemId: string) => get<AnnotationRow[]>(`/library/${itemId}/annotations`),
      createAnnotation: (
        itemId: string,
        body: Partial<AnnotationRow> & { kind: AnnotationKind; tags?: string[] },
      ) => post<AnnotationRow>(`/library/${itemId}/annotations`, body),
      updateAnnotation: (id: string, body: Partial<AnnotationRow> & { tags?: string[] }) =>
        patch<AnnotationRow>(`/annotations/${id}`, body),
      deleteAnnotation: (id: string) => del(`/annotations/${id}`),

      bookmarks: (itemId: string) =>
        get<Record<string, unknown>[]>(`/library/${itemId}/bookmarks`),
      createBookmark: (itemId: string, body: { page: number; title?: string }) =>
        post(`/library/${itemId}/bookmarks`, body),
      deleteBookmark: (id: string) => del(`/bookmarks/${id}`),

      readingSession: (itemId: string, body: Record<string, unknown>) =>
        post(`/library/${itemId}/reading-sessions`, body),
      listeningSession: (itemId: string, body: Record<string, unknown>) =>
        post(`/library/${itemId}/listening-sessions`, body),
    },

    knowledge: {
      get: () =>
        get<{ annotations: Record<string, unknown>[]; bookmarks: Record<string, unknown>[] }>(
          '/knowledge',
        ),
    },

    calendar: {
      events: (range?: { from?: string; to?: string }) =>
        get<Record<string, unknown>[]>('/calendar/events', range),
      createEvent: (body: Record<string, unknown>) => post('/calendar/events', body),
      updateEvent: (id: string, body: Record<string, unknown>) =>
        patch(`/calendar/events/${id}`, body),
      deleteEvent: (id: string) => del(`/calendar/events/${id}`),
      categories: () => get<Record<string, unknown>[]>('/calendar/categories'),
      createCategory: (name: string, tone?: string) =>
        post('/calendar/categories', { name, tone }),
      deleteCategory: (id: string) => del(`/calendar/categories/${id}`),
    },

    tasks: {
      list: (status?: string) => get<Record<string, unknown>[]>('/tasks', { status }),
      create: (body: Record<string, unknown>) => post('/tasks', body),
      update: (id: string, body: Record<string, unknown>) => patch(`/tasks/${id}`, body),
      remove: (id: string) => del(`/tasks/${id}`),
    },

    health: {
      records: () => get<Record<string, unknown>[]>('/health/records'),
      create: (body: Record<string, unknown>) => post('/health/records', body),
      update: (id: string, body: Record<string, unknown>) => patch(`/health/records/${id}`, body),
      remove: (id: string) => del(`/health/records/${id}`),
      addSymptom: (id: string, body: Record<string, unknown>) =>
        post(`/health/records/${id}/symptoms`, body),
      addMedication: (id: string, body: Record<string, unknown>) =>
        post(`/health/records/${id}/medications`, body),
      addDocument: (id: string, body: Record<string, unknown>) =>
        post(`/health/records/${id}/documents`, body),
      // assistant consent
      grant: () => get<Record<string, unknown> | null>('/health/grant'),
      createGrant: (minutes = 60, scope: 'read' | 'read_write' = 'read') =>
        post('/health/grant', { minutes, scope }),
      revokeGrant: () => del('/health/grant'),
    },

    notifications: {
      list: (unread = false) => get<NotificationRow[]>('/notifications', { unread }),
      markRead: (id: string) => patch(`/notifications/${id}/read`),
      markAllRead: () => patch('/notifications/read-all'),
    },

    devices: {
      list: () => get<Record<string, unknown>[]>('/devices'),
      register: (body: {
        channel_type: 'web_push' | 'fcm' | 'telegram';
        token: string;
        platform?: string;
      }) => post('/devices', body),
      remove: (id: string) => del(`/devices/${id}`),
      channels: () => get<Record<string, unknown>[]>('/devices/channels'),
      setChannel: (type: string, enabled: boolean) =>
        post('/devices/channels', { type, enabled }),
    },

    gmail: {
      accounts: () => get<Record<string, unknown>[]>('/gmail/accounts'),
      removeAccount: (id: string) => del(`/gmail/accounts/${id}`),
      messages: (accountId?: string, limit = 50) =>
        get<Record<string, unknown>[]>('/gmail/messages', { accountId, limit }),
    },

    schedules: {
      list: () => get<ScheduleRow[]>('/schedules'),
      get: (id: string) => get<ScheduleRow>(`/schedules/${id}`),
      create: (body: Record<string, unknown>) => post<ScheduleRow>('/schedules', body),
      update: (id: string, body: Record<string, unknown>) =>
        patch<ScheduleRow>(`/schedules/${id}`, body),
      remove: (id: string) => del(`/schedules/${id}`),
      runs: (id: string) => get<Record<string, unknown>[]>(`/schedules/${id}/runs`),
    },

    /** All assistant traffic goes straight to the laptop (backend-local). */
    assistant: {
      conversation: () => agentGet<Record<string, unknown>>('/assistant/conversation'),
      messages: (limit = 50) => agentGet<AssistantMessageRow[]>('/assistant/messages', { limit }),
      /** Returns the reply plus receipts for anything it did along the way. */
      send: (content: string) => agentPost<SendResult>('/assistant/messages', { content }),
      clear: (mode: 'wipe' | 'archive' = 'wipe') => agentPost('/assistant/clear', { mode }),
      settings: () => agentGet<AssistantSettingsRow>('/assistant/settings'),
      updateSettings: (body: Partial<AssistantSettingsRow>) =>
        agentPatch<AssistantSettingsRow>('/assistant/settings', body),
      persona: () => agentGet<Record<string, unknown>>('/assistant/persona'),
      updatePersona: (body: Record<string, unknown>) => agentPatch('/assistant/persona', body),
    },

    /** What the companion can do, what it did, and what awaits your approval. */
    skills: {
      list: () => agentGet<SkillRow[]>('/skills'),
      invocations: () => agentGet<ReceiptRow[]>('/skills/invocations'),
      pending: () => agentGet<PendingActionRow[]>('/skills/pending'),
      approve: (id: string) =>
        agentPost<{ ok: boolean; executed: boolean; reason?: string }>(
          `/skills/pending/${id}/approve`,
        ),
      reject: (id: string) => agentPost<{ ok: boolean }>(`/skills/pending/${id}/reject`),
    },

    /** Presence — lets the UI grey the assistant out when the laptop is asleep. */
    nodes: {
      status: () => get<NodeStatus>('/nodes/status'),
    },
  };

  return { api, forgetAgentBase };
}
