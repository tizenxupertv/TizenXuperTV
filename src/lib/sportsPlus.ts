/**
 * Fútbol+ (EPIC+) matches first: a match that is in both agendas keeps only its Fútbol+ copy, and Fútbol+ matches
 * go before the others of the same section. Pure, for SportsView and the tests.
 */
import type { SportsEvent } from '../types/sports.ts';

/** Two agendas list the same match within this much of each other */
const SAME_MATCH_MS = 3 * 3600 * 1000;

function team(name: string): string {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|cf|club|de|deportivo|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function sameTeam(a: string, b: string): boolean {
  const x = team(a), y = team(b);
  return !!x && !!y && (x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0);
}

export const isPlus = (e: SportsEvent) => e.sport === 'football_plus';

/** The same match (both teams, either order) at about the same time */
export function sameMatch(a: SportsEvent, b: SportsEvent): boolean {
  if (Math.abs(a.startMillis - b.startMillis) > SAME_MATCH_MS || !a.away || !b.away) return false;
  return (sameTeam(a.home, b.home) && sameTeam(a.away, b.away)) || (sameTeam(a.home, b.away) && sameTeam(a.away, b.home));
}

/** All events with the main-list copies of Fútbol+ matches left out */
export function withoutPlusDuplicates(events: SportsEvent[]): SportsEvent[] {
  const plus = events.filter(isPlus);
  if (!plus.length) return events;
  return events.filter(e => isPlus(e) || !plus.some(p => sameMatch(p, e)));
}

/** Sort order inside a section: Fútbol+ first, then by start time */
export function plusFirst(a: SportsEvent, b: SportsEvent): number {
  return (isPlus(a) ? 0 : 1) - (isPlus(b) ? 0 : 1) || a.startMillis - b.startMillis;
}
