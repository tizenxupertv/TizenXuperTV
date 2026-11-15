import React, { useState, useEffect, useRef, useMemo } from 'react';
import { VodItem } from '../types/vod';
import { HistoryItem } from '../types/history';
import { favoritesService } from '../services/favoritesService';
import { historyService } from '../services/historyService';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { ScreenHeader, SearchIcon, BackIcon } from '../components/layout/Header';
import { collectPosterAlternates } from '../lib/searchArtwork';
import { isImagePrecached, markImageLoaded, markImageFailed } from '../lib/imageCache';
import { useCardImage } from '../lib/useCardImage';
import { formatQualityTag, firstQuality } from '../lib/subtitles';
import { useTitleMeta } from '../lib/titleMetaCache';
import { isAdultItem } from '../lib/catalogOrganizer';

interface MyStuffScreenProps {
  isTop: boolean;
  hidden?: boolean;
  isSearchOpen?: boolean;
  initialTab?: 'favs' | 'history';
  catalogItems: VodItem[];
  onClose: () => void;
  onOpenVod: (item: VodItem) => void;
  onOpenHistory: (item: HistoryItem) => void;
  onOpenSearch?: () => void;
}

interface StuffEntry {
  key: string;
  title: string;
  displayTitle: string;
  subtitle: string;
  candidates: string[];
  quality?: string;
  qualities?: string[];
  category?: string;
  progressPct?: number;
  isHistory?: boolean;
  open: () => void;
  remove: () => void;
}

const COLS = 6;
const MAX_ITEMS = 60;
const MAX_RECOMMENDED = 12;
const NOTICE_MS = 3000;

function computeRemainingMinutes(h: HistoryItem): number {
  if (h.duration > h.position && h.duration > 0) {
    return Math.max(1, Math.round((h.duration - h.position) / 60));
  }
  return 0;
}

function computeProgressPct(h: HistoryItem): number {
  if (h.duration > 0) {
    return Math.min(100, Math.max(5, Math.round((h.position / h.duration) * 100)));
  }
  return 45;
}

const StuffLandscapeCard: React.FC<{
  entry: StuffEntry;
  isFocused: boolean;
  editMode: boolean;
  onActivate: () => void;
  onRemoveClick: () => void;
}> = ({ entry, isFocused, editMode, onActivate, onRemoveClick }) => {
  const [altIndex, setAltIndex] = useState(0);
  const [allFailed, setAllFailed] = useState(false);

  const candidatesKey = entry.candidates.join('|');
  useEffect(() => {
    setAltIndex(0);
    setAllFailed(false);
  }, [entry.key, candidatesKey]);

  const rawUrl = !allFailed && entry.candidates.length > 0
    ? entry.candidates[Math.min(altIndex, entry.candidates.length - 1)]
    : '';
  const cardSrc = useCardImage(rawUrl, 392, 221, !!rawUrl);
  const [imgLoaded, setImgLoaded] = useState(() => !!cardSrc && isImagePrecached(cardSrc));

  useEffect(() => {
    setImgLoaded(!!cardSrc && isImagePrecached(cardSrc));
  }, [cardSrc]);

  const cachedMeta = useTitleMeta(entry.key);
  const qualityTag = useMemo(
    () => formatQualityTag(firstQuality(entry.qualities, entry.quality, cachedMeta?.qualities, cachedMeta?.quality), entry.category),
    [entry.qualities, entry.quality, cachedMeta?.qualities, cachedMeta?.quality, entry.category]
  );

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget && e.currentTarget.naturalWidth === 0) {
      onImgError();
      return;
    }
    if (cardSrc) markImageLoaded(cardSrc);
    setImgLoaded(true);
  };

  const onImgError = () => {
    if (cardSrc) markImageFailed(cardSrc);
    if (altIndex + 1 < entry.candidates.length) {
      setImgLoaded(false);
      setAltIndex(prev => prev + 1);
      return;
    }
    setImgLoaded(false);
    setAllFailed(true);
  };

  return (
    <div
      className={`ms-card ${isFocused ? 'is-focused' : ''} ${editMode ? 'is-removing' : ''}`}
      onClick={onActivate}
    >
      <div className="ms-card-thumb">
        <img
          className="poster-card-placeholder-img"
          src="assets/placeholder_landscape.png"
          alt=""
          loading="eager"
        />
        {cardSrc && !allFailed && (
          <img
            className={`poster-card-img-element ${imgLoaded ? 'is-loaded' : ''}`}
            src={cardSrc}
            loading="lazy"
            decoding="async"
            onLoad={onImgLoad}
            onError={onImgError}
            alt=""
          />
        )}
        {qualityTag && (
          <div className={`poster-quality-badge ${qualityTag === '4K' ? 'is-4k' : ''}`}>
            {qualityTag}
          </div>
        )}
        <button
          type="button"
          className="ms-card-dots"
          title="Quitar título"
          aria-label={`Quitar ${entry.title}`}
          onClick={e => {
            e.stopPropagation();
            onRemoveClick();
          }}
        >
          {editMode ? '✕' : '⋮'}
        </button>
        {entry.isHistory && (
          <>
            <div className="ms-card-play" aria-hidden="true">▶</div>
            <div className="cw-progress-track ms-card-progress">
              <div className="cw-progress-fill" style={{ width: `${entry.progressPct || 45}%` }} />
            </div>
          </>
        )}
      </div>
      <div className="ms-card-caption">
        <div className="ms-card-title">{entry.displayTitle}</div>
        {entry.subtitle && <div className="ms-card-sub">{entry.subtitle}</div>}
      </div>
    </div>
  );
};

