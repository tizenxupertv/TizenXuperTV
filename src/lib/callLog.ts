/**
 * One console entry per call or step of a screen: a short line `[<scope>:<route>] <via> ✓|✗ <ms> ms · <info> · <why>`
 * followed by an object with the details, which DevTools shows as JSON to expand. The same format as logCall() in
 * public/js/magis-client.js, which logs every portal and catalog JSON request.
 * Big data (whole responses, title lists) goes only to the debug log (see debugLogEnabled): on the TV, the console
 * keeps every object it was given in memory.
 * No relative imports, so test/callLog.test.ts can load this file in Node.
 */

type Failure = { portalCode?: unknown; portalText?: unknown; message?: unknown };

/** localStorage key: '1' adds whole responses to the log on any device (always on in localhost) */
export const DEBUG_LOG_KEY = 'xuper.debugLog';

/** Whole responses in the log: always in local development, elsewhere only with localStorage['xuper.debugLog'] = '1' */
export function debugLogEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const host = window.location && window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    return window.localStorage.getItem(DEBUG_LOG_KEY) === '1';
  } catch {
    return false;
  }
}

/** Why a call failed, in one short line: the portal code and its words when there are, otherwise the message */
export function failureText(err: unknown): string {
  if (err && typeof err === 'object') {
    const f = err as Failure;
    if (f.portalCode) return `${String(f.portalCode)}${f.portalText ? ` ${String(f.portalText)}` : ''}`;
    if (f.message) return String(f.message);
  }
  return String(err);
}

export interface SourcePart {
  name: string;
  /** null: it failed */
  count: number | null;
  via: string;
}

/** Parts of one step grouped by source: `{ json: { featured: 8, movies: 9 }, relay: { kids: 7 }, falló: { anime: null } }` */
export function groupBySource(parts: SourcePart[]): Record<string, Record<string, number | null>> {
  const groups: Record<string, Record<string, number | null>> = {};
  for (const p of parts) {
    const key = p.count === null ? 'falló' : (p.via || 'sin origen');
    (groups[key] || (groups[key] = {}))[p.name] = p.count;
  }
  return groups;
}

/** The sources of a step, for the short line: `caché de sesión + json` */
export function sourceNames(parts: SourcePart[]): string {
  return Object.keys(groupBySource(parts)).join(' + ');
}

export function formatCall(scope: string, route: string, via: string, err: unknown, ms: number, info?: string): string {
  const line = `[${scope}:${route}] ${via} ${err ? '✗' : '✓'} ${Math.round(ms)} ms${info ? ` · ${info}` : ''}`;
  return err ? `${line} · ${failureText(err)}` : line;
}

export function logCall(
  scope: string,
  route: string,
  via: string,
  err: unknown,
  ms: number,
  info?: string,
  data?: unknown
): void {
  if (typeof console === 'undefined') return;
  const line = formatCall(scope, route, via, err, ms, info);
  const args = data === undefined ? [line] : [line, data];
  if (err) console.warn(...args);
  else console.log(...args);
}
