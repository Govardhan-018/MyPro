/**
 * Web view of the typed API client. The client is built in `./client` via
 * `@mypro/shared` (with the browser's global fetch and Supabase session); this
 * module re-exports it, plus the error classes and every row type, under the
 * import path (`@/lib/api`) the app already uses.
 */
import { client } from './client';

export const api = client.api;
export const forgetAgentBase = client.forgetAgentBase;

export { ApiError, AgentOfflineError } from '@mypro/shared';

export type {
  AnnotationKind,
  LibraryType,
  LibraryItemRow,
  AnnotationRow,
  ScheduleRow,
  AssistantMessageRow,
  AssistantSettingsRow,
  ReceiptRow,
  SendResult,
  PendingActionRow,
  SkillRow,
  NotificationRow,
  NodeStatus,
} from '@mypro/shared';