const RecommendedPosterCard: React.FC<{
  item: VodItem;
  isFocused: boolean;
  onActivate: () => void;
}> = ({ item, isFocused, onActivate }) => {
  const candidates = useMemo(
    () => collectPosterAlternates(item.poster, item.posterAlternates, item.landscape, item.backdrop),
    [item.poster, item.posterAlternates, item.landscape, item.backdrop]
  );
  const [altIndex, setAltIndex] = useState(0);
  const [allFailed, setAllFailed] = useState(false);

  const rawUrl = !allFailed && candidates.length > 0
    ? candidates[Math.min(altIndex, candidates.length - 1)]
    : '';
  const cardSrc = useCardImage(rawUrl, 230, 340, !!rawUrl);
  const [imgLoaded, setImgLoaded] = useState(() => !!cardSrc && isImagePrecached(cardSrc));

  useEffect(() => {
    setImgLoaded(!!cardSrc && isImagePrecached(cardSrc));
  }, [cardSrc]);

  const qualityTag = useMemo(
    () => formatQualityTag(firstQuality(item.qualities, item.quality), item.category),
    [item.qualities, item.quality, item.category]
  );

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget && e.currentTarget.naturalWidth === 0) {
      handleError();
      return;
    }
    if (cardSrc) markImageLoaded(cardSrc);
    setImgLoaded(true);
  };

  const handleError = () => {
    if (cardSrc) markImageFailed(cardSrc);
    if (altIndex + 1 < candidates.length) {
      setImgLoaded(false);
      setAltIndex(prev => prev + 1);
      return;
    }
    setImgLoaded(false);
    setAllFailed(true);
  };

  const year = item.year && item.year !== '—' ? item.year : '';

  return (
    <div className={`poster-card apple-poster-card ms-rec-card ${isFocused ? 'is-focused' : ''}`} onClick={onActivate}>
      <div className="poster-card-img">
        <img className="poster-card-placeholder-img" src="assets/placeholder_vertical.png" alt="" loading="eager" />
        {cardSrc && !allFailed && (
          <img
            className={`poster-card-img-element ${imgLoaded ? 'is-loaded' : ''}`}
            src={cardSrc}
            loading="lazy"
            decoding="async"
            onLoad={handleLoad}
            onError={handleError}
            alt=""
          />
        )}
        {qualityTag && (
          <div className={`poster-quality-badge ${qualityTag === '4K' ? 'is-4k' : ''}`}>
            {qualityTag}
          </div>
        )}
        <div className="poster-bottom-vignette">
          <div className="poster-vignette-title">{item.title}</div>
          <div className="poster-vignette-genre">{year || (item.isSeries ? 'Serie' : 'Película')}</div>
        </div>
      </div>
    </div>
  );
};

