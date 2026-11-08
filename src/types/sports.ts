export type SportCategory =
  | 'all'
  | 'live'
  | 'football'
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

