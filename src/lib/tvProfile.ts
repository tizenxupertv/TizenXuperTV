/**
 * The one place that knows which Tizen a TV runs and what that means for the app. Everything that behaves
 * differently on an older TV reads the profile from here (getTvProfile / window.XuperEnv) instead of parsing the
 * user agent on its own.
 * No relative imports, so tests can load this file in Node.
 */

export type TvTier = 'legacy' | 'mid' | 'modern';

export interface TvProfile {
  /** Tizen version as major.minor (4.0 -> 4, 5.5 -> 5.5); 0 when the user agent does not say (desktop, tests) */
  tizen: number;
  /** legacy: Tizen 4.0 and older (about 1 GB of RAM); mid: 5.0 to 7.x; modern: 8 and newer or not a TV */
  tier: TvTier;
  /** Tizen 4.0 and older: keep little video behind the playhead */
  lowMemory: boolean;
  /** Tizen 6.0 and older: plain live preview box */
  legacyVideo: boolean;
  /** Seconds of video hls.js keeps behind the playhead (at most) */
  backBufferSec: number;
  /** Seconds of video hls.js loads ahead */
  bufferAheadSec: number;
}

/** Seconds of video kept behind the playhead on a low-memory TV */
export const LOW_MEMORY_BACK_BUFFER = 10;

/** Reads the Tizen version out of a user agent: "(SMART-TV; LINUX; Tizen 5.5)" -> 5.5; 0 when absent */
export function parseTizenVersion(ua: string): number {
  const m = /Tizen\s+(\d+)(?:\.(\d+))?/i.exec(ua || '');
  if (!m) return 0;
  return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 10 : 0);
}

export function profileForUa(ua: string): TvProfile {
  const tizen = parseTizenVersion(ua);
  const major = Math.floor(tizen);
  const lowMemory = tizen > 0 && major <= 4;
  const legacyVideo = tizen > 0 && tizen < 6.1;
  const tier: TvTier = tizen > 0 && major <= 4 ? 'legacy' : tizen > 0 && major <= 7 ? 'mid' : 'modern';
  return {
    tizen,
    tier,
    lowMemory,
    legacyVideo,
    backBufferSec: lowMemory ? LOW_MEMORY_BACK_BUFFER : 15,
    bufferAheadSec: 15
  };
}

let cached: TvProfile | null = null;

/** Profile of this device, computed once. Pass `ua` to compute one for another user agent (tests, reports). */
export function getTvProfile(ua?: string): TvProfile {
  if (ua !== undefined) return profileForUa(ua);
  if (!cached) cached = profileForUa(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return cached;
}
