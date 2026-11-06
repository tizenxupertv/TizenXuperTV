import { TvKey } from '../../hooks/useTvRemote';
import { favoritesService } from '../../services/favoritesService';
import { settingsService, applySubtitleChoice, subtitleChoiceIndex, QUALITY_OPTIONS } from '../../services/settingsService';
import { VodDetailFocus, AUDIO_OPTIONS, SUB_OPTIONS, EP_RANGE } from '../../views/VodDetailView';
import { VodItem, VodEpisode } from '../../types/vod';
import { DetailCounts } from '../useVodDetail';
import { Setter, VodPlayerState, DetailEpisodes } from '../types';

export interface VodDetailKeysCtx {
  setActiveVodPlayer: Setter<VodPlayerState | null>;
  activeDetailItem: VodItem;
  setActiveDetailItem: Setter<VodItem | null>;
  handleBackDetail?: () => void;
  detailFocus: VodDetailFocus;
  setDetailFocus: Setter<VodDetailFocus>;
  detailCounts: DetailCounts;
  handleOpenDetail: (item: VodItem) => void;
  currentRelatedItems: VodItem[];
  detailEpisodes: DetailEpisodes;
  playFromDetail: (item: VodItem, episode?: VodEpisode, isTrailer?: boolean) => void;
}

