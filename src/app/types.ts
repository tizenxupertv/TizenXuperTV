import { Dispatch, SetStateAction } from 'react';
import { VodItem, VodEpisode, VodSeason } from '../types/vod';

export type Setter<T> = Dispatch<SetStateAction<T>>;

export type FocusDomain = 'header' | 'content';

/** Fullscreen live drawer areas: search icon, search keyboard, categories, channels */
export type DrawerArea = 'cats' | 'channels' | 'search' | 'searchbtn';

export interface VodPlayerState {
  item: VodItem;
  episode?: VodEpisode;
  isTrailer?: boolean;
  /** Seconds to resume from */
  startAt?: number;
  /** Content id of the season the episode belongs to (portal: each season is its own id) */
  seriesId?: string;
  seasonNumber?: number;
  /** Episodes of that season, used for "next episode" */
  episodes?: VodEpisode[];
  /** Full list of seasons of the series */
  seasons?: VodSeason[];
}

/** Episodes currently shown in the detail screen (the selected season) */
export interface DetailEpisodes {
  episodes: VodEpisode[];
  seasonId?: string;
  seasonNumber?: number;
  activeEpisodeIndex?: number;
  seasons?: VodSeason[];
}

export interface LiveLocation {
  catIndex: number;
  channelIndex: number;
}
