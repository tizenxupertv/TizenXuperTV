import type { SportCategory, SportsEvent, SportsStream } from '../types/sports.ts';
import { decryptSportsPayload } from '../lib/sportsCrypto.ts';
import SHA256 from 'crypto-js/sha256.js';
import Latin1 from 'crypto-js/enc-latin1.js';
import Hex from 'crypto-js/enc-hex.js';
import { fetchWithTimeout } from '../lib/fetchTimeout.ts';

const DEFAULT_BASE_URL = 'https://hello-how.pages.dev/';
const CACHE_TTL_MS = 120_000; // 2 minutes
const STREAMS_CACHE_TTL_MS = 300_000; // 5 minutes

/**
 * Signals the app plays: any stream resolved to an active HTTP/HTTPS playback URL.
 */
export function isPlayableStream(s: SportsStream): boolean {
  return !!s && !!s.url && s.url.startsWith('http');
}

export class SportsService {
  private baseUrl: string = DEFAULT_BASE_URL;
  private cachedEvents: SportsEvent[] = [];
  private lastFetchTime: number = 0;
  private fetchPromise: Promise<SportsEvent[]> | null = null;
  private streamsCache: Map<string, { streams: SportsStream[]; time: number }> = new Map();

  public setBaseUrl(url: string) {
    this.baseUrl = url.endsWith('/') ? url : `${url}/`;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /** The last events loaded, however old (shown at once while a fresh list loads) */
  public peekEvents(): SportsEvent[] {
    return this.cachedEvents;
  }

  /**
   * Retrieves all sports events, using cache if still fresh.
   */
  public async getEvents(forceRefresh = false): Promise<SportsEvent[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedEvents.length > 0 && now - this.lastFetchTime < CACHE_TTL_MS) {
      this.updateEventStatuses(this.cachedEvents);
      return this.cachedEvents;
    }

    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = this.fetchAndParseEvents()
      .then(events => {
        this.cachedEvents = events;
        this.lastFetchTime = Date.now();
        this.fetchPromise = null;
        return events;
      })
      .catch(err => {
        this.fetchPromise = null;
        if (this.cachedEvents.length > 0) {
          console.warn('[sports] fetch failed, returning stale cache:', err);
          return this.cachedEvents;
        }
        throw err;
      });

    return this.fetchPromise;
  }

  /**
   * Fetches and decrypts streams for a specific event.
   */
  private cachedPublicIp: string = '';
  private ipFetchTime: number = 0;

  private async getPublicIp(): Promise<string> {
    const now = Date.now();
    if (this.cachedPublicIp && now - this.ipFetchTime < 600_000) {
      return this.cachedPublicIp;
    }
    try {
      const res = await fetchWithTimeout('https://api.ipify.org/', {}, 5000);
      if (res.ok) {
        this.cachedPublicIp = (await res.text()).trim();
        this.ipFetchTime = now;
      }
    } catch {
      this.cachedPublicIp = this.cachedPublicIp || '127.0.0.1';
    }
    return this.cachedPublicIp;
  }