export function handleVodDetailKeys(key: TvKey, ctx: VodDetailKeysCtx): boolean {
  const {
    setActiveVodPlayer,
    activeDetailItem,
    setActiveDetailItem,
    detailFocus,
    setDetailFocus,
    detailCounts,
    handleOpenDetail,
    currentRelatedItems,
    detailEpisodes,
    playFromDetail
  } = ctx;
  const { area, actionIndex, seasonIndex, episodeIndex, relatedIndex } = detailFocus;
  const isSeries = Boolean(activeDetailItem.isSeries || activeDetailItem.kind === 'serie' || detailCounts.isSeries);
  const seasonsCount = detailCounts.seasonsCount;
  const episodesCount = detailCounts.episodesCount;
  const relatedCount = currentRelatedItems.length;
  const hasTrailer = Boolean(detailCounts.hasTrailer || activeDetailItem.trailerUrl || (activeDetailItem as any).trailer);
  const maxActionIndex = hasTrailer ? 5 : 4;
  const rangeCount = Math.ceil(episodesCount / EP_RANGE);

  // Modal has top priority for back and dpad
  if (area === 'audioModal') {
    const col = detailFocus.modalCol || 'audio';
    const idx = detailFocus.modalIndex || 0;

    // The list under the Audio (action 2) or Subtítulos (action 3) button
    const homeAction = col === 'subs' ? 3 : 2;
    if (key === 'back' || key === 'left' || key === 'right') {
      setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: homeAction }));
      return true;
    }
    if (key === 'up') {
      setDetailFocus(prev => ({ ...prev, modalIndex: Math.max(0, idx - 1) }));
      return true;
    }
    if (key === 'down') {
      const maxIdx = col === 'audio' ? AUDIO_OPTIONS.length - 1 : SUB_OPTIONS.length - 1;
      setDetailFocus(prev => ({ ...prev, modalIndex: Math.min(maxIdx, idx + 1) }));
      return true;
    }
    if (key === 'enter') {
      // Same preferences as the profile (Configuración global)
      if (col === 'audio') settingsService.set({ audio: idx });
      else applySubtitleChoice(idx);
      setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: homeAction }));
      return true;
    }
    return true;
  }

  const doBack = () => {
    if (ctx.handleBackDetail) ctx.handleBackDetail();
    else setActiveDetailItem(null);
  };

  if (key === 'back') {
    // Back closes the open season list first
    if (area === 'seasonMenu') setDetailFocus(prev => ({ ...prev, area: 'seasons' }));
    else doBack();
    return true;
  }

  if (area === 'back') {
    if (key === 'down') {
      setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: 0 }));
      return true;
    }
    if (key === 'enter') {
      doBack();
      return true;
    }
    return true;
  }

  if (area === 'actions') {
    if (key === 'up') {
      setDetailFocus(prev => ({ ...prev, area: 'back' }));
      return true;
    }
    if (key === 'down') {
      if (isSeries && seasonsCount > 1) {
        setDetailFocus(prev => ({ ...prev, area: 'seasons' }));
      } else if (isSeries && episodesCount > 0) {
        setDetailFocus(prev => {
          const targetEp = (prev.episodeIndex !== undefined && prev.episodeIndex > 0)
            ? prev.episodeIndex
            : (detailEpisodes.activeEpisodeIndex ?? prev.episodeIndex ?? 0);
          const safeEp = Math.min(episodesCount - 1, Math.max(0, targetEp));
          return { ...prev, area: 'episodes', episodeIndex: safeEp };
        });
      } else if (relatedCount > 0) {
        setDetailFocus(prev => ({ ...prev, area: 'related', relatedIndex: 0 }));
      }
      return true;
    }
    if (key === 'left') {
      setDetailFocus(prev => ({ ...prev, actionIndex: Math.max(0, prev.actionIndex - 1) }));
      return true;
    }
    if (key === 'right') {
      setDetailFocus(prev => ({ ...prev, actionIndex: Math.min(maxActionIndex, prev.actionIndex + 1) }));
      return true;
    }
    if (key === 'enter') {
      if (actionIndex === 0) {
        playFromDetail(activeDetailItem);
      } else if (actionIndex === 1) {
        favoritesService.toggleFavorite(activeDetailItem.id);
      } else if (actionIndex === 2) {
        setDetailFocus(prev => ({ ...prev, area: 'audioModal', modalCol: 'audio', modalIndex: settingsService.get().audio }));
      } else if (actionIndex === 3) {
        setDetailFocus(prev => ({ ...prev, area: 'audioModal', modalCol: 'subs', modalIndex: subtitleChoiceIndex(settingsService.get()) }));
      } else if (actionIndex === 4) {
        const q = settingsService.get().quality || 0;
        settingsService.set({ quality: (q + 1) % QUALITY_OPTIONS.length });
      } else if (actionIndex === 5 && hasTrailer) {
        playFromDetail(activeDetailItem, undefined, true);
      }
      return true;
    }
    return true;
  }

  // Open season list: Up/Down highlight, OK loads that season, Back closes
  if (area === 'seasonMenu') {
    const m = detailFocus.seasonMenuIndex ?? seasonIndex;
    if (key === 'up' || key === 'down') {
      const next = key === 'up' ? Math.max(0, m - 1) : Math.min(seasonsCount - 1, m + 1);
      setDetailFocus(prev => ({ ...prev, seasonMenuIndex: next }));
      return true;
    }
    if (key === 'enter') {
      setDetailFocus(prev => ({
        ...prev,
        area: 'seasons',
        seasonIndex: m,
        episodeIndex: prev.seasonIndex === m ? prev.episodeIndex : 0,
        rangeIndex: undefined
      }));
      return true;
    }
    if (key === 'left') {
      setDetailFocus(prev => ({ ...prev, area: 'seasons' }));
      return true;
    }
    return true;
  }

  if (area === 'seasons') {
    if (key === 'up') {
      setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: 0 }));
      return true;
    }
    if (key === 'enter') {
      setDetailFocus(prev => ({ ...prev, area: 'seasonMenu', seasonMenuIndex: prev.seasonIndex }));
      return true;
    }
    if (key === 'left' || key === 'right') return true;
    if (key === 'down') {
      if (episodesCount > 0) {
        setDetailFocus(prev => {
          const targetEp = (prev.episodeIndex !== undefined && prev.episodeIndex > 0)
            ? prev.episodeIndex
            : (detailEpisodes.activeEpisodeIndex ?? prev.episodeIndex ?? 0);
          const safeEp = Math.min(episodesCount - 1, Math.max(0, targetEp));
          return { ...prev, area: 'episodes', episodeIndex: safeEp };
        });
      } else if (relatedCount > 0) {
        setDetailFocus(prev => ({ ...prev, area: 'related', relatedIndex: 0 }));
      }
      return true;
    }
    return true;
  }

  // Ranges row ("1-20", "21-40"…): moving shows that range, Down enters it
  if (area === 'epRanges') {
    const r = detailFocus.rangeIndex ?? Math.floor(episodeIndex / EP_RANGE);
    if (key === 'left' || key === 'right') {
      const next = key === 'left' ? Math.max(0, r - 1) : Math.min(rangeCount - 1, r + 1);
      setDetailFocus(prev => ({ ...prev, rangeIndex: next, episodeIndex: next * EP_RANGE }));
      return true;
    }
    if (key === 'down' || key === 'enter') {
      setDetailFocus(prev => ({ ...prev, area: 'episodes', episodeIndex: Math.min(episodesCount - 1, r * EP_RANGE) }));
      return true;
    }
    if (key === 'up') {
      if (seasonsCount > 1) setDetailFocus(prev => ({ ...prev, area: 'seasons' }));
      else setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: 0 }));
      return true;
    }
    return true;
  }

  if (area === 'episodes') {
    if (key === 'up') {
      if (rangeCount > 1) {
        setDetailFocus(prev => ({ ...prev, area: 'epRanges', rangeIndex: Math.floor(prev.episodeIndex / EP_RANGE) }));
      } else if (seasonsCount > 1) {
        setDetailFocus(prev => ({ ...prev, area: 'seasons' }));
      } else {
        setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: 0 }));
      }
      return true;
    }
    if (key === 'down') {
      if (relatedCount > 0) {
        setDetailFocus(prev => ({ ...prev, area: 'related', relatedIndex: 0 }));
      }
      return true;
    }
    if (key === 'left') {
      setDetailFocus(prev => ({ ...prev, episodeIndex: Math.max(0, prev.episodeIndex - 1) }));
      return true;
    }
    if (key === 'right') {
      setDetailFocus(prev => ({ ...prev, episodeIndex: Math.min(episodesCount - 1, prev.episodeIndex + 1) }));
      return true;
    }
    if (key === 'enter') {
      const ep = detailEpisodes.episodes[episodeIndex];
      if (ep) playFromDetail(activeDetailItem, ep);
      return true;
    }
    return true;
  }

  if (area === 'related') {
    if (key === 'up') {
      if (isSeries && episodesCount > 0) {
        setDetailFocus(prev => ({ ...prev, area: 'episodes' }));
      } else {
        setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: 0 }));
      }
      return true;
    }
    if (key === 'left') {
      setDetailFocus(prev => ({ ...prev, relatedIndex: Math.max(0, prev.relatedIndex - 1) }));
      return true;
    }
    if (key === 'right') {
      setDetailFocus(prev => ({ ...prev, relatedIndex: Math.min(relatedCount - 1, prev.relatedIndex + 1) }));
      return true;
    }
    if (key === 'enter') {
      const rel = currentRelatedItems[relatedIndex];
      if (rel) {
        handleOpenDetail(rel);
      }
      return true;
    }
    return true;
  }

  return true;
}
