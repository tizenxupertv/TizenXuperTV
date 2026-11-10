export interface LiveChannel {
  id: string | number;
  name: string;
  code?: string;
  url?: string;
  logo?: string;
  now?: string;
  next?: string;
  time?: string;
  isFav?: boolean;
  colId?: string | number;
  categoryName?: string;
  badge?: string;
}

export interface LiveCategory {
  id: string | number;
  name: string;
  isFav?: boolean;
  isEspn?: boolean;
  isEpicSports?: boolean;
  isM3u?: boolean;
  badge?: string;
  /** Free IPTV list shown as this category (services/iptvService) */
  iptvListId?: string;
}
