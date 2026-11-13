/**
 * Which score feeds the Deportes tab needs right now, and how fresh each must be.
 *
 * There are seven feeds (some of them several hundred games long) and all seven used to be downloaded and parsed
 * every 45 seconds, whatever was on the schedule. A feed is only worth asking for when a match of its sport is being
 * played or about to be; a sport that only has matches later today, or already finished, changes slowly.
 * No relative imports, so tests can load this file in Node.
 */
export type ScoreFeed = 'nba' | 'nhl' | 'soccer' | 'cfb' | 'cfl' | 'nfl' | 'mlb';

/** Feeds wanted, each with the oldest answer still good enough (ms) */
export type FeedPlan = Partial<Record<ScoreFeed, number>>;

/** A feed with a match in play: the score moves */
export const LIVE_MAX_AGE_MS = 45_000;
/** A feed with matches only later or already over: it barely changes */
export const QUIET_MAX_AGE_MS = 10 * 60_000;

const MINUTE = 60_000;
/** A match counts as in play from a little before its start to a while after its listed end (overtime, delays) */
const BEFORE_START_MS = 10 * MINUTE;
const AFTER_END_MS = 30 * MINUTE;

interface EventLike {
  sport: string;
  league?: string;
  sportLabel?: string;
  home: string;
  away: string;
  startMillis: number;
  endMillis: number;
  status: string;
}

const BY_SPORT: Record<string, ScoreFeed[]> = {
  football: ['soccer'],
  basketball: ['nba'],
  american_football: ['nfl', 'cfb', 'cfl'],
  baseball: ['mlb']
};

/** League names that say which feed, whatever category the schedule filed the match under (hockey has none) */
const BY_LEAGUE: Array<[RegExp, ScoreFeed]> = [
  [/\bnhl\b|hockey/i, 'nhl'],
  [/\bnba\b/i, 'nba'],
  [/\bnfl\b/i, 'nfl'],
  [/\bcfl\b/i, 'cfl'],
  [/\bmlb\b|b[eé]isbol|baseball/i, 'mlb'],
  [/college football|ncaa.*(football|fbs|fcs)/i, 'cfb']
];

/** The feeds that may hold this match's score; none for sports without a feed (tennis, fighting, motor) */
export function feedsOfEvent(e: EventLike): ScoreFeed[] {
  // The league name is the precise answer ("NFL" is one feed, not the three of American football); the sport is
  // the fallback when the name says nothing
  const text = `${e.league || ''} ${e.sportLabel || ''}`;
  const named = BY_LEAGUE.filter(([re]) => re.test(text)).map(([, feed]) => feed);
  return named.length ? Array.from(new Set(named)) : (BY_SPORT[e.sport] || []).slice();
}

const isVersus = (e: EventLike) => !!e.away && e.away.trim().toLowerCase() !== e.home.trim().toLowerCase();

/** True while the match is, or is about to be, or has just been in play */
export function inPlay(e: EventLike, now: number): boolean {
  if (e.status === 'live') return true;
  return now >= e.startMillis - BEFORE_START_MS && now <= e.endMillis + AFTER_END_MS;
}

/** The feeds to ask for the listed events: 45 s fresh where a match is in play, 10 min where none is */
export function feedPlan(events: EventLike[], now: number): FeedPlan {
  const plan: FeedPlan = {};
  events.forEach(e => {
    if (!isVersus(e)) return;
    const age = inPlay(e, now) ? LIVE_MAX_AGE_MS : QUIET_MAX_AGE_MS;
    feedsOfEvent(e).forEach(feed => {
      plan[feed] = Math.min(plan[feed] ?? Infinity, age);
    });
  });
  return plan;
}
