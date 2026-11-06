import { TvKey } from '../../hooks/useTvRemote';
import { favoritesService } from '../../services/favoritesService';
import { settingsService, applySubtitleChoice } from '../../services/settingsService';
import { VodDetailFocus, AUDIO_OPTIONS, SUB_OPTIONS } from '../../views/VodDetailView';
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
  const maxActionIndex = hasTrailer ? 3 : 2;

  // Modal has top priority for back and dpad
  if (area === 'audioModal') {
    const col = detailFocus.modalCol || 'audio';
    const idx = detailFocus.modalIndex || 0;

    if (key === 'back') {
      setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: 2 }));
      return true;
    }
    if (key === 'left') {
      setDetailFocus(prev => ({ ...prev, modalCol: 'audio', modalIndex: Math.min(idx, AUDIO_OPTIONS.length - 1) }));
      return true;
    }
    if (key === 'right') {
      setDetailFocus(prev => ({ ...prev, modalCol: 'subs', modalIndex: Math.min(idx, SUB_OPTIONS.length - 1) }));
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
      setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: 2 }));
      return true;
    }
    return true;
  }

  const doBack = () => {
    if (ctx.handleBackDetail) ctx.handleBackDetail();
    else setActiveDetailItem(null);
  };

  if (key === 'back') {
    doBack();
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
        setDetailFocus(prev => ({ ...prev, area: 'audioModal', modalCol: 'audio', modalIndex: 0 }));
      } else if (actionIndex === 3 && hasTrailer) {
        playFromDetail(activeDetailItem, undefined, true);
      }
      return true;
    }
    return true;
  }

  if (area === 'seasons') {
    if (key === 'up') {
      setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: 0 }));
      return true;
    }
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
    if (key === 'left') {
      setDetailFocus(prev => ({ ...prev, seasonIndex: Math.max(0, prev.seasonIndex - 1) }));
      return true;
    }
    if (key === 'right') {
      setDetailFocus(prev => ({ ...prev, seasonIndex: Math.min(seasonsCount - 1, prev.seasonIndex + 1) }));
      return true;
    }
    if (key === 'enter') {
      return true;
    }
    return true;
  }

  if (area === 'episodes') {
    if (key === 'up') {
      if (seasonsCount > 1) {
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
