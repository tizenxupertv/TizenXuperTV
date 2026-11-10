/**
 * Recent playback events (what played, which player and why, what failed) for the problem report that the
 * user sends from Perfil › Diagnóstico. Saved on the TV (localStorage) so a report sent after a restart or
 * a crash still has them; events older than 3 days are dropped. Streams are recorded by host: links carry
 * tokens, so any link in a detail is cut down to its host.
 * No relative imports, so test/playbackLog.test.ts can load this file in Node.
 */
/** info = a decision or the context (player chosen and why, app start, preview or fullscreen) */
export type PlaybackKind = 'start' | 'error' | 'stall' | 'info';

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

const MAX_EVENTS = 100;
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'xuper.playbackLog.v1';
/** A stall right after another one on the same channel adds nothing */
const STALL_GAP_MS = 15000;
/** The same script error repeated within a minute counts once */
const SCRIPT_ERROR_GAP_MS = 60000;

type LogStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

let events: PlaybackEvent[] = [];
let context: { channel?: string; category?: string; source?: string } = {};
let storage: LogStorage | null = null;
const lastScriptErrors: Record<string, number> = {};

/** Where the log is saved (null: memory only). Loads what is saved there, without events older than 3 days. */
export function usePlaybackStorage(next: LogStorage | null, now: number = Date.now()): void {
  storage = next;
  if (!storage) return;
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) {
      events = saved.filter(e => e && typeof e === 'object' && Number(e.at) > now - MAX_AGE_MS).slice(-MAX_EVENTS);
    }
  } catch {
    // damaged or blocked storage: start empty
  }
}

function save(): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // full or blocked storage: the log stays in memory
  }
}

/** Links inside a text keep only their host */
function withoutLinks(text: string): string {
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi, url => hostOf(url) || 'enlace');
}

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
    detail: event.detail ? withoutLinks(String(event.detail)).slice(0, 120) : undefined
  });
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  save();
}

/** Script errors and unhandled promise rejections go to the log (player "JS"), each message once a minute */
export function installErrorCapture(w: { addEventListener(type: string, fn: (e: any) => void): void }): void {
  const record = (text: string) => {
    const now = Date.now();
    const key = text.slice(0, 80);
    if (lastScriptErrors[key] && now - lastScriptErrors[key] < SCRIPT_ERROR_GAP_MS) return;
    lastScriptErrors[key] = now;
    logPlayback({ kind: 'error', player: 'JS', detail: text }, now);
  };
  w.addEventListener('error', (e: any) => {
    if (!e || !e.message) return; // a failed image or script load, not a script error
    const file = String(e.filename || '').split('?')[0].split('/').pop();
    record(`${e.message}${file ? ` · ${file}:${e.lineno || 0}` : ''}`);
  });
  w.addEventListener('unhandledrejection', (e: any) => {
    const reason = e && e.reason;
    const text = reason && (reason.message || reason.name) ? reason.message || reason.name : String(reason);
    record(`promesa: ${text}`);
  });
}

export function playbackEvents(): PlaybackEvent[] {
  return events.slice();
}

/** The newest events whose JSON, plus `usedChars` of the rest of the report, fits in `maxChars` */
export function eventsWithinBudget<T>(list: T[], usedChars: number, maxChars: number): T[] {
  let total = usedChars;
  let from = list.length;
  while (from > 0) {
    const size = JSON.stringify(list[from - 1]).length + 1;
    if (total + size > maxChars) break;
    total += size;
    from--;
  }
  return list.slice(from);
}

/** An internet provider's block page instead of a stream (Chile's ISPs, for one, block these servers) */
export function isIspBlockPage(body: string, finalUrl?: string): boolean {
  const host = hostOf(finalUrl);
  if (/bloqueo|block/i.test(host)) return true;
  return /portalbloqueo|sitio (web )?(bloqueado|no se encuentra disponible)|no se encuentra disponible desde|bloqueado por orden|blocked by (your|order)|access to this (site|website) (has been|is) (blocked|denied)/i.test(String(body || ''));
}

/** For tests */
export function clearPlaybackLog(): void {
  events = [];
  context = {};
  for (const k of Object.keys(lastScriptErrors)) delete lastScriptErrors[k];
}

// The AVPlay bridge (public/js/tizen-bridge.js) reports its errors and stalls through this hook
if (typeof window !== 'undefined') {
  (window as any).__xuperPlaybackEvent = (e: { kind?: string; player?: string; detail?: string; url?: string }) => {
    if (!e || (e.kind !== 'error' && e.kind !== 'stall' && e.kind !== 'start' && e.kind !== 'info')) return;
    logPlayback({ kind: e.kind, player: e.player, detail: e.detail, host: hostOf(e.url) });
  };
  try {
    usePlaybackStorage((window as any).localStorage || null);
  } catch {
    // storage blocked: memory only
  }
  installErrorCapture(window);
}
