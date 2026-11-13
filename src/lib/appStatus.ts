/**
 * A status the team sets from the support chat and every TV reads (POST /tv/maintenance/status on the bot):
 *   notice  a message the viewer closes and keeps using the app, e.g. an outage of the external content service;
 *   block   a full screen in place of the app until the team lifts it.
 * No relative imports, so tests can load this file in Node.
 */
export type AppStatusLevel = 'notice' | 'block';

export interface AppStatus {
  level: AppStatusLevel;
  message: string;
  /** When the team set it; tells one notice from the next */
  updatedAt: string;
}

/** How often a running TV asks again. The answer is small, but every TV asks: keep it rare */
export const APP_STATUS_POLL_MS = 15 * 60 * 1000;

/** The status in the server's answer, or null when there is none or the answer is not understood */
export function parseAppStatus(data: unknown): AppStatus | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.active !== true || typeof d.message !== 'string' || !d.message.trim()) return null;
  return {
    // A server that says nothing about the level is the first version of this, which only blocked
    level: d.level === 'notice' ? 'notice' : 'block',
    message: d.message.trim(),
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : ''
  };
}

/** Whether a notice is still to be shown: one the viewer closed stays closed until the team sets another */
export function noticeToShow(status: AppStatus | null, closedKey: string | null): AppStatus | null {
  if (!status || status.level !== 'notice') return null;
  return noticeKey(status) === closedKey ? null : status;
}

export const noticeKey = (status: AppStatus): string => `${status.updatedAt}|${status.message}`;
