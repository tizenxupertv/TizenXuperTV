/**
 * The routes of one sports signal: its own address first, then its alternates (lib/epicMenu keeps, for an EPIC+
 * channel listed as a manifest and as a page, the second one here). The player tries them in order before moving
 * to the next signal. No relative imports except types, so tests can load this file in Node.
 */
import type { SportsStream } from '../types/sports.ts';

export function routeCount(stream: SportsStream | undefined): number {
  return stream ? 1 + (stream.alternates ? stream.alternates.length : 0) : 0;
}

/** The signal as played on its `i`-th route (0: its own address) */
export function routeAt(stream: SportsStream, i: number): SportsStream {
  if (i <= 0 || !stream.alternates || !stream.alternates[i - 1]) return stream;
  const alt = stream.alternates[i - 1];
  return { ...stream, url: alt.url, tokenApi: alt.tokenApi, alternates: undefined };
}

/** One line for the playback log: which signal, route and source */
export function routeLabel(stream: SportsStream, i: number, host: string): string {
  const n = routeCount(stream);
  return [`«${stream.name}»`, n > 1 ? `ruta ${i + 1}/${n}` : '', stream.source || '', host].filter(Boolean).join(' · ');
}
