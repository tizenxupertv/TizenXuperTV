import { useState, useCallback, useMemo, useRef } from 'react';
import { VodDetailFocus } from '../views/VodDetailView';
import { VodItem } from '../types/vod';
import { DetailEpisodes } from './types';
import type { TitleChoices } from '../lib/titleOptions';

export interface DetailCounts {
  seasonsCount: number;
  episodesCount: number;
  relatedCount: number;
  isSeries: boolean;
  hasTrailer?: boolean;
  /** What the title offers for Audio / Subtítulos / Resolución (all options while unknown) */
  choices?: TitleChoices;
}

interface DetailHistoryEntry {
  item: VodItem;
  focus: VodDetailFocus;
}

/** VOD detail screen state and the related items shown on it */
export function useVodDetail(featuredItems: VodItem[], movieItems: VodItem[], seriesItems: VodItem[]) {
  const [activeDetailItem, setActiveDetailItem] = useState<VodItem | null>(null);
  const [detailFocus, setDetailFocus] = useState<VodDetailFocus>({
    area: 'actions',
    actionIndex: 0,
    seasonIndex: 0,
    episodeIndex: 0,
    relatedIndex: 0
  });
  const [detailCounts, setDetailCounts] = useState<DetailCounts>({
    seasonsCount: 1,
    episodesCount: 0,
    relatedCount: 0,
    isSeries: false
  });

  const [detailEpisodes, setDetailEpisodes] = useState<DetailEpisodes>({ episodes: [] });

  const detailHistoryRef = useRef<DetailHistoryEntry[]>([]);
  const currentDetailItemRef = useRef<VodItem | null>(null);
  currentDetailItemRef.current = activeDetailItem;
  const currentDetailFocusRef = useRef<VodDetailFocus>(detailFocus);
  currentDetailFocusRef.current = detailFocus;

  const handleOpenDetail = useCallback((item: VodItem) => {
    if (currentDetailItemRef.current && currentDetailItemRef.current.id !== item.id) {
      detailHistoryRef.current.push({
        item: currentDetailItemRef.current,
        focus: currentDetailFocusRef.current
      });
    }
    setDetailEpisodes({ episodes: [] });
    setActiveDetailItem(item);
    setDetailFocus({
      area: 'actions',
      actionIndex: 0,
      seasonIndex: 0,
      episodeIndex: 0,
      relatedIndex: 0
    });
  }, []);

  const handleBackDetail = useCallback(() => {
    if (detailHistoryRef.current.length > 0) {
      const prev = detailHistoryRef.current.pop()!;
      setDetailEpisodes({ episodes: [] });
      setActiveDetailItem(prev.item);
      setDetailFocus(prev.focus);
    } else {
      setActiveDetailItem(null);
    }
  }, []);

  const closeDetail = useCallback(() => {
    detailHistoryRef.current = [];
    setActiveDetailItem(null);
  }, []);

  // Compute related items for active detail screen
  const currentRelatedItems = useMemo<VodItem[]>(() => {
    if (!activeDetailItem) return [];
    const isSer = Boolean(activeDetailItem.isSeries || activeDetailItem.kind === 'serie');
    const pool = isSer
      ? (seriesItems.length > 0 ? seriesItems : featuredItems)
      : (movieItems.length > 0 ? movieItems : featuredItems);
    return pool.filter(it => it.id !== activeDetailItem.id).slice(0, 10);
  }, [activeDetailItem, seriesItems, movieItems, featuredItems]);

  return {
    activeDetailItem,
    setActiveDetailItem,
    detailFocus,
    setDetailFocus,
    detailCounts,
    setDetailCounts,
    handleOpenDetail,
    handleBackDetail,
    closeDetail,
    currentRelatedItems,
    detailEpisodes,
    setDetailEpisodes
  };
}
