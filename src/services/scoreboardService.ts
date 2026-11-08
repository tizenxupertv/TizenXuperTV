import type { LiveMatchScore } from '../types/sports.ts';

interface EspnCompetitor {
  homeAway: 'home' | 'away';
  score?: string;
  linescores?: Array<{ value: number }>;
  team?: {
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
  };
  athlete?: {
    displayName?: string;
    fullName?: string;
  };
}

interface EspnCompetition {
  id?: string;
  competitors?: EspnCompetitor[];
  status?: {
    type?: {
      state?: string;
      shortDetail?: string;
      detail?: string;
      completed?: boolean;
    };
  };
}

interface EspnEvent {
  id: string;
  name?: string;
  competitions?: EspnCompetition[];
  status?: {
    type?: {
      state?: string;
      shortDetail?: string;
      detail?: string;
      completed?: boolean;
    };
  };
}

interface NormalizedEspnGame {
  sport: string;
  homeFull: string;
  homeShort: string;
  homeAbbr: string;
  homeScore: string;
  awayFull: string;
  awayShort: string;
  awayAbbr: string;
  awayScore: string;
  state: 'live' | 'finished' | 'scheduled';
  periodDetail: string;
}

const ESPN_ENDPOINTS: Record<string, string> = {
  nba: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  nhl: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
  soccer: 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard',
  cfb: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
  nfl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  mlb: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard'
};

// Words that never tell two teams apart. City, United, Real, Atlético… do, so they count
const STOP_WORDS = new Set([
  'fc', 'sc', 'cf', 'cd', 'afc', 'club', 'de', 'la', 'del', 'los', 'las', 'el', 'and', 'the'
]);

const CACHE_TTL_MS = 45_000; // 45 seconds

class ScoreboardService {
  private games: NormalizedEspnGame[] = [];
  private lastFetchTime: number = 0;
  private isFetching: boolean = false;

  /** Normalized names, cached: findScore compares every match with every ESPN game */
  private normalized = new Map<string, string>();

  private normalizeText(str?: string): string {
    const key = str || '';
    const hit = this.normalized.get(key);
    if (hit !== undefined) return hit;
    const value = this.normalizeRaw(key);
    if (this.normalized.size > 5000) this.normalized.clear();
    this.normalized.set(key, value);
    return value;
  }

  private normalizeRaw(str: string): string {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .trim();
  }

  private parseScore(competitor?: EspnCompetitor): string {
    if (!competitor) return '';
    if (typeof competitor.score === 'string' && competitor.score.length > 0) {
      return competitor.score;
    }
    if (typeof (competitor.score as any) === 'number') {
      return String(competitor.score);
    }
    if (Array.isArray(competitor.linescores) && competitor.linescores.length > 0) {
      const sum = competitor.linescores.reduce((acc, curr) => acc + (curr.value || 0), 0);
      return String(sum);
    }
    return '';
  }

