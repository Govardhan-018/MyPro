/**
 * @mypro/shared — the platform-injected core shared by the web app and the
 * Android app. Give it a {@link Platform} and get back a configured client:
 *
 *   const { api, auth, env } = createClient({
 *     env: { apiUrl, agentUrl },   // Render only — auth is brokered by Render
 *     storage,                     // web: localStorage adapter; RN: AsyncStorage
 *   });
 */
import type { Platform } from './platform';
import { normalizeEnv } from './env';
import { createAuth } from './auth';
import { createApi } from './api';

export function createClient(platform: Platform) {
  const env = normalizeEnv(platform.env);
  const auth = createAuth(env, { storage: platform.storage, fetch: platform.fetch });
  const { api, forgetAgentBase } = createApi(env, auth, platform.fetch);
  return { env, auth, api, forgetAgentBase };
}

/** The fully-configured client, as returned by {@link createClient}. */
export type MyProClient = ReturnType<typeof createClient>;

export type { Platform, EnvConfig, AuthStorage } from './platform';
export {
  normalizeEnv,
  isApiConfigured,
  isAgentConfigured,
  isBackendConfigured,
  assertApiConfigured,
  assertAgentConfigured,
} from './env';
export {
  createAuth,
  type Auth,
  type AuthOptions,
  type AuthSession,
  type AuthUser,
} from './auth';
export { createApi, type ApiClient, ApiError, AgentOfflineError } from './api';
export {
  createPdfTextSource,
  groupBlocks,
  paragraphsOf,
  groupParagraphs,
  outlineToToc,
  chapterAt,
  emptyDoc,
  isComplete,
  isPdfTextDoc,
  type PdfEngine,
  type PdfHandle,
  type PdfOutlineNode,
  type PdfBlock,
  type PdfBlockKind,
  type PdfDocInfo,
  type PdfPage,
  type PdfStatus,
  type PdfTextDoc,
  type PdfTextItem,
  type PdfTextRemote,
  type PdfTextSource,
  type PdfTextSourceOptions,
  type PdfTextStore,
  type PdfTocEntry,
} from './pdf';
export { createPdfTextRemote, type PdfTextApi } from './pdfRemote';
export {
  createNotificationStream,
  type NotificationStream,
  type NotificationStreamOptions,
  type RealtimeConfig,
  type RealtimeState,
} from './realtime';
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
} from './types';