export const MyStuffScreen: React.FC<MyStuffScreenProps> = ({
  isTop,
  hidden = false,
  isSearchOpen = false,
  initialTab = 'favs',
  catalogItems,
  onClose,
  onOpenVod,
  onOpenHistory,
  onOpenSearch
}) => {
  const [tab, setTab] = useState<'favs' | 'history'>(initialTab);
  const [area, setArea] = useState<'header' | 'tabs' | 'grid' | 'recommended'>('tabs');
  const [headerIdx, setHeaderIdx] = useState(0);
  const [tabBtnIdx, setTabBtnIdx] = useState(initialTab === 'history' ? 1 : 0);
  const [gridIdx, setGridIdx] = useState(0);
  const [recIdx, setRecIdx] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearChoice, setClearChoice] = useState<0 | 1>(0);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [, setTick] = useState(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const recRowRef = useRef<HTMLDivElement>(null);
  const askedInfoRef = useRef<Set<string>>(new Set());

  const rerender = () => setTick(t => t + 1);

  useEffect(() => {
    const unsubs = [
      favoritesService.subscribe(rerender),
      historyService.subscribe(rerender)
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    setEditMode(false);
  }, [tab]);

  const catalogById = useMemo(() => {
    const map = new Map<string, VodItem>();
    catalogItems.forEach(it => {
      if (it && it.id !== undefined) map.set(String(it.id), it);
    });
    return map;
  }, [catalogItems]);

  const removeFromList = (fromHistory: boolean, id: string, title: string) => {
    const ok = fromHistory ? historyService.removeEntry(id) : favoritesService.removeFavorite(id);
    setNotice(ok
      ? { text: `«${title}» quitado ${fromHistory ? 'de Continuar viendo' : 'de Mi lista'}` }
      : { text: 'No se pudo quitar. Inténtalo de nuevo.', error: true });
  };

  const clearHistory = () => {
    const ok = historyService.clearHistory();
    setConfirmClear(false);
    setEditMode(false);
    setArea('tabs');
    setTabBtnIdx(1);
    setNotice(ok
      ? { text: 'Historial borrado' }
      : { text: 'No se pudo borrar el historial. Inténtalo de nuevo.', error: true });
  };

  const historyList = historyService.getHistory();
  const favIds = favoritesService.getFavoriteIds();

  // Enrich legacy favorites stored without title/poster metadata
  useEffect(() => {
    if (tab !== 'favs') return;
    const client = (window as any).MagisClient;
    if (!client || typeof client.detail !== 'function') return;
    favIds.slice(0, MAX_ITEMS).forEach(id => {
      if (askedInfoRef.current.has(id) || favoritesService.getFavoriteInfo(id)) return;
      if (catalogById.has(id)) return;
      askedInfoRef.current.add(id);
      client.detail(id, (err: any, data: any) => {
        const it = !err && data && data.item;
        if (it && (it.title || it.name)) {
          favoritesService.setFavoriteInfo(id, { ...it, title: it.title || it.name });
        }
      });
    });
  }, [tab, favIds.join(','), catalogById]);

  const items = useMemo<StuffEntry[]>(() => {
    if (tab === 'history') {
      return historyList.slice(0, MAX_ITEMS).map(h => {
        const vod = catalogById.get(String(h.id));
        const remainingMin = computeRemainingMinutes(h);
        const year = vod?.year && vod.year !== '—' ? vod.year : '';
        const displayTitle = h.series && h.episodeNumber
          ? `T1 E${h.episodeNumber} · ${h.title}`
          : h.title;
        const subtitleParts = [
          year,
          remainingMin > 0 ? `${remainingMin} min restantes` : (h.series ? 'Serie' : 'En progreso')
        ].filter(Boolean);
        return {
          key: String(h.id),
          title: h.title,
          displayTitle,
          subtitle: subtitleParts.join(' · '),
          candidates: collectPosterAlternates(vod?.landscape, vod?.backdrop, h.poster, vod?.poster),
          quality: vod?.quality,
          qualities: vod?.qualities,
          category: vod?.category,
          progressPct: computeProgressPct(h),
          isHistory: true,
          open: () => onOpenHistory(h),
          remove: () => removeFromList(true, String(h.id), h.title)
        };
      });
    }

    return favIds.slice(0, MAX_ITEMS).map(id => {
      const vod = catalogById.get(id);
      const info = favoritesService.getFavoriteInfo(id);
      const title = vod ? vod.title : info ? info.title : 'Cargando…';
      const isSeries = vod ? !!vod.isSeries : !!(info && info.series);
      const year = vod?.year && vod.year !== '—' ? vod.year : '';
      const target: VodItem | null = vod || (info
        ? ({ id, title: info.title, poster: info.poster, isSeries: info.series, kind: info.series ? 'serie' : 'película' } as VodItem)
        : null);
      return {
        key: id,
        title,
        displayTitle: title,
        subtitle: [year, isSeries ? 'Serie' : 'Película'].filter(Boolean).join(' · '),
        candidates: collectPosterAlternates(vod?.landscape, vod?.backdrop, info?.poster, vod?.poster, vod?.posterAlternates),
        quality: vod?.quality,
        qualities: vod?.qualities,
        category: vod?.category,
        open: () => { if (target) onOpenVod(target); },
        remove: () => removeFromList(false, id, title)
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, catalogById, historyList.length, favIds.map(id => (favoritesService.getFavoriteInfo(id) ? id + '+' : id)).join(',')]);

  const recommendedItems = useMemo<VodItem[]>(() => {
    if (tab !== 'history') return [];
    const seen = new Set<string>(historyList.map(h => String(h.id)));
    const out: VodItem[] = [];
    for (const it of catalogItems) {
      if (!it || it.id === undefined) continue;
      const key = String(it.id);
      if (seen.has(key) || historyService.isRestricted(it) || isAdultItem(it) || it.collectionId) continue;
      if (!(it.poster || it.landscape)) continue;
      seen.add(key);
      out.push(it);
      if (out.length >= MAX_RECOMMENDED) break;
    }
    return out;
  }, [tab, catalogItems, historyList]);

  useEffect(() => {
    if (editMode && items.length === 0) setEditMode(false);
  }, [editMode, items.length]);

  const tabButtons = useMemo(() => {
    const btns: Array<{ id: string; label: string; kind: 'tab' | 'btn' | 'danger'; selected?: boolean; onActivate: () => void }> = [
      {
        id: 'tab-favs',
        label: 'Mi lista',
        kind: 'tab',
        selected: tab === 'favs',
        onActivate: () => { setTab('favs'); setGridIdx(0); }
      },
      {
        id: 'tab-history',
        label: 'Continuar viendo',
        kind: 'tab',
        selected: tab === 'history',
        onActivate: () => { setTab('history'); setGridIdx(0); }
      }
    ];
    if (items.length > 0) {
      btns.push({
        id: 'edit-list',
        label: editMode ? 'Listo' : 'Quitar títulos',
        kind: 'btn',
        selected: editMode,
        onActivate: () => setEditMode(e => !e)
      });
    }
    if (tab === 'history' && historyList.length > 0) {
      btns.push({
        id: 'clear-history',
        label: 'Borrar historial',
        kind: 'danger',
        onActivate: () => { setClearChoice(0); setConfirmClear(true); }
      });
    }
    return btns;
  }, [tab, items.length, editMode, historyList.length]);

  useEffect(() => {
    if (tabBtnIdx >= tabButtons.length) setTabBtnIdx(Math.max(0, tabButtons.length - 1));
  }, [tabButtons.length, tabBtnIdx]);

  useEffect(() => {
    if (items.length === 0 && area === 'grid') {
      setArea('tabs');
    } else if (gridIdx >= items.length && items.length > 0) {
      setGridIdx(items.length - 1);
    }
  }, [items.length, area, gridIdx]);

  useEffect(() => {
    if (recIdx >= recommendedItems.length && recommendedItems.length > 0) {
      setRecIdx(recommendedItems.length - 1);
    }
  }, [recommendedItems.length, recIdx]);

  // Keep focused element visible inside body & horizontal recommended row
  useEffect(() => {
    if (!bodyRef.current) return;
    const focused = bodyRef.current.querySelector('.is-focused') as HTMLElement | null;
    if (focused && focused.scrollIntoView) {
      try {
        focused.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch {
        focused.scrollIntoView(false);
      }
    }
  }, [area, tabBtnIdx, gridIdx, recIdx, tab]);

  const headerActions = useMemo(() => ([
    ...(onOpenSearch ? [{ id: 'search', title: 'Buscar', icon: SearchIcon, onClick: onOpenSearch }] : []),
    { id: 'back', title: 'Volver', icon: BackIcon, onClick: onClose }
  ]), [onOpenSearch, onClose]);

  useScreenKeys(key => {
    if (confirmClear) {
      if (key === 'left' || key === 'right') setClearChoice(c => (c === 0 ? 1 : 0));
      else if (key === 'back') setConfirmClear(false);
      else if (key === 'enter') {
        if (clearChoice === 1) clearHistory();
        else setConfirmClear(false);
      }
      return;
    }

    if (key === 'back') {
      if (editMode) {
        setEditMode(false);
        return;
      }
      onClose();
      return;
    }

    if (area === 'header') {
      if (key === 'left') setHeaderIdx(i => Math.max(0, i - 1));
      else if (key === 'right') setHeaderIdx(i => Math.min(headerActions.length - 1, i + 1));
      else if (key === 'down') setArea('tabs');
      else if (key === 'enter') {
        const act = headerActions[headerIdx];
        if (act && act.onClick) act.onClick();
      }
      return;
    }

    if (area === 'tabs') {
      if (key === 'left') setTabBtnIdx(i => Math.max(0, i - 1));
      else if (key === 'right') setTabBtnIdx(i => Math.min(tabButtons.length - 1, i + 1));
      else if (key === 'up') {
        setArea('header');
        setHeaderIdx(headerActions.length - 1);
      } else if (key === 'down') {
        if (items.length > 0) {
          setArea('grid');
          setGridIdx(prev => Math.min(prev, items.length - 1));
        } else if (recommendedItems.length > 0) {
          setArea('recommended');
          setRecIdx(0);
        }
      } else if (key === 'enter') {
        const btn = tabButtons[tabBtnIdx];
        if (btn) btn.onActivate();
      }
      return;
    }

    if (area === 'grid') {
      if (key === 'left') {
        if (gridIdx % COLS > 0) setGridIdx(gridIdx - 1);
      } else if (key === 'right') {
        if ((gridIdx % COLS) < COLS - 1 && gridIdx + 1 < items.length) setGridIdx(gridIdx + 1);
      } else if (key === 'up') {
        if (gridIdx >= COLS) setGridIdx(gridIdx - COLS);
        else setArea('tabs');
      } else if (key === 'down') {
        if (gridIdx + COLS < items.length) {
          setGridIdx(gridIdx + COLS);
        } else {
          const curRow = Math.floor(gridIdx / COLS);
          const lastRow = Math.floor((items.length - 1) / COLS);
          if (curRow < lastRow) {
            setGridIdx(items.length - 1);
          } else if (recommendedItems.length > 0) {
            setArea('recommended');
            setRecIdx(Math.min(gridIdx % COLS, recommendedItems.length - 1));
          }
        }
      } else if (key === 'enter') {
        const entry = items[gridIdx];
        if (entry) {
          if (editMode) entry.remove();
          else entry.open();
        }
      }
      return;
    }

    if (area === 'recommended') {
      if (key === 'left') setRecIdx(i => Math.max(0, i - 1));
      else if (key === 'right') setRecIdx(i => Math.min(recommendedItems.length - 1, i + 1));
      else if (key === 'up') {
        if (items.length > 0) {
          const lastRowStart = Math.floor((items.length - 1) / COLS) * COLS;
          setArea('grid');
          setGridIdx(Math.min(items.length - 1, lastRowStart + Math.min(recIdx, COLS - 1)));
        } else {
          setArea('tabs');
        }
      } else if (key === 'enter') {
        const rec = recommendedItems[recIdx];
        if (rec) onOpenVod(rec);
      }
    }
  }, isTop && !hidden && !isSearchOpen);

  return (
    <div className="ms-screen" style={hidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
      <ScreenHeader
        title="Mis cosas"
        actions={headerActions}
        focusedAction={area === 'header' ? headerIdx : null}
      />
      <div className="ms-body" ref={bodyRef}>
        <h1 className="ms-heading">Mis cosas</h1>

        <div className="ms-tabs-bar">
          {tabButtons.map((btn, i) => {
            const focused = area === 'tabs' && tabBtnIdx === i;
            if (btn.kind === 'tab') {
              return (
                <button
                  key={btn.id}
                  type="button"
                  className={`ms-tab ${btn.selected ? 'is-selected' : ''} ${focused ? 'is-focused' : ''}`}
                  onClick={() => {
                    setArea('tabs');
                    setTabBtnIdx(i);
                    btn.onActivate();
                  }}
                >
                  {btn.label}
                </button>
              );
            }
            return (
              <button
                key={btn.id}
                type="button"
                className={`pf-btn pf-list-action ${btn.kind === 'danger' ? 'pf-btn-danger' : ''} ${btn.selected ? 'is-on' : ''} ${focused ? 'is-focused' : ''}`}
                onClick={() => {
                  setArea('tabs');
                  setTabBtnIdx(i);
                  btn.onActivate();
                }}
              >
                {btn.label}
              </button>
            );
          })}
          <div className="pf-total">
            {items.length} {items.length === 1 ? 'título' : 'títulos'}
          </div>
        </div>

        {editMode && items.length > 0 && (
          <div className="pf-edit-hint">Elige un título y pulsa OK para quitarlo. Pulsa Atrás o «Listo» para terminar.</div>
        )}

        {items.length === 0 ? (
          <div className="pf-empty">
            {tab === 'favs'
              ? 'Tu lista está vacía todavía. Agrega películas o series con el botón +.'
              : 'Todavía no tienes títulos en Continuar viendo.'}
          </div>
        ) : (
          <div className="ms-grid">
            {items.map((it, idx) => (
              <StuffLandscapeCard
                key={it.key}
                entry={it}
                editMode={editMode}
                isFocused={area === 'grid' && gridIdx === idx}
                onActivate={() => {
                  setArea('grid');
                  setGridIdx(idx);
                  if (editMode) it.remove();
                  else it.open();
                }}
                onRemoveClick={it.remove}
              />
            ))}
          </div>
        )}

        {tab === 'history' && recommendedItems.length > 0 && (
          <section className="ms-rec-section">
            <h2 className="ms-rec-title">Recomendado para ti</h2>
            <div className="ms-rec-row" ref={recRowRef}>
              {recommendedItems.map((it, idx) => (
                <RecommendedPosterCard
                  key={it.id}
                  item={it}
                  isFocused={area === 'recommended' && recIdx === idx}
                  onActivate={() => {
                    setArea('recommended');
                    setRecIdx(idx);
                    onOpenVod(it);
                  }}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {confirmClear && (
        <div className="pf-confirm" role="dialog" aria-modal="true">
          <div className="pf-confirm-card">
            <h2 className="pf-confirm-title">¿Borrar el historial?</h2>
            <p className="pf-confirm-text">
              Se borran los títulos vistos y el progreso de películas y episodios en este TV. Tus favoritos y ajustes no cambian.
            </p>
            <div className="pf-btn-row">
              <div className={`pf-btn ${clearChoice === 0 ? 'is-focused' : ''}`} onClick={() => setConfirmClear(false)}>Cancelar</div>
              <div className={`pf-btn pf-btn-danger ${clearChoice === 1 ? 'is-focused' : ''}`} onClick={clearHistory}>Sí, borrar</div>
            </div>
          </div>
        </div>
      )}

      {notice && <div className={`pf-toast ${notice.error ? 'is-error' : ''}`}>{notice.text}</div>}
    </div>
  );
};
