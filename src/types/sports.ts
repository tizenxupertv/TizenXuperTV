export type SportCategory =
  | 'all'
  | 'live'
  | 'football'
  /** EPIC+'s own football agenda (services/epicAgendaService.ts), apart from the main list */
  | 'football_plus'
  | 'basketball'
  | 'american_football'
  | 'baseball'
  | 'fighting'
  | 'tennis'
  | 'motor_sport'
  | 'other';

export interface SportTabDef {
  id: SportCategory;
  label: string;
  icon?: string;
}

export interface SportsEvent {
  id: string;
  sport: SportCategory;
  sportLabel: string;
  league: string;
  home: string;
  away: string;
  homeLogo?: string;
  awayLogo?: string;
  leagueLogo?: string;
  startTime: string; // ISO 8601
  startMillis: number;
  endMillis: number;
  status: 'live' | 'scheduled' | 'finished';
  linksPath: string;
  linkNames: string[];
  priority?: number;
}

export interface LiveMatchScore {
  homeScore: string;
  awayScore: string;
  state: 'live' | 'finished' | 'scheduled';
  periodDetail: string;
  sport: string;
}

export interface SportsStream {
  name: string;
  url: string;
  scheme: number;
  drmApi?: string;
  headers: Record<string, string>;
  tokenApi?: string;
}


export type MatchEventType = 'goal' | 'yellow_card' | 'red_card' | 'substitution' | 'penalty' | 'other';

export interface MatchEventItem {
  id: string;
  type: MatchEventType;
  time: string;
  teamSide: 'home' | 'away';
  player: string;
  subPlayer?: string;
  score?: string;
  detail?: string;
}

export interface MatchPlayer {
  id: string;
  name: string;
  jersey?: string;
  position?: string;
  starter: boolean;
}

export interface MatchLineup {
  formation?: string;
  starters: MatchPlayer[];
  bench: MatchPlayer[];
}

export interface MatchStatComparison {
  label: string;
  homeValue: string | number;
  awayValue: string | number;
  homePercent?: number;
  awayPercent?: number;
}

export interface FullMatchDetails {
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  homeScore?: string;
  awayScore?: string;
  status: string;
  periodDetail?: string;
  events: MatchEventItem[];
  lineups?: { home: MatchLineup; away: MatchLineup };
  stats: MatchStatComparison[];
}
