import type {
  LiveMatchScore,
  FullMatchDetails,
  MatchEventItem,
  MatchLineup,
  MatchPlayer,
  MatchStatComparison,
  MatchEventType
} from '../types/sports.ts';

interface EspnCompetitor {
  homeAway: 'home' | 'away';
  score?: string;
  linescores?: Array<{ value: number }>;
  team?: {
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    logo?: string;
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
  id: string;
  sport: string;
  summaryPath: string;
  homeFull: string;
  homeShort: string;
  homeAbbr: string;
  homeLogo?: string;
  homeScore: string;
  awayFull: string;
  awayShort: string;
  awayAbbr: string;
  awayLogo?: string;
  awayScore: string;
  state: 'live' | 'finished' | 'scheduled';
  periodDetail: string;
}

const ESPN_SUMMARY_PATHS: Record<string, string> = {
  soccer: 'soccer/all',
  nba: 'basketball/nba',
  nfl: 'football/nfl',
  mlb: 'baseball/mlb',
  nhl: 'hockey/nhl',
  cfb: 'football/college-football',
  cfl: 'football/cfl'
};

const ESPN_ENDPOINTS: Record<string, string> = {
  nba: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  nhl: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
  // Without a limit ESPN returns only 100 soccer games and the top-25 college games
  soccer: 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?limit=500',
  cfb: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300',
  cfl: 'https://site.api.espn.com/apis/site/v2/sports/football/cfl/scoreboard',
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
  /** Games by the words of their team names, so a match is only compared with the games that share a word */
  private index = new Map<string, number[]>();
  private indexedGames: NormalizedEspnGame[] | null = null;
  /** findScore answers for the current games (cleared when new games arrive) */
  private results = new Map<string, LiveMatchScore | null>();

  /** Index keys of a name: its distinctive words, its initials and its abbreviation */
  private keysOf(name: string, abbr = ''): string[] {
    const n = this.normalizeText(name);
    const keys = this.words(n);
    const parts = n.split(' ').filter(Boolean);
    if (parts.length > 1) keys.push('~' + parts.map(x => (x === 'fc' || x === 'sc' || x === 'cf' ? x : x[0])).join(''));
    const a = this.normalizeText(abbr).replace(/ /g, '');
    if (a.length >= 3) keys.push('~' + a);
    return keys;
  }

  private ensureIndex(): void {
    if (this.indexedGames === this.games) return;
    this.indexedGames = this.games;
    this.index.clear();
    this.results.clear();
    this.games.forEach((g, i) => {
      const keys = [
        ...this.keysOf(g.homeFull, g.homeAbbr), ...this.keysOf(g.homeShort),
        ...this.keysOf(g.awayFull, g.awayAbbr), ...this.keysOf(g.awayShort)
      ];
      for (const k of keys) {
        const list = this.index.get(k);
        if (!list) this.index.set(k, [i]);
        else if (list[list.length - 1] !== i) list.push(i);
      }
    });
  }

  /** Games that share at least one key with either team */
  private candidates(homeName: string, awayName: string): NormalizedEspnGame[] {
    const seen = new Set<number>();
    for (const k of [...this.keysOf(homeName), ...this.keysOf(awayName)]) {
      const list = this.index.get(k);
      if (list) list.forEach(i => seen.add(i));
    }
    return Array.from(seen, i => this.games[i]);
  }

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
            const homeLogo = homeComp.team?.logo;
            const homeScore = this.parseScore(homeComp);

            const awayFull = awayComp.team?.displayName || awayComp.athlete?.displayName || '';
            const awayShort = awayComp.team?.shortDisplayName || '';
            const awayAbbr = awayComp.team?.abbreviation || '';
            const awayLogo = awayComp.team?.logo;
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
              id: ev.id,
              sport: sportKey,
              summaryPath: ESPN_SUMMARY_PATHS[sportKey] || 'soccer/all',
              homeFull,
              homeShort,
              homeAbbr,
              homeLogo,
              homeScore,
              awayFull,
              awayShort,
              awayAbbr,
              awayLogo,
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
    // Initials: "Los Angeles FC" is ESPN's "LAFC"
    const initials = w.split(' ').filter(Boolean).map(x => (x === 'fc' || x === 'sc' || x === 'cf' ? x : x[0])).join('');
    if (initials.length >= 3 && (initials === ea || initials === es.replace(/ /g, ''))) return 1;
    // US teams are "<place> <nickname>": "Brigham Young Cougars" is ESPN's "BYU Cougars". The nickname alone only
    // counts when the place also shares a letter start, so "Utah Utes" never takes "Utah Jazz"
    const wl = w.split(' ');
    const fl = ef.split(' ');
    const nick = wl[wl.length - 1];
    if (nick.length >= 4 && nick === fl[fl.length - 1] && wl.length > 1 && fl.length > 1 && wl[0][0] === fl[0][0]) return 1;
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
    this.ensureIndex();
    const cacheKey = `${homeName}|${awayName}`;
    if (this.results.has(cacheKey)) return this.results.get(cacheKey) || null;
    const found = this.matchScore(homeName, awayName);
    this.results.set(cacheKey, found);
    return found;
  }

