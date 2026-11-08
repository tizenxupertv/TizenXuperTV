import { LiveChannel } from '../types/channel';

const EMPTY = ['', 'undefined', 'null', '0'];

/**
 * Stable favorite key of a channel. Never returns "undefined": a channel without id or code
 * falls back to its name, and with nothing usable the key is '' (it cannot be a favorite).
 */
export function channelKey(ch: Partial<LiveChannel> | null | undefined): string {
  if (!ch) return '';
  const raw = ch as any;
  for (const v of [ch.id, ch.code, raw.channelCode, ch.url, raw.streamUrl, ch.name]) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    if (EMPTY.indexOf(s.toLowerCase()) === -1) return s;
  }
  return '';
}

/** Drops invalid entries ("undefined", empty) saved by earlier versions */
export function cleanFavMap(map: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  Object.keys(map || {}).forEach(k => {
    if (EMPTY.indexOf(k.trim().toLowerCase()) === -1 && map[k]) out[k] = true;
  });
  return out;
}

function identifiers(ch: Partial<LiveChannel>): string[] {
  const raw = ch as any;
  const out: string[] = [];
  for (const v of [ch.id, ch.code, raw.channelCode, ch.url, raw.streamUrl]) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    if (EMPTY.indexOf(s.toLowerCase()) === -1 && out.indexOf(s) === -1) out.push(s);
  }
  return out;
}

/**
 * True when two entries are the same channel. Real identifiers (id, code, channelCode, url)
 * decide: sharing one means same channel, and having different ones means different channels.
 * The name is only used when a channel has no identifier at all, so two channels that happen
 * to share a name, or that both lack an id, never match by accident.
 */
export function isSameChannel(a: Partial<LiveChannel> | null | undefined, b: Partial<LiveChannel> | null | undefined): boolean {
  if (!a || !b) return false;
  const ia = identifiers(a);
  const ib = identifiers(b);
  if (ia.length && ib.length) return ia.some(x => ib.indexOf(x) !== -1);
  if (ia.length || ib.length) return false;
  const na = String(a.name || '').trim().toLowerCase();
  const nb = String(b.name || '').trim().toLowerCase();
  return !!na && na === nb;
}

/**
 * Gives a cached channel the fields the app needs. Channels saved by other versions can carry only
 * `channelCode` / `streamUrl` (no id or code), and without them they cannot be tuned or compared.
 */
/** Filler texts older versions stored as the programme (still in saved channel lists): they are not data */
const FILLER_TEXTS = ['Transmisión en directo', 'Continuación de programación', 'Continuación de programación nocturna'];
export const realText = (v?: string): string => (v && FILLER_TEXTS.indexOf(v.trim()) < 0 ? v : '');

export function normalizeChannel<T extends Partial<LiveChannel>>(c: T): T {
  if (!c) return c;
  if ((c.now && !realText(c.now)) || (c.next && !realText(c.next))) {
    c = { ...c, now: realText(c.now), next: realText(c.next) };
  }
  const raw = c as any;
  const hasId = c.id !== undefined && c.id !== null && String(c.id) !== '';
  const hasCode = !!c.code;
  const hasUrl = c.url !== undefined && c.url !== null;
  if (hasId && hasCode && hasUrl) return c;
  const code = c.code || raw.channelCode || (hasId ? String(c.id) : '');
  return {
    ...c,
    id: hasId ? c.id : (raw.channelCode || code),
    code,
    url: hasUrl ? c.url : (raw.streamUrl || '')
  };
}

export function normalizeChannels<T extends Partial<LiveChannel>>(list: T[]): T[] {
  return Array.isArray(list) ? list.map(normalizeChannel) : [];
}
