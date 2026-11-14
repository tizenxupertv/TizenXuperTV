import type { SportsEvent, SportsStream } from '../types/sports.ts';
import type { SportsSource } from '../views/SportsView';
import { EPIC_LINKS_PREFIX } from '../lib/epicMenu';
import { sportsService } from './sportsService.ts';
import { epicAgendaService } from './epicAgendaService';

/**
 * What Deportes shows: the main agenda plus EPIC+'s agenda as the "Fútbol+" category. Either can fail alone (the
 * other still shows); an error only when both do.
 */
export const deportesSource: SportsSource = {
  peekEvents(): SportsEvent[] {
    return [...sportsService.peekEvents(), ...epicAgendaService.peekEvents()];
  },
  async getEvents(force = false): Promise<SportsEvent[]> {
    const [main, plus] = await Promise.allSettled([sportsService.getEvents(force), epicAgendaService.getEvents(force)]);
    if (main.status === 'rejected' && plus.status === 'rejected') throw main.reason;
    return [...(main.status === 'fulfilled' ? main.value : []), ...(plus.status === 'fulfilled' ? plus.value : [])];
  },
  getStreams(linksPath: string): Promise<SportsStream[]> {
    return linksPath.startsWith(EPIC_LINKS_PREFIX) ? epicAgendaService.getStreams(linksPath) : sportsService.getStreams(linksPath);
  }
};