  /**
   * Fetches scores across ESPN sports feeds concurrently and updates cache.
   */
  public async fetchScores(force = false): Promise<void> {
    const now = Date.now();
    if (!force && this.games.length > 0 && now - this.lastFetchTime < CACHE_TTL_MS) {
      return;
    }
    if (this.isFetching) return;

    this.isFetching = true;
    try {
      const fetchPromises = Object.entries(ESPN_ENDPOINTS).map(async ([sportKey, url]) => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) return [];
          const data = await resp.json();
          const events: EspnEvent[] = data.events || [];
          const parsed: NormalizedEspnGame[] = [];

          for (const ev of events) {
            const comp = ev.competitions?.[0];
            if (!comp || !Array.isArray(comp.competitors) || comp.competitors.length < 2) continue;

            const homeComp = comp.competitors.find(c => c.homeAway === 'home');
            const awayComp = comp.competitors.find(c => c.homeAway === 'away');
            if (!homeComp || !awayComp) continue;

            const homeFull = homeComp.team?.displayName || homeComp.athlete?.displayName || '';
            const homeShort = homeComp.team?.shortDisplayName || '';
            const homeAbbr = homeComp.team?.abbreviation || '';
            const homeScore = this.parseScore(homeComp);

            const awayFull = awayComp.team?.displayName || awayComp.athlete?.displayName || '';
            const awayShort = awayComp.team?.shortDisplayName || '';
            const awayAbbr = awayComp.team?.abbreviation || '';
            const awayScore = this.parseScore(awayComp);

            const statusType = comp.status?.type || ev.status?.type;
            const stateRaw = statusType?.state || '';
            const isLive = stateRaw === 'in';
            const isFinished = stateRaw === 'post' || Boolean(statusType?.completed);
            const state: 'live' | 'finished' | 'scheduled' = isLive
              ? 'live'
              : isFinished
              ? 'finished'
              : 'scheduled';

            const periodDetail = (statusType?.shortDetail || statusType?.detail || '').trim();

            parsed.push({
              sport: sportKey,
              homeFull,
              homeShort,
              homeAbbr,
              homeScore,
              awayFull,
              awayShort,
              awayAbbr,
              awayScore,
              state,
              periodDetail
            });
          }

          return parsed;
        } catch {
          return [];
        }
      });

      const results = await Promise.all(fetchPromises);
      this.games = results.flat();
      this.lastFetchTime = Date.now();
    } finally {
      this.isFetching = false;
    }
  }

  private words(text: string): string[] {
    return text.split(' ').filter(x => x.length > 2 && !STOP_WORDS.has(x));
  }

  /** How well a name matches an ESPN team: 3 exact, 2 one name contains the other, 1 same distinctive words, 0 no */
  private teamScore(name: string, espnFull: string, espnShort: string, espnAbbr: string): number {
    const w = this.normalizeText(name);
    const ef = this.normalizeText(espnFull);
    const es = this.normalizeText(espnShort);
    const ea = this.normalizeText(espnAbbr);
    if (!w || (!ef && !es)) return 0;
    if (w === ef || w === es || w === ea) return 3;
    const contains = (a: string, b: string) => a.length >= 4 && b.length >= 4 && (` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `));
    if (contains(w, ef) || contains(w, es)) return 2;
    // Every distinctive word of the shorter name must be in the other: "Manchester United" is not "Manchester City"
    const ww = this.words(w);
    for (const other of [ef, es]) {
      const ow = this.words(other);
      if (!ww.length || !ow.length) continue;
      const [few, many] = ww.length <= ow.length ? [ww, ow] : [ow, ww];
      if (few.every(x => many.indexOf(x) >= 0)) return 1;
    }
    return 0;
  }

  private teamMatches(name: string, espnFull: string, espnShort: string, espnAbbr: string): boolean {
    return this.teamScore(name, espnFull, espnShort, espnAbbr) > 0;
  }

  /**
   * Score of a portal match from the cached ESPN games, or null when no game matches or it has not started.
   * Both teams must match; the best-matching game and orientation win, so derbies keep each score with its team.
   */
  public findScore(homeName: string, awayName: string): LiveMatchScore | null {
    if (!homeName || !awayName || this.games.length === 0) return null;
    let best: { game: NormalizedEspnGame; swapped: boolean; score: number } | null = null;
    for (const g of this.games) {
      const direct = [this.teamScore(homeName, g.homeFull, g.homeShort, g.homeAbbr), this.teamScore(awayName, g.awayFull, g.awayShort, g.awayAbbr)];
      const cross = [this.teamScore(homeName, g.awayFull, g.awayShort, g.awayAbbr), this.teamScore(awayName, g.homeFull, g.homeShort, g.homeAbbr)];
      const d = direct[0] && direct[1] ? direct[0] + direct[1] : 0;
      const c = cross[0] && cross[1] ? cross[0] + cross[1] : 0;
      const top = Math.max(d, c);
      if (top && (!best || top > best.score)) best = { game: g, swapped: c > d, score: top };
    }
    if (!best || best.game.state === 'scheduled') return null;
    const g = best.game;
    return {
      homeScore: (best.swapped ? g.awayScore : g.homeScore) || '0',
      awayScore: (best.swapped ? g.homeScore : g.awayScore) || '0',
      state: g.state,
      periodDetail: g.periodDetail,
      sport: g.sport
    };
  }
}

export const scoreboardService = new ScoreboardService();

