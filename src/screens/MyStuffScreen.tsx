import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { VodItem } from '../types/vod';
import { HistoryItem } from '../types/history';
import { favoritesService } from '../services/favoritesService';
import { historyService } from '../services/historyService';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { ScreenHeader, SearchIcon, BackIcon } from '../components/layout/Header';
import { PosterCard } from '../components/vod/PosterCard';
import { ContinueWatchingCard } from '../components/vod/ContinueWatchingCard';
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

/** One title of either list: what the grid needs to draw it with the shared cards, open it and remove it */
interface StuffEntry {
  key: string;
  title: string;
  /** Mi lista: drawn with PosterCard */
  vod?: VodItem;
  /** Continuar viendo: drawn with ContinueWatchingCard */
  history?: HistoryItem;
  open: () => void;
  remove: () => void;
}

// Cards keep their home size (176 px posters, 326 px landscape); this is how many fit in the 1824 px body
const COLS_POSTERS = 9;
const COLS_LANDSCAPE = 5;
const MAX_ITEMS = 60;
const MAX_FEATURED = 12;
const NOTICE_MS = 3000;

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
      return historyList.slice(0, MAX_ITEMS).map(h => ({
        key: String(h.id),
        title: h.title,
        history: h,
        open: () => onOpenHistory(h),
        remove: () => removeFromList(true, String(h.id), h.title)
      }));
    }

    return favIds.slice(0, MAX_ITEMS).map(id => {
      const info = favoritesService.getFavoriteInfo(id);
      // A favorite saved before the catalog knew it: drawn from what was stored with it
      const vod: VodItem = catalogById.get(id) || ({
        id,
        title: info ? info.title : 'Cargando…',
        poster: info ? info.poster : '',
        isSeries: !!(info && info.series),
        kind: info && info.series ? 'serie' : 'película'
      } as VodItem);
      return {
        key: id,
        title: vod.title,
        vod,
        open: () => { if (catalogById.has(id) || info) onOpenVod(vod); },
        remove: () => removeFromList(false, id, vod.title)
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, catalogById, historyList, favIds.map(id => (favoritesService.getFavoriteInfo(id) ? id + '+' : id)).join(',')]);

  const COLS = tab === 'history' ? COLS_LANDSCAPE : COLS_POSTERS;

  const featuredItems = useMemo<VodItem[]>(() => {
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
      if (out.length >= MAX_FEATURED) break;
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
    if (recIdx >= featuredItems.length && featuredItems.length > 0) {
      setRecIdx(featuredItems.length - 1);
    }
  }, [featuredItems.length, recIdx]);

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

  const firstActionIdx = tabButtons.findIndex(b => b.kind !== 'tab');

  const openFeatured = useCallback((it: VodItem) => {
    setArea('recommended');
    onOpenVod(it);
  }, [onOpenVod]);

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
        } else if (featuredItems.length > 0) {
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
          } else if (featuredItems.length > 0) {
            setArea('recommended');
            setRecIdx(Math.min(gridIdx % COLS, featuredItems.length - 1));
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
      else if (key === 'right') setRecIdx(i => Math.min(featuredItems.length - 1, i + 1));
      else if (key === 'up') {
        if (items.length > 0) {
          const lastRowStart = Math.floor((items.length - 1) / COLS) * COLS;
          setArea('grid');
          setGridIdx(Math.min(items.length - 1, lastRowStart + Math.min(recIdx, COLS - 1)));
        } else {
          setArea('tabs');
        }
      } else if (key === 'enter') {
        const rec = featuredItems[recIdx];
        if (rec) onOpenVod(rec);
      }
    }
  }, isTop && !hidden && !isSearchOpen);

  return (
    <div className="ms-screen" style={hidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
      <ScreenHeader
        title="Mis cosas"
        subtitle={`${items.length} ${items.length === 1 ? 'título' : 'títulos'}`}
        actions={headerActions}
        focusedAction={area === 'header' ? headerIdx : null}
      />
      <div className="ms-body" ref={bodyRef}>
        <div className="filter-types ms-bar">
          {tabButtons.map((btn, i) => {
            const focused = area === 'tabs' && tabBtnIdx === i;
            // Lists and actions share the app's pill: selected = dimmed white, focused = solid white
            const className = `filter-type ${btn.selected ? 'is-selected' : ''} ${focused ? 'is-focused' : ''}`;
            return (
              <React.Fragment key={btn.id}>
                {i === firstActionIdx && <div className="ms-bar-gap" />}
                <button
                  type="button"
                  className={className}
                  onClick={() => {
                    setArea('tabs');
                    setTabBtnIdx(i);
                    btn.onActivate();
                  }}
                >
                  {btn.label}
                </button>
              </React.Fragment>
            );
          })}
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
            {items.map((it, idx) => {
              const isFocused = area === 'grid' && gridIdx === idx;
              const activate = () => {
                setArea('grid');
                setGridIdx(idx);
                if (editMode) it.remove();
                else it.open();
              };
              return (
                <div key={it.key} className={`ms-cell ${editMode ? 'is-removing' : ''}`}>
                  {it.history
                    ? <ContinueWatchingCard item={it.history} isFocused={isFocused} onActivate={activate} />
                    : <PosterCard item={it.vod as VodItem} isFocused={isFocused} onActivate={activate} />}
                </div>
              );
            })}
          </div>
        )}

        {featuredItems.length > 0 && (
          <section className="ms-section">
            <h2 className="section-title">Títulos destacados</h2>
            <div className="ms-row">
              {featuredItems.map((it, idx) => (
                <PosterCard
                  key={it.id}
                  item={it}
                  isFocused={area === 'recommended' && recIdx === idx}
                  onActivate={openFeatured}
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
