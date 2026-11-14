/**
 * Applying a downloaded update when the TV comes back (services/updateService.ts keeps it for "the next launch", and a
 * TV app is rarely launched from scratch). With nothing playing, the page reloads at once. A TV switched off on a live
 * channel comes back with that channel still open, so it never reached that point and stayed on the old version for
 * days: after a long time away the stream has to reconnect anyway, so the page reloads and goes back to the channel.
 */

/** When the reload was asked for with a live channel on screen (ms), so the next start reopens it */
export const RESUME_LIVE_KEY = 'xuper_resume_live_at';
/** A mark older than this is stale (the reload never happened): start normally */
export const RESUME_LIVE_MAX_MS = 2 * 60 * 1000;
/** Away at least this long before a live channel is interrupted for an update */
export const AWAY_MIN_MS = 30 * 60 * 1000;

export type WakeAction = 'none' | 'reload' | 'reload_live';

/** What to do when the app is visible again. `playing` = a movie or a fullscreen live channel is open */
export function wakeAction(s: { downloaded: boolean; playing: boolean; liveOnly: boolean; awayMs: number }): WakeAction {
  if (!s.downloaded) return 'none';
  if (!s.playing) return 'reload';
  return s.liveOnly && s.awayMs >= AWAY_MIN_MS ? 'reload_live' : 'none';
}

/** True when the stored mark says this start follows a reload asked for on a live channel */
export function resumeLiveWanted(raw: string | null, now: number): boolean {
  const at = Number(raw);
  return !!raw && at > 0 && now - at >= 0 && now - at <= RESUME_LIVE_MAX_MS;
}

/** Reads the mark once: it is removed so only the start right after the reload reopens the channel */
export function takeResumeLive(now: number = Date.now()): boolean {
  try {
    const raw = window.localStorage.getItem(RESUME_LIVE_KEY);
    if (raw) window.localStorage.removeItem(RESUME_LIVE_KEY);
    return resumeLiveWanted(raw, now);
  } catch (e) {
    return false;
  }
}

export function markResumeLive(now: number = Date.now()): void {
  try { window.localStorage.setItem(RESUME_LIVE_KEY, String(now)); } catch (e) {}
}

/** Read once when the app loads: this start follows a reload asked for with a live channel on screen */
export const resumeLiveAtStart: boolean = typeof window !== 'undefined' && takeResumeLive();