  private async resolveDynamicStream(stream: SportsStream): Promise<SportsStream> {
    if (!stream.tokenApi) return stream;

    try {
      const desc = JSON.parse(stream.tokenApi);
      const type = (desc.type || '').toLowerCase();

      // 1. LS Token Algorithm (HMAC SHA-256 for live server endpoints)
      if (type === 'ls' || desc.default_string) {
        const rawUrl = desc.url || stream.url;
        if (rawUrl && rawUrl.startsWith('http')) {
          const u = new URL(rawUrl);
          const segments = u.pathname.split('/').filter(Boolean);
          if (segments.length >= 2) {
            const channel = segments[segments.length - 2];
            const defaultStr = desc.default_string || '9HY(#b1q6';
            const now = Math.floor(Date.now() / 1000);
            const ip = await this.getPublicIp();
            const seed = channel + defaultStr + now + ip;
            const hash = SHA256(Latin1.parse(seed)).toString(Hex);
            const token = `${hash}-${now + 77}-${now}`;
            const signedUrl = `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}token=${token}`;
            return {
              ...stream,
              url: signedUrl
            };
          }
        }
      }

      // 2. Embed page resolver (fetches embed HTML and extracts live m3u8)
      if (type === 'embed' && desc.api) {
        let pageUrl = desc.api.split('|')[0];
        if (pageUrl.startsWith('http')) {
          try {
            const isLocal = typeof window !== 'undefined' && (
              window.location.hostname === 'localhost' ||
              window.location.hostname === '127.0.0.1'
            );

            for (let i = 0; i < 3; i++) {
              const fetchUrl = isLocal
                ? `/stream-proxy?url=${encodeURIComponent(pageUrl)}`
                : pageUrl;

              const pageRes = await fetchWithTimeout(fetchUrl);
              if (!pageRes.ok) break;

              const html = await pageRes.text();
              const match = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>"]*/i);
              if (match) {
                let streamUrl = match[0];
                const origin = new URL(pageUrl).origin;

                // On TV or non-local environment, follow 302 redirects proactively so AVPlay
                // connects directly to the final delivery CDN without losing CUSTOM_MESSAGE headers
                if (typeof window !== 'undefined' && !isLocal && streamUrl.startsWith('http')) {
                  try {
                    const headRes = await fetchWithTimeout(streamUrl, {
                      method: 'GET',
                      headers: { 'Referer': `${origin}/` },
                      redirect: 'follow'
                    });
                    if (headRes.ok && headRes.url) {
                      streamUrl = headRes.url;
                    }
                  } catch (redirErr) {
                    console.warn('[sports] Pre-following redirect error, using initial m3u8:', redirErr);
                  }
                }

                return {
                  ...stream,
                  url: streamUrl,
                  headers: {
                    ...stream.headers,
                    'Referer': `${origin}/`
                  }
                };
              }

              // Check for JS redirect (e.g. streamtp domain replacement)
              const jsRedirect = html.match(/nuevoDominio\s*=\s*["'](https?:\/\/[^"']+)["']/i) ||
                                 html.match(/window\.location\.replace\(\s*["'](https?:\/\/[^"']+)["']/i);
              if (jsRedirect && jsRedirect[1]) {
                const newBase = jsRedirect[1].replace(/\/+$/, '');
                const oldUrlObj = new URL(pageUrl);
                pageUrl = `${newBase}${oldUrlObj.pathname}${oldUrlObj.search}`;
                continue;
              }

              break;
            }
          } catch (embedErr) {
            console.warn('[sports] Failed to resolve embed page:', pageUrl, embedErr);
          }
        }
      }
    } catch (err) {
      console.warn('[sports] tokenApi parsing error:', err);
    }

    return stream;
  }

  /** True when the signal's address must be worked out before playing it */
  public needsResolving(stream: SportsStream | null | undefined): boolean {
    return !!stream && !!stream.tokenApi;
  }

  /**
   * The signal ready to play: its signed or extracted address when it has one to work out, the same signal
   * otherwise or when that fails (the player then reports it as a signal that did not load)
   */
  public async resolveStream(stream: SportsStream): Promise<SportsStream> {
    if (!this.needsResolving(stream)) return stream;
    try {
      return await this.resolveDynamicStream(stream);
    } catch {
      return stream;
    }
  }

  public async getStreams(linksPath: string, forceRefresh = false): Promise<SportsStream[]> {
    if (!linksPath) return [];

    const now = Date.now();
    const cached = this.streamsCache.get(linksPath);
    if (!forceRefresh && cached && now - cached.time < STREAMS_CACHE_TTL_MS) {
      return cached.streams;
    }

    const fullUrl = linksPath.startsWith('http://') || linksPath.startsWith('https://')
      ? linksPath
      : `${this.baseUrl}${linksPath.replace(/^\/+/, '')}`;

    const resp = await fetchWithTimeout(fullUrl);

    if (!resp.ok) {
      throw new Error(`Failed to load streams: HTTP ${resp.status}`);
    }

    const encrypted = await resp.text();
    const decrypted = decryptSportsPayload(encrypted);
    // The list as the service gives it. A signal whose address has to be worked out (a signed link, a page to read)
    // is resolved when the viewer picks it (resolveStream): doing all of them here made every match wait for
    // requests to signals nobody opened, and a signed link could be minutes old by the time it was played
    const streams = this.parseStreams(decrypted);

    this.streamsCache.set(linksPath, { streams, time: now });
    return streams;
  }

  private async fetchAndParseEvents(): Promise<SportsEvent[]> {
    const catalogUrl = `${this.baseUrl}events.txt`;
    const resp = await fetchWithTimeout(catalogUrl);

    if (!resp.ok) {
      throw new Error(`Failed to load sports events: HTTP ${resp.status}`);
    }

    const encrypted = await resp.text();
    const decrypted = decryptSportsPayload(encrypted);
    return this.parseEventsJson(decrypted);
  }

  public parseEventsJson(jsonStr: string): SportsEvent[] {
    const rawList = JSON.parse(jsonStr);
    if (!Array.isArray(rawList)) return [];

    const now = Date.now();
    const events: SportsEvent[] = [];
    // The feed can list the same match more than once: links seen per event id
    const seenLinks = new Map<string, string[]>();

    for (const item of rawList) {
      if (!item) continue;
      let data: any = item;
      if (item.event) {
        data = typeof item.event === 'string' ? JSON.parse(item.event) : item.event;
      }

      if (data.visible === false) continue;
      const linksPath = (data.links || '').trim();
      if (!linksPath) continue;

      const home = (data.teamAName || '').trim();
      const away = (data.teamBName || '').trim();
      if (!home && !away) continue;

      const startMillis = this.parseUtcMillis(data.date, data.time);
      if (startMillis <= 0) continue;

      let endMillis = this.parseUtcMillis(data.end_date || data.date, data.end_time);
      if (endMillis <= 0) {
        endMillis = startMillis + 3 * 3600 * 1000; // default 3 hours
      }
      if (endMillis < startMillis) {
        endMillis += 24 * 3600 * 1000;
      }

      const sport = this.normalizeSportCategory(data.category);
      const sportLabel = this.sportLabel(sport);

      const status: 'live' | 'scheduled' | 'finished' =
        now < startMillis ? 'scheduled' : now <= endMillis ? 'live' : 'finished';

      const isoStartTime = new Date(startMillis).toISOString();
      const baseId = `ws:${sport}:${home}:${away}:${isoStartTime}`;
      const links = seenLinks.get(baseId) || [];
      if (links.indexOf(linksPath) >= 0) continue;
      links.push(linksPath);
      seenLinks.set(baseId, links);
      // Same match with other signals stays as its own card, with its own id
      const id = links.length > 1 ? `${baseId}#${links.length}` : baseId;

      events.push({
        id,
        sport,
        sportLabel,
        league: (data.eventName || 'Evento deportivo').trim(),
        home,
        away,
        homeLogo: this.sanitizeImageUrl(data.teamAFlag),
        awayLogo: this.sanitizeImageUrl(data.teamBFlag),
        leagueLogo: this.sanitizeImageUrl(data.eventLogo),
        startTime: isoStartTime,
        startMillis,
        endMillis,
        status,
        linksPath,
        linkNames: Array.isArray(data.link_names) ? data.link_names : [],
        priority: typeof data.priority === 'number' ? data.priority : 0
      });
    }

    // Sort: live first, then scheduled by start time, then finished
    events.sort((a, b) => {
      if (a.status === 'live' && b.status !== 'live') return -1;
      if (b.status === 'live' && a.status !== 'live') return 1;
      if (a.status === 'scheduled' && b.status === 'finished') return -1;
      if (b.status === 'scheduled' && a.status === 'finished') return 1;
      return a.startMillis - b.startMillis;
    });

    return events;
  }

  public parseStreams(jsonStr: string): SportsStream[] {
    const rawList = JSON.parse(jsonStr);
    if (!Array.isArray(rawList)) return [];

    const streams: SportsStream[] = [];
    for (let i = 0; i < rawList.length; i++) {
      const row = rawList[i];
      if (!row) continue;

      const name = (row.name || `Servidor ${i + 1}`).trim();
      const rawLink = (row.link || '').trim();
      const drmApi = (row.api || '').trim();
      const scheme = typeof row.scheme === 'number' ? row.scheme : 0;
      const tokenApi = (row.tokenApi || '').trim();

      const { url, headers } = this.parseLinkHeaders(rawLink);

      if (url || tokenApi) {
        streams.push({
          name,
          url,
          scheme,
          drmApi: drmApi || undefined,
          headers,
          tokenApi: tokenApi || undefined
        });
      }
    }
    return streams;
  }

  private parseLinkHeaders(raw: string): { url: string; headers: Record<string, string> } {
    if (!raw) return { url: '', headers: {} };
    const pieces = raw.split('|');
    const url = pieces[0].trim();
    const headers: Record<string, string> = {};

    if (pieces.length > 1) {
      const params = pieces[1].split('&');
      for (const p of params) {
        const eq = p.indexOf('=');
        if (eq > 0) {
          const key = p.substring(0, eq).trim();
          const val = p.substring(eq + 1).trim();
          const kLower = key.toLowerCase();
          if (kLower === 'user-agent') headers['User-Agent'] = val;
          else if (kLower === 'referer' || kLower === 'referrer') headers['Referer'] = val;
          else if (kLower === 'origin') headers['Origin'] = val;
          else headers[key] = val;
        }
      }
    }
    return { url, headers };
  }

  private parseUtcMillis(dateStr?: string, timeStr?: string): number {
    if (!dateStr || !timeStr) return 0;
    try {
      // Date is DD/MM/YYYY
      const dateParts = dateStr.split('/');
      if (dateParts.length !== 3) return 0;
      const day = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10) - 1;
      const year = parseInt(dateParts[2], 10);

      const timeClean = timeStr.trim();
      const timeParts = timeClean.split(':');
      const hour = parseInt(timeParts[0], 10) || 0;
      const minute = parseInt(timeParts[1], 10) || 0;
      const second = timeParts.length > 2 ? parseInt(timeParts[2], 10) : 0;

      // Note: Backend dates in WiwySport are in Mexico/UTC convention. UTC Date:
      const date = new Date(Date.UTC(year, month, day, hour, minute, second));
      return date.getTime();
    } catch {
      return 0;
    }
  }

