import type { SportsEvent, SportsStream } from '../types/sports.ts';
import type { SportsSource } from '../views/SportsView';
import { EPIC_LINKS_PREFIX } from '../lib/epicMenu';
import { sportsService } from './sportsService.ts';
import { epicAgendaService } from './epicAgendaService';

/** Toggle to re-enable the legacy main sports agenda alongside EPIC+ when needed */
const ENABLE_MAIN_SPORTS_AGENDA = true;

/**
 * What Deportes shows: currently EPIC+'s agenda only (set ENABLE_MAIN_SPORTS_AGENDA = true to restore the main agenda).
 */
export const deportesSource: SportsSource = {
  peekEvents(): SportsEvent[] {
    if (!ENABLE_MAIN_SPORTS_AGENDA) return epicAgendaService.peekEvents();
    return [...sportsService.peekEvents(), ...epicAgendaService.peekEvents()];
  },
  async getEvents(force = false): Promise<SportsEvent[]> {
    if (!ENABLE_MAIN_SPORTS_AGENDA) return epicAgendaService.getEvents(force);
    const [main, plus] = await Promise.allSettled([sportsService.getEvents(force), epicAgendaService.getEvents(force)]);
    if (main.status === 'rejected' && plus.status === 'rejected') throw main.reason;
    return [...(main.status === 'fulfilled' ? main.value : []), ...(plus.status === 'fulfilled' ? plus.value : [])];
  },
  getStreams(linksPath: string): Promise<SportsStream[]> {
    return linksPath.startsWith(EPIC_LINKS_PREFIX) ? epicAgendaService.getStreams(linksPath) : sportsService.getStreams(linksPath);
  }
};
