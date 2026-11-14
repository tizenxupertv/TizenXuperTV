import type { SportsEvent, SportsStream } from '../types/sports.ts';
import { fetchWithTimeout } from '../lib/fetchTimeout';
import { EPIC_LINKS_PREFIX, EPIC_RESOLVE, epicOptions, epicResolved, parseEpicMenu } from '../lib/epicMenu';
import { EPIC_API_BASE, epicSportsService } from './epicSportsService';
import { sportsService } from './sportsService';

const MENU_URL = `${EPIC_API_BASE}/menu?all=1&recetas=aparte&agenda=propia&v=9999&tz=America%2FBogota&idioma=es`;
const CACHE_TTL_MS = 120_000;
/** /resolve can take seconds while EPIC+ reads the source page (their PWA waits up to 15 s) */
const RESOLVE_TIMEOUT_MS = 15_000;

/**
 * The "EPIC+" sports tab (a trial next to Deportes): EPIC+'s own agenda and options (docs/epic-pwa-api.md), with
 * the same reads SportsView makes from sportsService. An option that is a page is worked out by EPIC+ (/resolve)
 * when the viewer picks it, through sportsService.resolveStream like any other signal.
 */
class EpicAgendaService {
  private events: SportsEvent[] = [];
  private raw = new Map<string, any>();
  private loadedAt = 0;
  private pending: Promise<SportsEvent[]> | null = null;

  constructor() {
    sportsService.registerResolver(EPIC_RESOLVE, stream => this.resolve(stream));
  }

  public peekEvents(): SportsEvent[] {
    return this.events;
  }

  public async getEvents(force = false): Promise<SportsEvent[]> {
    if (!force && this.events.length && Date.now() - this.loadedAt < CACHE_TTL_MS) return this.events;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const token = await epicSportsService.getPulseraToken();
        const res = await fetchWithTimeout(MENU_URL, { headers: { 'X-Pulsera': token, Accept: 'application/json' }, cache: 'no-store' });
        if (!res.ok) throw new Error(`EPIC+ agenda HTTP ${res.status}`);
        const menu = await res.json();
        this.raw.clear();
        for (const e of (menu && menu.events) || []) if (e && e.id != null) this.raw.set(String(e.id), e);
        this.events = parseEpicMenu(menu);
        this.loadedAt = Date.now();
        return this.events;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  public async getStreams(linksPath: string): Promise<SportsStream[]> {
    if (!linksPath.startsWith(EPIC_LINKS_PREFIX)) return [];
    const id = linksPath.slice(EPIC_LINKS_PREFIX.length);
    if (!this.raw.has(id)) await this.getEvents(true);
    return epicOptions(this.raw.get(id));
  }

  private async resolve(option: SportsStream): Promise<SportsStream> {
    const token = await epicSportsService.getPulseraToken();
    const url = `${EPIC_API_BASE}/resolve?url=${encodeURIComponent(option.url)}&navegador=1`;
    const res = await fetchWithTimeout(url, { headers: { 'X-Pulsera': token, Accept: 'application/json' }, cache: 'no-store' }, RESOLVE_TIMEOUT_MS);
    if (!res.ok) throw new Error(`EPIC+ resolve HTTP ${res.status}`);
    const resolved = epicResolved(option, await res.json());
    if (!resolved) throw new Error('EPIC+ resolve gave no address');
    return resolved;
  }
}

export const epicAgendaService = new EpicAgendaService();