  private normalizeSportCategory(category?: string): SportCategory {
    if (!category) return 'other';
    const norm = category
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (norm.includes('american football')) return 'american_football';
    if (norm.includes('football') || norm.includes('soccer') || norm.includes('futbol')) return 'football';
    if (norm.includes('basket')) return 'basketball';
    if (norm.includes('baseball') || norm.includes('beisbol')) return 'baseball';
    if (norm.includes('fight') || norm.includes('box') || norm.includes('combate') || norm.includes('mma')) return 'fighting';
    if (norm.includes('tennis') || norm.includes('tenis')) return 'tennis';
    if (norm.includes('motor') || norm.includes('f1') || norm.includes('nascar') || norm.includes('racing')) return 'motor_sport';
    return 'other';
  }

  private sportLabel(sport: SportCategory): string {
    switch (sport) {
      case 'football': return 'Fútbol';
      case 'basketball': return 'Básquetbol';
      case 'american_football': return 'Fútbol Americano';
      case 'baseball': return 'Béisbol';
      case 'fighting': return 'Combate / MMA';
      case 'tennis': return 'Tenis';
      case 'motor_sport': return 'Motor / F1';
      case 'live': return 'En Vivo';
      case 'all': return 'Todos';
      default: return 'Otros Deportes';
    }
  }

  private sanitizeImageUrl(url?: string): string | undefined {
    if (!url) return undefined;
    const trimmed = url.trim();
    if (trimmed.startsWith('http://img.sofascore.com/')) {
      return 'https://' + trimmed.substring(7);
    }
    return trimmed.startsWith('https://') || trimmed.startsWith('http://') ? trimmed : undefined;
  }

  private updateEventStatuses(events: SportsEvent[]) {
    const now = Date.now();
    for (const event of events) {
      event.status = now < event.startMillis ? 'scheduled' : now <= event.endMillis ? 'live' : 'finished';
    }
  }
}

export const sportsService = new SportsService();
