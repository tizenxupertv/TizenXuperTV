/**
 * TVs with little memory: Tizen 4.0 and older (2018 and earlier models, about 1 GB of RAM). Their user agent reads
 * "(SMART-TV; LINUX; Tizen 4.0)" and, on Tizen 4, has no "Chrome/" part.
 * No relative imports, so tests can load this file in Node.
 */

/** Seconds of video kept behind the playhead on a low-memory TV; the rest is freed by hls.js */
export const LOW_MEMORY_BACK_BUFFER = 10;

export function isLowMemoryTv(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  const m = /Tizen (\d+)\.\d+/.exec(ua || '');
  return !!m && parseInt(m[1], 10) <= 4;
}

/** Back buffer for hls.js: `seconds`, or at most 10 s on a low-memory TV */
export function backBufferFor(seconds: number, ua?: string): number {
  return isLowMemoryTv(ua) ? Math.min(seconds, LOW_MEMORY_BACK_BUFFER) : seconds;
}
