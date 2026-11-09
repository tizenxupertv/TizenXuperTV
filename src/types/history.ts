export interface EpisodePlaybackRecord {
  episodeId?: string;
  episodeNumber?: number | string;
  seasonNumber?: number;
  seasonId?: string;
  position: number;
  duration: number;
  finished: boolean;
  updatedAt: number;
}

export interface HistoryItem {
  id: string;
  title: string;
  poster: string;
  series: boolean;
  episodeId?: string;
  episodeNumber?: number | string;
  seasonNumber?: number;
  seasonId?: string;
  position: number;   // seconds played
  duration: number;   // total seconds
  updatedAt: number;  // timestamp ms
  watchedEpisodes?: Record<string, EpisodePlaybackRecord>;
  category?: string;
  restricted?: boolean;
  privateContent?: boolean;
}
