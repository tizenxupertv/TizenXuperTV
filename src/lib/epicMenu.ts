/**
 * EPIC+ agenda (`/menu`, docs/epic-pwa-api.md) turned into the app's sports events, for the "EPIC+" tab that is
 * tried next to Deportes. Pure: no requests here (services/epicAgendaService.ts does them).
 * No relative imports except types, so tests can load this file in Node.
 */
import type { SportCategory, SportsEvent, SportsStream } from '../types/sports.ts';

/** tokenApi of an option whose address EPIC+ works out (`/resolve`) when the viewer picks it */
export const EPIC_RESOLVE = 'epic-resolve';
/** linksPath prefix of an EPIC+ event: its options come from the agenda already downloaded */
export const EPIC_LINKS_PREFIX = 'epic:';
/** The agenda is asked in Bogotá time (UTC-5 all year) */
const AGENDA_OFFSET = '-05:00';
const MATCH_MS = 150 * 60 * 1000;
const MAX_OPTIONS = 12;

const SPORTS: Array<[RegExp, SportCategory, string]> = [
  [/americano|nfl/, 'american_football', 'Fútbol Americano'],
  [/futbol|soccer/, 'football', 'Fútbol'],
  [/basket|baloncesto|nba/, 'basketball', 'Básquetbol'],
  [/beisbol|baseball|mlb/, 'baseball', 'Béisbol'],
  [/box|ufc|mma|lucha|combate/, 'fighting', 'Combate'],
  [/tenis|tennis/, 'tennis', 'Tenis'],
  [/f1|formula|motor|nascar|moto/, 'motor_sport', 'Motor']
];

function plain(s: unknown): string {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function epicSport(deporte: any): { sport: SportCategory; label: string } {
  const key = plain(deporte && (deporte.clave || deporte.nombre));
  for (const [re, sport, label] of SPORTS) if (re.test(key)) return { sport, label };
  return { sport: 'other', label: (deporte && deporte.nombre) || 'Otros' };
}

/** "Liga: Local vs Visitante" -> teams; a title without "vs" is the home side alone */
export function epicTeams(title: string): { home: string; away: string } {
  const text = String(title || '');
  const body = text.indexOf(': ') >= 0 ? text.slice(text.indexOf(': ') + 2) : text;
  const parts = body.split(/\s+vs\.?\s+/i);
  return parts.length >= 2 ? { home: parts[0].trim(), away: parts.slice(1).join(' vs ').trim() } : { home: body.trim(), away: '' };
}

/** Start of a match in ms from the agenda's date ("2026-11-13") and hour ("12:00"), Bogotá time */
export function epicStartMillis(date: string, hour: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{1,2}:\d{2}$/.test(hour || '')) return 0;
  const [h, m] = hour.split(':');
  const t = Date.parse(`${date}T${h.padStart(2, '0')}:${m}:00${AGENDA_OFFSET}`);
  return Number.isFinite(t) ? t : 0;
}

/** Options of a match, in the agenda's order: direct HLS links play as they are, the rest go through /resolve */
export function epicOptions(e: any): SportsStream[] {
  const out: SportsStream[] = [];
  const seen = new Set<string>();
  const add = (ch: any, source: string) => {
    const url = String((ch && ch.url) || '').trim();
    if (!/^https?:\/\//.test(url) || seen.has(url) || /youtube\.com|youtu\.be/.test(url)) return;
    seen.add(url);
    const name = String(ch.publico || ch.name || 'Opción').trim();
    const direct = /\.m3u8(\?|$)/.test(url);
    out.push({
      name: source ? `${name} · ${source}` : name,
      url,
      scheme: 0,
      headers: {},
      tokenApi: direct ? undefined : EPIC_RESOLVE
    });
  };
  for (const cocina of (e && e.cocinas) || []) {
    for (const ch of (cocina && cocina.canales) || []) add(ch, String(cocina.fuente || ''));
  }
  for (const k of ['channels', 'channels_alt', 'channels_sky']) for (const ch of (e && e[k]) || []) add(ch, '');
  // The same channel from one source comes several times (other servers): number the repeats
  const list = out.slice(0, MAX_OPTIONS);
  const seenNames = new Map<string, number>();
  for (const o of list) {
    const n = (seenNames.get(o.name) || 0) + 1;
    seenNames.set(o.name, n);
    if (n > 1) o.name = `${o.name} (${n})`;
  }
  return list;
}

/** The agenda as the app's events (hidden ones left out) */
export function parseEpicMenu(menu: any, now = Date.now()): SportsEvent[] {
  const list: any[] = (menu && Array.isArray(menu.events)) ? menu.events : [];
  const events: SportsEvent[] = [];
  for (const e of list) {
    if (!e || e.oculto || e.id == null) continue;
    const start = epicStartMillis(e.date, e.hour);
    if (!start) continue;
    const { sport, label } = epicSport(e.deporte);
    const { home, away } = epicTeams(e.titulo || e.description);
    const options = epicOptions(e);
    const live = e.status === 'live';
    const status: SportsEvent['status'] = live ? 'live' : e.ended || now > start + MATCH_MS ? 'finished' : 'scheduled';
    events.push({
      id: `epic-${e.id}`,
      sport,
      sportLabel: label,
      league: String(e.liga || ''),
      home,
      away,
      homeLogo: e.escudo_local || undefined,
      awayLogo: e.escudo_visitante || undefined,
      leagueLogo: e.liga_logo || undefined,
      startTime: new Date(start).toISOString(),
      startMillis: start,
      endMillis: start + MATCH_MS,
      status,
      linksPath: EPIC_LINKS_PREFIX + String(e.id),
      linkNames: options.map(o => o.name),
      priority: typeof e.orden === 'number' ? e.orden : undefined
    });
  }
  return events.sort((a, b) => a.startMillis - b.startMillis);
}

/** What /resolve answered, as a signal to play (null when it gave no address) */
export function epicResolved(option: SportsStream, j: any): SportsStream | null {
  const url = j && typeof j.stream === 'string' ? j.stream : '';
  if (!/^https?:\/\//.test(url)) return null;
  const headers: Record<string, string> = {};
  const ref = j && typeof j.ref === 'string' ? j.ref : '';
  if (/^https?:\/\//.test(ref)) {
    headers.Referer = ref;
    const origin = /^(https?:\/\/[^/]+)/.exec(ref);
    if (origin) headers.Origin = origin[1];
  }
  return { ...option, url, headers, tokenApi: undefined };
}
