/**
 * Recent playback events (what played, what failed and why) for the problem report that the user
 * sends from Perfil › Diagnóstico. Kept in memory only, never stored. Streams are recorded by host:
 * links carry tokens and are never kept.
 * No relative imports, so test/playbackLog.test.ts can load this file in Node.
 */
export type PlaybackKind = 'start' | 'error' | 'stall';

export interface PlaybackEvent {
  at: number;
  /** TV local time, e.g. "16:20" */
  local: string;
  kind: PlaybackKind;
  player?: string;
  channel?: string;
  category?: string;
  source?: string;
  host?: string;
  detail?: string;
}

const MAX_EVENTS = 40;
/** A stall right after another one on the same channel adds nothing */
const STALL_GAP_MS = 15000;

let events: PlaybackEvent[] = [];
let context: { channel?: string; category?: string; source?: string } = {};

/** Host of a stream link, without path or query (they carry tokens) */
export function hostOf(url?: string): string {
  if (!url) return '';
  const m = String(url).match(/^[a-z]+:\/\/([^/?#]+)/i);
  return m ? m[1].replace(/^[^@]*@/, '').slice(0, 60) : '';
}

function localTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** What is playing now (channel or title); later events are attributed to it */
export function setPlaybackContext(next: { channel?: string; category?: string; source?: string }): void {
  context = { ...next };
}

export function logPlayback(event: { kind: PlaybackKind; player?: string; detail?: string; host?: string }, now: number = Date.now()): void {
  const last = events[events.length - 1];
  if (event.kind === 'stall' && last && last.kind === 'stall' && last.channel === context.channel && now - last.at < STALL_GAP_MS) return;
  events.push({
    at: now,
    local: localTime(now),
    kind: event.kind,
    player: event.player,
    channel: context.channel,
    category: context.category,
    source: context.source,
    host: event.host || undefined,
    detail: event.detail ? String(event.detail).slice(0, 120) : undefined
  });
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
}

export function playbackEvents(): PlaybackEvent[] {
  return events.slice();
}

/** For tests */
export function clearPlaybackLog(): void {
  events = [];
  context = {};
}

// The AVPlay bridge (public/js/tizen-bridge.js) reports its errors and stalls through this hook
if (typeof window !== 'undefined') {
  (window as any).__xuperPlaybackEvent = (e: { kind?: string; player?: string; detail?: string; url?: string }) => {
    if (!e || (e.kind !== 'error' && e.kind !== 'stall' && e.kind !== 'start')) return;
    logPlayback({ kind: e.kind, player: e.player, detail: e.detail, host: hostOf(e.url) });
  };
}
