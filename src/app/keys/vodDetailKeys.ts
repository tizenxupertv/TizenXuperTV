import { TvKey } from '../../hooks/useTvRemote';
import { favoritesService } from '../../services/favoritesService';
import { settingsService, subtitleChoiceIndex, applySettingChoice, SETTINGS_ROW, QUALITY_OPTIONS, PREFERRED_LANGUAGES } from '../../services/settingsService';
import { VodDetailFocus, VodItem, VodEpisode, PersonDetail, parseCastFromVodItem, EP_RANGE } from '../../types/vod';
import { DetailCounts } from '../useVodDetail';
import { Setter, VodPlayerState, DetailEpisodes } from '../types';
import { effectiveChoice, titleChoices, type TitleChoices } from '../../lib/titleOptions';

/** What the settings list offers: the title's own options, or all of them while they are unknown */
export function settingChoices(counts: DetailCounts): TitleChoices {
  return counts.choices || titleChoices(null, PREFERRED_LANGUAGES.length, QUALITY_OPTIONS, { matches: () => false, name: () => '' });
}

/** Position, inside the options shown for `col`, of the choice that applies now (the first one when the profile's is missing) */
export function settingPosition(col: 'audio' | 'subs' | 'quality', counts: DetailCounts): number {
  const st = settingsService.get();
  const list = settingChoices(counts)[col];
  const current = col === 'audio' ? st.audio : col === 'subs' ? subtitleChoiceIndex(st) : st.quality || 0;
  return Math.max(0, list.indexOf(effectiveChoice(list, current)));
}

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
  detailCast?: PersonDetail[];
  selectedPerson?: PersonDetail | null;
  setSelectedPerson?: Setter<PersonDetail | null>;
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
    playFromDetail,
    detailCast = [],
    selectedPerson,
    setSelectedPerson
  } = ctx;

  // When PersonDetailModal is active, back closes it
  if (selectedPerson) {
    if (key === 'back') {
      if (setSelectedPerson) setSelectedPerson(null);
      return true;
    }
    return false; // let PersonDetailModal useScreenKeys handle other navigation
  }

  // When SynopsisModal is active, navigate between close button, text, and cast grid
  if (detailFocus.showSynopsisModal) {
    if (key === 'back') {
      setDetailFocus(prev => ({
        ...prev,
        showSynopsisModal: false,
        synopsisModalArea: undefined,
        area: 'quick',
        quickIndex: 1
      }));
      return true;
    }

    const pool = detailCast.length > 0 ? detailCast : parseCastFromVodItem(activeDetailItem);
    const totalCast = pool.length;
    const modalArea: 'close' | 'text' | 'cast' = detailFocus.synopsisModalArea || (totalCast > 0 ? 'cast' : 'text');

    if (modalArea === 'close') {
      if (key === 'down') {
        setDetailFocus(prev => ({ ...prev, synopsisModalArea: 'text' }));
        return true;
      }
      if (key === 'enter') {
        setDetailFocus(prev => ({
          ...prev,
          showSynopsisModal: false,
          synopsisModalArea: undefined,
          area: 'quick',
          quickIndex: 1
        }));
        return true;
      }
      return true;
    }

    if (modalArea === 'text') {
      if (key === 'up') {
        setDetailFocus(prev => ({ ...prev, synopsisModalArea: 'close' }));
        return true;
      }
      if (key === 'down') {
        if (totalCast > 0) {
          setDetailFocus(prev => ({ ...prev, synopsisModalArea: 'cast', castIndex: 0 }));
        }
        return true;
      }
      if (key === 'enter') {
        if (totalCast > 0) {
          setDetailFocus(prev => ({ ...prev, synopsisModalArea: 'cast', castIndex: 0 }));
        } else {
          setDetailFocus(prev => ({
            ...prev,
            showSynopsisModal: false,
            synopsisModalArea: undefined,
            area: 'quick',
            quickIndex: 1
          }));
        }
        return true;
      }
      return true;
    }

    // modalArea === 'cast'
    if (totalCast > 0) {
      const ci = Math.min(totalCast - 1, Math.max(0, detailFocus.castIndex ?? 0));
      const COLS = 3;

      if (key === 'left') {
        setDetailFocus(prev => ({ ...prev, castIndex: Math.max(0, ci - 1) }));
        return true;
      }
      if (key === 'right') {
        setDetailFocus(prev => ({ ...prev, castIndex: Math.min(totalCast - 1, ci + 1) }));
        return true;
      }
      if (key === 'up') {
        if (ci >= COLS) {
          setDetailFocus(prev => ({ ...prev, castIndex: Math.max(0, ci - COLS) }));
        } else {
          // Top row: go back up to synopsis text
          setDetailFocus(prev => ({ ...prev, synopsisModalArea: 'text' }));
        }
        return true;
      }
      if (key === 'down') {
        if (ci + COLS < totalCast) {
          setDetailFocus(prev => ({ ...prev, castIndex: ci + COLS }));
        } else if (ci < totalCast - 1 && Math.floor(ci / COLS) < Math.floor((totalCast - 1) / COLS)) {
          setDetailFocus(prev => ({ ...prev, castIndex: totalCast - 1 }));
        }
        return true;
      }
      if (key === 'enter') {
        const p = pool[ci] || pool[0];
        if (p && setSelectedPerson) {
          setSelectedPerson(p);
        }
        return true;
      }
    } else {
      if (key === 'up') {
        setDetailFocus(prev => ({ ...prev, synopsisModalArea: 'close' }));
        return true;
      }
      if (key === 'enter') {
        setDetailFocus(prev => ({
          ...prev,
          showSynopsisModal: false,
          synopsisModalArea: undefined,
          area: 'quick',
          quickIndex: 1
        }));
        return true;
      }
    }
    return true;
  }

  const { area, seasonIndex, episodeIndex, relatedIndex } = detailFocus;
  const isSeries = Boolean(activeDetailItem.isSeries || activeDetailItem.kind === 'serie' || detailCounts.isSeries);
  const seasonsCount = detailCounts.seasonsCount;
  const episodesCount = detailCounts.episodesCount;
  const relatedCount = currentRelatedItems.length;
  const castCount = detailCast.length || detailCounts.castCount || 0;
  const hasTrailer = Boolean(detailCounts.hasTrailer || activeDetailItem.trailerUrl || (activeDetailItem as any).trailer);
  // One row: Reproducir ('actions'), then the round buttons ('quick'): Mi lista, Info, Ajustes, Tráiler
  const quick: ('fav' | 'info' | 'settings' | 'trailer')[] = ['fav', 'info', 'settings', ...(hasTrailer ? ['trailer' as const] : [])];
  const SETTINGS_QUICK = 2;
  const rangeCount = Math.ceil(episodesCount / EP_RANGE);

  // Settings list under the ⚙ button: first level Audio / Subtítulos / Resolución, then their options
  if (area === 'audioModal') {
    const col = detailFocus.modalCol || 'menu';
    const idx = detailFocus.modalIndex || 0;
    const ROWS = ['audio', 'subs', 'quality'] as const;
    if (col === 'menu') {
      if (key === 'back' || key === 'left') {
        setDetailFocus(prev => ({ ...prev, area: 'quick', quickIndex: SETTINGS_QUICK }));
      } else if (key === 'up' || key === 'down') {
        setDetailFocus(prev => ({ ...prev, modalIndex: key === 'up' ? Math.max(0, idx - 1) : Math.min(ROWS.length - 1, idx + 1) }));
      } else if (key === 'enter' || key === 'right') {
        const next = ROWS[idx];
        setDetailFocus(prev => ({ ...prev, modalCol: next, modalIndex: settingPosition(next, detailCounts) }));
      }
      return true;
    }
    const options = settingChoices(detailCounts)[col];
    if (key === 'back' || key === 'left') {
      setDetailFocus(prev => ({ ...prev, modalCol: 'menu', modalIndex: SETTINGS_ROW[col] }));
    } else if (key === 'up' || key === 'down') {
      setDetailFocus(prev => ({ ...prev, modalIndex: key === 'up' ? Math.max(0, idx - 1) : Math.min(options.length - 1, idx + 1) }));
    } else if (key === 'enter') {
      // Same preferences as the profile (Configuración global)
      // `idx` is a position in the options shown; the preference stores the option's own index
      if (options.length) applySettingChoice(col, options[Math.min(idx, options.length - 1)]);
      setDetailFocus(prev => ({ ...prev, modalCol: 'menu', modalIndex: SETTINGS_ROW[col] }));
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

  const hasLongSynopsis = Boolean(activeDetailItem.synopsis && activeDetailItem.synopsis.length > 210);

  if (area === 'back') {
    if (key === 'down') {
      if (hasLongSynopsis) setDetailFocus(prev => ({ ...prev, area: 'synopsis' }));
      else setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: 0 }));
      return true;
    }
    if (key === 'enter') {
      doBack();
      return true;
    }
    return true;
  }

  if (area === 'synopsis') {
    if (key === 'up') {
      setDetailFocus(prev => ({ ...prev, area: 'back' }));
      return true;
    }
    if (key === 'down') {
      setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: 0 }));
      return true;
    }
    if (key === 'enter') {
      setDetailFocus(prev => ({
        ...prev,
        showSynopsisModal: true,
        synopsisModalArea: 'text',
        castIndex: 0
      }));
      return true;
    }
    return true;
  }

  // Below the action row: seasons, episodes, cast or related titles
  const goBelowActions = () => {
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
    } else if (castCount > 0) {
      setDetailFocus(prev => ({ ...prev, area: 'cast', castIndex: 0 }));
    } else if (relatedCount > 0) {
      setDetailFocus(prev => ({ ...prev, area: 'related', relatedIndex: 0 }));
    }
  };
  // Up from the sections below lands on Reproducir
  const toActions = () => setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: 0 }));

  if (area === 'actions') {
    if (key === 'up') {
      if (hasLongSynopsis) setDetailFocus(prev => ({ ...prev, area: 'synopsis' }));
      else setDetailFocus(prev => ({ ...prev, area: 'back' }));
    } else if (key === 'down') {
      goBelowActions();
    } else if (key === 'right') {
      setDetailFocus(prev => ({ ...prev, area: 'quick', quickIndex: 0 }));
    } else if (key === 'enter') {
      playFromDetail(activeDetailItem);
    }
    return true;
  }

  // Round buttons after Reproducir
  if (area === 'quick') {
    const qi = Math.min(quick.length - 1, detailFocus.quickIndex ?? 0);
    if (key === 'up') {
      if (hasLongSynopsis) setDetailFocus(prev => ({ ...prev, area: 'synopsis' }));
      else setDetailFocus(prev => ({ ...prev, area: 'back' }));
      return true;
    }
    if (key === 'down') {
      goBelowActions();
      return true;
    }
    if (key === 'left' && qi === 0) {
      toActions();
      return true;
    }
    if (key === 'left' || key === 'right') {
      setDetailFocus(prev => ({ ...prev, quickIndex: key === 'left' ? Math.max(0, qi - 1) : Math.min(quick.length - 1, qi + 1) }));
      return true;
    }
    if (key === 'enter') {
      const q = quick[qi];
      if (q === 'fav') favoritesService.toggleFavorite(activeDetailItem.id, activeDetailItem);
      else if (q === 'info') {
        const pool = detailCast.length > 0 ? detailCast : parseCastFromVodItem(activeDetailItem);
        setDetailFocus(prev => ({
          ...prev,
          showSynopsisModal: true,
          synopsisModalArea: pool.length > 0 ? 'cast' : 'text',
          castIndex: 0
        }));
      }
      else if (q === 'settings') setDetailFocus(prev => ({ ...prev, area: 'audioModal', modalCol: 'menu', modalIndex: 0 }));
      else if (q === 'trailer') playFromDetail(activeDetailItem, undefined, true);
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
      toActions();
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
      else toActions();
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
        toActions();
      }
      return true;
    }
    if (key === 'down') {
      if (castCount > 0) {
        setDetailFocus(prev => ({ ...prev, area: 'cast', castIndex: 0 }));
      } else if (relatedCount > 0) {
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

  if (area === 'cast') {
    const ci = Math.min(castCount - 1, Math.max(0, detailFocus.castIndex ?? 0));
    if (key === 'up') {
      if (isSeries && episodesCount > 0) {
        setDetailFocus(prev => ({ ...prev, area: 'episodes' }));
      } else {
        toActions();
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
      setDetailFocus(prev => ({ ...prev, castIndex: Math.max(0, ci - 1) }));
      return true;
    }
    if (key === 'right') {
      setDetailFocus(prev => ({ ...prev, castIndex: Math.min(castCount - 1, ci + 1) }));
      return true;
    }
    if (key === 'enter') {
      const pool = detailCast.length > 0 ? detailCast : parseCastFromVodItem(activeDetailItem);
      const p = pool[ci] || pool[0];
      if (p && setSelectedPerson) {
        setSelectedPerson(p);
      }
      return true;
    }
    return true;
  }

  if (area === 'related') {
    if (key === 'up') {
      if (castCount > 0) {
        setDetailFocus(prev => ({ ...prev, area: 'cast', castIndex: 0 }));
      } else if (isSeries && episodesCount > 0) {
        setDetailFocus(prev => ({ ...prev, area: 'episodes' }));
      } else {
        toActions();
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
