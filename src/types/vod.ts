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
  /** Candidate artwork URLs in priority order for automatic fallback on load error */
  posterAlternates?: string[];
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
  /** True when the item belongs to a restricted (+18) column or category */
  restricted?: boolean;
  privateContent?: boolean;
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

export type SettingsCol = 'menu' | 'audio' | 'subs' | 'quality';

export type DetailFocusArea = 'back' | 'synopsis' | 'actions' | 'quick' | 'seasons' | 'seasonMenu' | 'epRanges' | 'episodes' | 'cast' | 'related' | 'audioModal';

export type SynopsisModalArea = 'close' | 'cast';

export interface VodDetailFocus {
  area: DetailFocusArea;
  actionIndex: number;
  seasonIndex: number;
  episodeIndex: number;
  relatedIndex: number;
  castIndex?: number;
  showSynopsisModal?: boolean;
  synopsisModalArea?: SynopsisModalArea;
  /** Small buttons under the big ones: Mi lista, Ajustes, Tráiler */
  quickIndex?: number;
  /** Season highlighted in the open season list (the season loads only when picked) */
  seasonMenuIndex?: number;
  /** Range of 20 episodes focused in the ranges row ("1-20", "21-40"…) */
  rangeIndex?: number;
  /** Settings list: 'menu' (Audio / Subtítulos / Resolución) or the options of one of them */
  modalCol?: SettingsCol;
  modalIndex?: number;
}

/** Episodes per range, as the official app: long series stay light and quick to cross */
export const EP_RANGE = 20;

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
