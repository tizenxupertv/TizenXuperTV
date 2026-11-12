import { LOW_MEMORY_BACK_BUFFER, getTvProfile } from './tvProfile.ts';

export { LOW_MEMORY_BACK_BUFFER };

/** TVs with little memory: Tizen 4.0 and older. Kept for callers; the rule lives in tvProfile.ts */
export function isLowMemoryTv(ua?: string): boolean {
  return getTvProfile(ua === undefined && typeof navigator !== 'undefined' ? navigator.userAgent : ua || '').lowMemory;
}

/** Back buffer for hls.js: `seconds`, or at most 10 s on a low-memory TV */
export function backBufferFor(seconds: number, ua?: string): number {
  return isLowMemoryTv(ua) ? Math.min(seconds, LOW_MEMORY_BACK_BUFFER) : seconds;
}

/** Tizen 6.0 and older: the live preview box drops rounded clipping and the gradient (html.legacy-video) */
export function isLegacyVideoTv(ua?: string): boolean {
  return getTvProfile(ua === undefined && typeof navigator !== 'undefined' ? navigator.userAgent : ua || '').legacyVideo;
}

/** Tizen 6.0 and older, about 1 to 1.5 GB of RAM: the home frees far images and does not decode posters ahead */
export function isOlderTv(ua?: string): boolean {
  return isLegacyVideoTv(ua);
}
