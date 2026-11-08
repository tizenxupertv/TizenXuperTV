export interface VodEpisode {
  id: string;
  name?: string;
  title?: string;
  number?: number | string;
  seriesNumber?: number | string;
  streamUrl?: string;
  duration?: number | string;
  quality?: string;
  qualities?: string[];
  picture?: string;
  description?: string;
}

export interface VodSeason {
  id: string;
  name: string;
  number: number;
  episodes: VodEpisode[];
}

export interface VodItem {
  id: string;
  title: string;
  category?: string;
  kind?: 'pelicula' | 'serie' | 'destacado' | 'infantil' | 'anime' | string;
  score?: string;
  year?: string;
  duration?: string;
  genres?: string[];
  director?: string;
  actors?: string;
  synopsis?: string;
  poster?: string;
  landscape?: string;
  backdrop?: string;
  streamUrl?: string;
  trailerUrl?: string;
  quality?: string;
  qualities?: string[];
  isSeries?: boolean;
  seasons?: VodSeason[];
  episodes?: VodEpisode[];
  row?: string;
  /** Collection tile (portal aggregation row): the column of the tab's root it opens */
  collectionId?: number;
  _portal?: boolean;
}

export interface PersonDetail {
  puId: string;
  name: string;
  icon?: string;
  birthPlace?: string;
  birthTime?: string;
  awards?: string;
  introduction?: string;
  personType?: number; // 0: Actor, 1: Director
}

export interface PersonResult {
  directors: PersonDetail[];
  actors: PersonDetail[];
}

export function parseCastFromVodItem(item: VodItem): PersonDetail[] {
  const dirs: PersonDetail[] = (item.director || '')
    .split(/[,;/]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(name => ({ puId: '', name, personType: 1 }));
  const acts: PersonDetail[] = (item.actors || '')
    .split(/[,;/]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(name => ({ puId: '', name, personType: 2 }));
  return [...dirs, ...acts].slice(0, 24);
}
