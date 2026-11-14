/**
 * EPIC+ agenda (`/menu`, docs/epic-pwa-api.md) turned into the app's sports events: Deportes shows them as the
 * "Fútbol+" category. Pure: no requests here (services/epicAgendaService.ts does them).
 * No relative imports except types, so tests can load this file in Node.
 */
import type { SportsEvent, SportsStream } from '../types/sports.ts';

/** tokenApi of an option whose address EPIC+ works out (`/resolve`) when the viewer picks it */
export const EPIC_RESOLVE = 'epic-resolve';
/** linksPath prefix of an EPIC+ event: its options come from the agenda already downloaded */
export const EPIC_LINKS_PREFIX = 'epic:';
/**
 * Match hours always come in Lima / Bogotá time (UTC-5 all year, the server's `dia_lima`), whatever zone is asked:
 * checked on 13-nov with Bogotá, Mexico City, Lima, New York and GMT-6 (same hours). The zone only picks which day is
 * "today" and the country used to order the agenda (`pais_hora`). The app shows each start in the TV's own time.
 */
const AGENDA_OFFSET = '-05:00';
const FALLBACK_ZONE = 'America/Bogota';

/** IANA time zone of this TV ('' when the engine does not say) */
export function deviceTimeZone(intl: any = typeof Intl !== 'undefined' ? Intl : undefined): string {
  try {
    const tz = intl && intl.DateTimeFormat ? intl.DateTimeFormat().resolvedOptions().timeZone : '';
    return typeof tz === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) ? tz : '';
  } catch {
    return '';
  }
}

/** The agenda request: full agenda, every option a current client can open, the TV's day and language */
export function epicMenuPath(timeZone: string): string {
  const tz = timeZone || FALLBACK_ZONE;
  return `/menu?all=1&recetas=aparte&agenda=propia&v=9999&tz=${encodeURIComponent(tz)}&idioma=es`;
}
const MATCH_MS = 150 * 60 * 1000;
const MAX_OPTIONS = 12;

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

/** Country or region words EPIC+ adds after a channel name ("Caracol Colombia", "TUDN USA", "RDS CA") */
const PLACE_WORDS = /\s+(colombia|m[eé]xico|mexico|usa|us|argentina|per[uú]|chile|ecuador|espa[nñ]a|latam|latinoam[eé]rica|ca|canada|uk|israel)$/i;
/** Names of a source or of the match, not of a channel ("PirloTV Col-Chi 5", "Canal 2", "Opción 3", "Puente ip01") */
const NOT_A_CHANNEL = /pirlo|opci[oó]n|^canal\s*\d|\b[a-z]{3}-[a-z]{3}\b|stream|servidor|server|puente|^\d+$/i;

/**
 * Label of the n-th option: "Opción n", then the channel when the name is a real one (place words dropped, so
 * "Caracol Colombia" reads "Caracol"), and HD when the name said so. Source and match names never show.
 */
export function epicOptionLabel(rawName: string, n: number): string {
  let name = String(rawName || '').trim();
  const hd = /\(\s*hd\s*\)|\bhd\b/i.test(name);
  name = name.replace(/\(\s*hd\s*\)/ig, '').replace(/\s+/g, ' ').trim();
  let channel = NOT_A_CHANNEL.test(name) ? '' : name;
  while (channel && PLACE_WORDS.test(channel)) channel = channel.replace(PLACE_WORDS, '').trim();
  const parts = [`Opción ${n}`];
  if (channel) parts.push(hd && !/\bhd\b/i.test(channel) ? `${channel} HD` : channel);
  else if (hd) parts.push('HD');
  return parts.join(' · ');
}

/**
 * The same channel of one source under two addresses (docs/epic-pwa-api.md, "Selección y reproducción"): DaddyLive
 * lists channel N as a direct manifest (`/premiumN/index.m3u8`) and as its page (`/stream/stream-N.php`)
 */
export function epicChannelKey(url: string): string {
  const m = /\/premium(\d+)\/index\.m3u8/.exec(url) || /\/stream\/stream-(\d+)\.php/.exec(url);
  return m ? `daddylive:${m[1]}` : '';
}

/** EPIC+ source family the team wants first (`cocinas[].familia`): its option 1 reads "Recomendada" */
export const RECOMMENDED_FAMILY = 'tiktok';

/**
 * Options of a match: the recommended family first, the rest in the agenda's order. Direct HLS links play as they
 * are, the rest go through /resolve. A channel listed twice keeps one option, its direct manifest when it has one.
 */
export function epicOptions(e: any): SportsStream[] {
  type Option = SportsStream & { channel: string; family: string };
  const out: Option[] = [];
  const seen = new Set<string>();
  const byChannel = new Map<string, Option>();
  const add = (ch: any, family = '') => {
    const url = String((ch && ch.url) || '').trim();
    if (!/^https?:\/\//.test(url) || seen.has(url) || /youtube\.com|youtu\.be/.test(url)) return;
    seen.add(url);
    const direct = /\.m3u8(\?|$)/.test(url);
    const key = epicChannelKey(url);
    const twin = key ? byChannel.get(key) : undefined;
    if (twin) {
      // Keep the place of the first one; take the direct manifest if this is it
      if (direct && twin.tokenApi) {
        twin.url = url;
        twin.tokenApi = undefined;
      }
      if (!twin.family) twin.family = family;
      return;
    }
    const option: Option = {
      channel: String((ch && (ch.publico || ch.name)) || '').trim(),
      family,
      name: '',
      url,
      scheme: 0,
      headers: {},
      tokenApi: direct ? undefined : EPIC_RESOLVE
    };
    if (key) byChannel.set(key, option);
    out.push(option);
  };
  for (const cocina of (e && e.cocinas) || []) {
    const family = String((cocina && cocina.familia) || '');
    for (const ch of (cocina && cocina.canales) || []) add(ch, family);
  }
  for (const k of ['channels', 'channels_alt', 'channels_sky']) for (const ch of (e && e[k]) || []) add(ch);
  const ranked = out.filter(o => o.family === RECOMMENDED_FAMILY).concat(out.filter(o => o.family !== RECOMMENDED_FAMILY));
  return ranked.slice(0, MAX_OPTIONS).map(({ channel, family, ...o }, i) => {
    const label = epicOptionLabel(channel, i + 1);
    return { ...o, name: i === 0 && family === RECOMMENDED_FAMILY ? `${label} · Recomendada` : label };
  });
}

/** The agenda as the app's events (hidden ones left out) */
export function parseEpicMenu(menu: any, now = Date.now()): SportsEvent[] {
  const list: any[] = (menu && Array.isArray(menu.events)) ? menu.events : [];
  const events: SportsEvent[] = [];
  for (const e of list) {
    if (!e || e.oculto || e.id == null) continue;
    const start = epicStartMillis(e.date, e.hour);
    if (!start) continue;
    const { home, away } = epicTeams(e.titulo || e.description);
    const options = epicOptions(e);
    const live = e.status === 'live';
    const status: SportsEvent['status'] = live ? 'live' : e.ended || now > start + MATCH_MS ? 'finished' : 'scheduled';
    events.push({
      id: `epic-${e.id}`,
      sport: 'football_plus',
      sportLabel: 'Fútbol+',
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