  public findBestMatch(homeName: string, awayName: string): { game: NormalizedEspnGame; swapped: boolean } | null {
    if (!homeName || !awayName || this.games.length === 0) return null;
    this.ensureIndex();
    let best: { game: NormalizedEspnGame; swapped: boolean; score: number } | null = null;
    for (const g of this.candidates(homeName, awayName)) {
      const direct = [this.teamScore(homeName, g.homeFull, g.homeShort, g.homeAbbr), this.teamScore(awayName, g.awayFull, g.awayShort, g.awayAbbr)];
      const cross = [this.teamScore(homeName, g.awayFull, g.awayShort, g.awayAbbr), this.teamScore(awayName, g.homeFull, g.homeShort, g.homeAbbr)];
      const d = direct[0] && direct[1] ? direct[0] + direct[1] : 0;
      const c = cross[0] && cross[1] ? cross[0] + cross[1] : 0;
      const top = Math.max(d, c);
      if (top && (!best || top > best.score)) best = { game: g, swapped: c > d, score: top };
    }
    return best;
  }

  private matchScore(homeName: string, awayName: string): LiveMatchScore | null {
    const best = this.findBestMatch(homeName, awayName);
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

  public async getMatchDetails(homeName: string, awayName: string): Promise<FullMatchDetails | null> {
    const match = this.findBestMatch(homeName, awayName);
    if (!match) return null;
    const { game, swapped } = match;
    const url = `https://site.api.espn.com/apis/site/v2/sports/${game.summaryPath}/summary?event=${game.id}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return this.parseMatchSummary(game, data, swapped);
    } catch (e) {
      console.warn('[scoreboardService] failed to fetch match summary:', e);
      return null;
    }
  }

  private parseMatchSummary(game: NormalizedEspnGame, data: any, swapped: boolean): FullMatchDetails {
    const homeName = swapped ? game.awayFull : game.homeFull;
    const awayName = swapped ? game.homeFull : game.awayFull;
    const homeLogo = swapped ? game.awayLogo : game.homeLogo;
    const awayLogo = swapped ? game.homeLogo : game.awayLogo;
    const homeScore = (swapped ? game.awayScore : game.homeScore) || '0';
    const awayScore = (swapped ? game.homeScore : game.awayScore) || '0';

    // 1. Events (Key Events timeline: Goals, Cards, Substitutions)
    const rawEvents: any[] = data.keyEvents || [];
    const events: MatchEventItem[] = [];

    for (const k of rawEvents) {
      const text = (k.type?.text || '').toLowerCase();
      const typeStr = (k.type?.type || '').toLowerCase();
      let type: MatchEventType = 'other';

      if (typeStr.includes('goal') || text.includes('goal') || k.scoringPlay) {
        type = 'goal';
      } else if (typeStr.includes('yellow-card') || text.includes('yellow card')) {
        type = 'yellow_card';
      } else if (typeStr.includes('red-card') || text.includes('red card')) {
        type = 'red_card';
      } else if (typeStr.includes('substitution') || text.includes('substitution')) {
        type = 'substitution';
      } else if (text.includes('penalty')) {
        type = 'penalty';
      } else {
        continue; // Skip delays, kickoffs and generic messages
      }

      const teamName = k.team?.displayName || '';
      const isHome = this.teamMatches(teamName, homeName, '', '');
      const teamSide: 'home' | 'away' = isHome ? 'home' : 'away';

      const player = k.participants?.[0]?.athlete?.displayName || k.shortText || '';
      const subPlayer = type === 'substitution' ? k.participants?.[1]?.athlete?.displayName : undefined;

      events.push({
        id: k.id || String(Math.random()),
        type,
        time: k.clock?.displayValue || '',
        teamSide,
        player,
        subPlayer,
        detail: k.text
      });
    }

    // 2. Lineups & Formations
    let lineups: { home: MatchLineup; away: MatchLineup } | undefined;
    const rosters: any[] = data.rosters || [];
    if (rosters.length >= 2) {
      const r0IsHome = this.teamMatches(rosters[0]?.team?.displayName || '', homeName, '', '');
      const homeRoster = r0IsHome ? rosters[0] : rosters[1];
      const awayRoster = r0IsHome ? rosters[1] : rosters[0];

      const parsePlayers = (list: any[] = []) => {
        const starters: MatchPlayer[] = [];
        const bench: MatchPlayer[] = [];
        for (const p of list) {
          const item: MatchPlayer = {
            id: p.athlete?.id || p.jersey || p.athlete?.displayName,
            name: p.athlete?.displayName || p.athlete?.fullName || '',
            jersey: p.jersey,
            position: p.position?.abbreviation,
            starter: Boolean(p.starter)
          };
          if (p.starter) starters.push(item);
          else bench.push(item);
        }
        return { starters, bench };
      };

      const hP = parsePlayers(homeRoster?.roster);
      const aP = parsePlayers(awayRoster?.roster);

      lineups = {
        home: {
          formation: homeRoster?.formation,
          starters: hP.starters,
          bench: hP.bench
        },
        away: {
          formation: awayRoster?.formation,
          starters: aP.starters,
          bench: aP.bench
        }
      };
    }

    // 3. Match Statistics Comparison
    const stats: MatchStatComparison[] = [];
    const teams: any[] = data.boxscore?.teams || [];
    if (teams.length >= 2) {
      const t0IsHome = this.teamMatches(teams[0]?.team?.displayName || '', homeName, '', '');
      const hTeam = t0IsHome ? teams[0] : teams[1];
      const aTeam = t0IsHome ? teams[1] : teams[0];

      const hStatsMap = new Map<string, string>();
      const aStatsMap = new Map<string, string>();

      (hTeam.statistics || []).forEach((s: any) => hStatsMap.set(s.name, s.displayValue));
      (aTeam.statistics || []).forEach((s: any) => aStatsMap.set(s.name, s.displayValue));

      const STAT_DEFS: Array<{ name: string; label: string }> = [
        { name: 'possession', label: 'Posesión (%)' },
        { name: 'shots', label: 'Remates Totales' },
        { name: 'onGoal', label: 'Remates al Arco' },
        { name: 'fouls', label: 'Faltas Cometidas' },
        { name: 'cornerKicks', label: 'Tiros de Esquina' },
        { name: 'offsides', label: 'Fueras de Juego' },
        { name: 'yellowCards', label: 'Tarjetas Amarillas' },
        { name: 'redCards', label: 'Tarjetas Rojas' },
        { name: 'accuratePasses', label: 'Pases Precisos' },
        { name: 'saves', label: 'Atajadas' }
      ];

      for (const def of STAT_DEFS) {
        const hVal = hStatsMap.get(def.name);
        const aVal = aStatsMap.get(def.name);
        if (hVal !== undefined || aVal !== undefined) {
          const numH = parseFloat(hVal || '0') || 0;
          const numA = parseFloat(aVal || '0') || 0;
          const total = numH + numA;
          const homePercent = total > 0 ? Math.round((numH / total) * 100) : 50;
          const awayPercent = total > 0 ? 100 - homePercent : 50;

          stats.push({
            label: def.label,
            homeValue: hVal ?? '0',
            awayValue: aVal ?? '0',
            homePercent,
            awayPercent
          });
        }
      }
    }

    return {
      gameId: game.id,
      sport: game.sport,
      homeTeam: homeName,
      awayTeam: awayName,
      homeLogo,
      awayLogo,
      homeScore,
      awayScore,
      status: game.state,
      periodDetail: game.periodDetail,
      events,
      lineups,
      stats
    };
  }
}

export const scoreboardService = new ScoreboardService();

