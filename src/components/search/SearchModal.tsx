import React, { useState, useEffect, useRef, useMemo } from 'react';
import { posterInWindow } from '../../lib/posterWindow';
import { ensurePortalSnapshot } from '../../lib/portalSnapshot';
import { getTvProfile } from '../../lib/tvProfile';
import { TabId } from '../layout/TopNavbar';
import { LiveChannel } from '../../types/channel';
import { VodItem } from '../../types/vod';
import { catalogService, getPopularSearchPage } from '../../services/catalogService';
import { OnScreenKeyboard, KbState, KB_INITIAL, pressKey, moveCursor, keyAt } from '../live/OnScreenKeyboard';
import { normalizeText } from '../../utils/normalizeText';
import { normalizeChannels } from '../../lib/channelKey';
import { allChannelEntries } from '../../lib/channelCache';
import { enrichSearchItems, collectPosterAlternates } from '../../lib/searchArtwork';
import { markImageFailed } from '../../lib/imageCache';
import { ScreenHeader, CloseIcon } from '../layout/Header';

export interface SearchModalProps {
  isOpen: boolean;
  hidden?: boolean;
  currentTab: TabId;
  onClose: () => void;
  onSelectChannel: (channel: LiveChannel) => void;
  onSelectVodItem: (item: VodItem) => void;
  channels: LiveChannel[];
}

// Cached catalog items across search modal mounts for instant opening
let cachedAllVodItems: VodItem[] | null = null;
const searchResultCache = new Map<string, { items: VodItem[]; total: number; at: number }>();

const RECENT_SEARCHES_KEY = 'xuper_recent_searches_v1';
const MAX_RECENT = 10;

function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, MAX_RECENT);
    }
  } catch (_) {}
  return [];
}

function saveRecentSearches(list: string[]): void {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch (_) {}
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  hidden = false,
  currentTab,
  onClose,
  onSelectChannel,
  onSelectVodItem,
  channels
}) => {
  const [query, setQuery] = useState<string>('');
  const [submittedQuery, setSubmittedQuery] = useState<string>('');
  const [focusedResultIndex, setFocusedResultIndex] = useState<number>(0);
  const [focusArea, setFocusArea] = useState<'keyboard' | 'results' | 'refresh' | 'recent'>('keyboard');
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecentSearches);
  const [recentIndex, setRecentIndex] = useState<number>(0);
  const recentIndexRef = useRef(0);
  recentIndexRef.current = recentIndex;
  const recentSearchesRef = useRef(recentSearches);
  recentSearchesRef.current = recentSearches;
  const recentListRef = useRef<HTMLDivElement>(null);
  const [kb, setKb] = useState<KbState>(KB_INITIAL);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  const isTvSearch = currentTab === 'tv';

  const submitSearch = (customQ?: string) => {
    const targetQ = (customQ !== undefined ? customQ : query).trim();
    setSubmittedQuery(targetQ);
    setFocusedResultIndex(0);
    setFocusArea('results');

    if (targetQ.length >= 2) {
      setRecentSearches(prev => {
        const next = [targetQ, ...prev.filter(s => s.toLowerCase() !== targetQ.toLowerCase())].slice(0, MAX_RECENT);
        saveRecentSearches(next);
        return next;
      });
    }
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    saveRecentSearches([]);
    setFocusArea('keyboard');
  };

  const removeRecentSearch = (term: string) => {
    setRecentSearches(prev => {
      const next = prev.filter(s => s.toLowerCase() !== term.toLowerCase());
      saveRecentSearches(next);
      return next;
    });
    setRecentIndex(0);
  };

  // Responsive columns: 6 columns on 1080p/desktop (>=1300px), 5 on smaller screens (<1300px), 2 for live TV
  const [vodCols, setVodCols] = useState<number>(() => {
    return typeof window !== 'undefined' && window.innerWidth < 1300 ? 5 : 6;
  });

  useEffect(() => {
    const onResize = () => {
      setVodCols(window.innerWidth < 1300 ? 5 : 6);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // All VOD items from catalog (cached across mounts for instant opening)
  const [allVodItems, setAllVodItems] = useState<VodItem[]>(cachedAllVodItems || []);
  useEffect(() => {
    if (cachedAllVodItems && cachedAllVodItems.length > 0) return;
    catalogService.fetchCatalog().then(cat => {
      const all: VodItem[] = [
        ...(cat.featured || []),
        ...(cat.movies || []),
        ...(cat.series || []),
        ...(cat.kids || []),
        ...(cat.anime || [])
      ];
      // deduplicate by id
      const seen = new Set<string>();
      const unique = all.filter(item => {
        if (!item || !item.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      cachedAllVodItems = unique;
      setAllVodItems(unique);
    });
  }, []);

  // Comprehensive list of ALL channels across all categories
  const allKnownChannels = useMemo(() => {
    // Reading every cached category is expensive: only do it while TV search is open
    if (!isOpen || !isTvSearch) return [] as LiveChannel[];
    const list: LiveChannel[] = [...channels];
    const seen = new Set<string>(channels.map(c => String(c.id || c.code)));

    // 1. Read from all saved category lists (in memory)
    for (const entry of allChannelEntries()) {
      if (!entry || !Array.isArray(entry.channels)) continue;
      for (const ch of normalizeChannels<LiveChannel>(entry.channels)) {
        const key = String(ch.id || ch.code);
        if (!seen.has(key)) {
          seen.add(key);
          list.push(ch);
        }
      }
    }


    return list;
  }, [channels, isOpen]);

  // Filtered Live Channels (only recomputed on confirm, never per keystroke)
  const filteredChannels = useMemo(() => {
    if (!isTvSearch) return [];
    const q = normalizeText(submittedQuery.trim());
    if (!q) return allKnownChannels.slice(0, 30);
    return allKnownChannels.filter(ch => {
      const name = normalizeText(ch.name);
      const code = normalizeText(ch.code);
      const now = normalizeText(ch.now);
      return name.includes(q) || code.includes(q) || now.includes(q);
    });
  }, [isTvSearch, submittedQuery, allKnownChannels]);

  // Normalised text of every home title, built once (not on every key press)
  const localHaystacks = useMemo(() => allVodItems.map(item => ({
    item,
    title: normalizeText(item.title),
    rest: normalizeText(`${Array.isArray(item.genres) ? item.genres.join(' ') : ''} ${item.actors || ''}`)
  })), [allVodItems]);

  // Search the whole portal catalog (only triggered on confirm, never per keystroke)
  const [remoteVod, setRemoteVod] = useState<VodItem[]>([]);
  const [remoteState, setRemoteState] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle');
  const [remoteTotal, setRemoteTotal] = useState(0);
  const searchTokenRef = useRef<number>(0);
  useEffect(() => {
    if (isTvSearch || !isOpen) return;
    const q = submittedQuery.trim();
    if (q.length < 2) {
      setRemoteVod([]);
      setRemoteState('idle');
      setRemoteTotal(0);
      return;
    }

    const normQ = q.toLowerCase();
    const cached = searchResultCache.get(normQ);
    if (cached && (Date.now() - cached.at < 10 * 60 * 1000)) {
      setRemoteVod(cached.items);
      setRemoteTotal(cached.total);
      setRemoteState('done');
      return;
    }

    const token = ++searchTokenRef.current;
    let alive = true;
    setRemoteState('loading');
    const timer = setTimeout(() => {
      const client = (window as any).MagisClient;
      if (!client || typeof client.search !== 'function') {
        if (alive && token === searchTokenRef.current) setRemoteState('failed');
        return;
      }
      client.search(q, (err: any, res: any) => {
        if (!alive || token !== searchTokenRef.current) return;
        if (err || !res) {
          setRemoteState('failed');
          return;
        }
        const mapped = (res.items || []).map((it: any) => ({
          ...it,
          isSeries: it.type === 'teleplay' || it.kind === 'serie',
          posterAlternates: collectPosterAlternates(it.poster, it.posterAlternates, it.landscape, it.backdrop)
        }));
        const enriched = enrichSearchItems(mapped, allVodItems, true);
        const total = res.total || mapped.length;
        searchResultCache.set(normQ, { items: enriched, total, at: Date.now() });
        setRemoteVod(enriched);
        setRemoteTotal(total);
        setRemoteState('done');
      }, { pageSize: 60 });
    }, 200);
    return () => {
      alive = false;
      searchTokenRef.current++;
      clearTimeout(timer);
    };
  }, [submittedQuery, isTvSearch, isOpen]);

  // "Búsqueda popular" (as the official app): 10 titles of the portal's hot-search column;
  // "Actualizar" shows the next 10, back to the first after the last
  const POPULAR_SIZE = 10;
  const [popular, setPopular] = useState<{ items: VodItem[]; total: number; page: number } | null>(null);
  const popularTokenRef = useRef(0);
  const [popularLoading, setPopularLoading] = useState(false);
  const loadPopular = (page: number) => {
    const token = ++popularTokenRef.current;
    setPopularLoading(true);
    getPopularSearchPage(page, POPULAR_SIZE).then(
      res => {
        if (token !== popularTokenRef.current) return;
        setPopularLoading(false);
        if (!res.items.length) return;
        setPopular({ items: res.items, total: res.total, page });
        setFocusedResultIndex(0);
      },
      () => { if (token === popularTokenRef.current) setPopularLoading(false); }
    );
  };
  const refreshPopular = () => {
    if (!popular) return loadPopular(1);
    const pages = Math.max(1, Math.ceil(popular.total / POPULAR_SIZE));
    loadPopular(popular.page >= pages ? 1 : popular.page + 1);
  };
  useEffect(() => {
    if (isOpen && !isTvSearch && !popular) loadPopular(1);
  }, [isOpen, isTvSearch]);
  const showingPopular = !isTvSearch && !submittedQuery.trim() && !!popular;

  // Results: home titles that match show at once, the portal's results follow without repeats
  const filteredVod = useMemo(() => {
    if (isTvSearch) return [];
    const q = normalizeText(submittedQuery.trim());
    if (!q) return popular ? popular.items : allVodItems.slice(0, 24);
    const local = localHaystacks.filter(h => h.title.includes(q) || h.rest.includes(q)).map(h => h.item);
    const seen = new Set(local.map(it => it.id));
    const remote = remoteVod.filter(it => !seen.has(it.id));
    // Tizen <= 4 / low-memory TVs (1 GB RAM) can exhaust memory decoding 120 full-size posters.
    // Cap to 24 for low-memory TVs, 48 for mid-tier, and 120 for modern TVs.
    const profile = getTvProfile();
    const maxItems = profile.lowMemory ? 24 : profile.tier === 'mid' ? 48 : 120;
    return enrichSearchItems(local.concat(remote).slice(0, maxItems), allVodItems, true);
  }, [isTvSearch, submittedQuery, allVodItems, localHaystacks, remoteVod, popular]);

  const totalResults = isTvSearch ? filteredChannels.length : filteredVod.length;

  const showSkeleton = !isTvSearch && ((!submittedQuery.trim() && !popular && popularLoading) || (!!submittedQuery.trim() && remoteState === 'loading' && totalResults === 0));

  // Auto-focus input only when search opens fresh (preserves query & results when returning from VOD detail view!)
  // Search results without artwork borrow posters from the catalog snapshot shipped with the app: load it when the
  // search opens (it is no longer read on every start)
  useEffect(() => {
    if (isOpen) ensurePortalSnapshot();
  }, [isOpen]);
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setQuery('');
      setSubmittedQuery('');
      setFocusedResultIndex(0);
      setFocusArea('keyboard');
      setKb(KB_INITIAL);
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]);

  const typeKey = (k: string) => {
    if (k === 'ok') {
      submitSearch();
      return;
    }
    if (k === 'clear') {
      setQuery('');
      setSubmittedQuery('');
      setFocusedResultIndex(0);
      return;
    }
    const res = pressKey(k, query, kb, 40);
    setKb(res.state);
    if (res.ok) {
      submitSearch(res.query);
    } else {
      setQuery(res.query);
      if (!res.query.trim()) {
        setSubmittedQuery('');
        setFocusedResultIndex(0);
      }
    }
  };

  // Handle keyboard / remote navigation inside the modal (on-screen keyboard + results)
  useEffect(() => {
    if (!isOpen || hidden) return;
    let lastRepeatTime = 0;
    const REPEAT_MIN_INTERVAL_MS = 65;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Throttle rapid repeated keydowns to prevent event queue saturation on Tizen
      if (e.repeat) {
        const now = performance.now();
        if (now - lastRepeatTime < REPEAT_MIN_INTERVAL_MS) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        lastRepeatTime = now;
      } else {
        lastRepeatTime = performance.now();
      }

      const isBack = e.key === 'Escape' || e.keyCode === 10009 || e.keyCode === 461;
      const isBackspace = e.key === 'Backspace' || e.keyCode === 8;
      const cols = isTvSearch ? 2 : vodCols;

      if (isBack) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (focusArea !== 'keyboard') setFocusArea('keyboard');
        else onClose();
        return;
      }

      // Recent searches vertical list navigation
      if (focusArea === 'recent') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        const currentIdx = recentIndexRef.current;
        const totalRecent = recentSearchesRef.current.length;

        if (e.key === 'ArrowDown') {
          if (currentIdx < totalRecent) {
            setRecentIndex(currentIdx + 1);
          }
        } else if (e.key === 'ArrowUp') {
          if (currentIdx === 0) {
            setFocusArea('keyboard');
            setKb(prev => ({ ...prev, r: 5 }));
          } else {
            setRecentIndex(currentIdx - 1);
          }
        } else if (e.key === 'ArrowRight') {
          if (totalResults > 0) {
            setFocusArea('results');
            setFocusedResultIndex(0);
          }
        } else if (e.key === 'ArrowLeft') {
          setFocusArea('keyboard');
          setKb(prev => ({ ...prev, r: 5 }));
        } else if (e.key === 'Enter') {
          if (currentIdx === totalRecent) {
            clearRecentSearches();
          } else {
            const selected = recentSearchesRef.current[currentIdx];
            if (selected) {
              setQuery(selected);
              submitSearch(selected);
            }
          }
        }
        return;
      }

      // "Actualizar" button above the popular titles
      if (focusArea === 'refresh') {
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        if (e.key === 'Enter') refreshPopular();
        else if (e.key === 'ArrowDown' && totalResults > 0) setFocusArea('results');
        else if (e.key === 'ArrowLeft') setFocusArea('keyboard');
        return;
      }

      if (focusArea === 'keyboard') {
        if (isBackspace) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (query) typeKey('del');
          else onClose();
          return;
        }
        if (/^[A-Za-z0-9\u00C0-\u024F ._\-'&@+]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          e.stopImmediatePropagation();
          typeKey(e.key === ' ' ? 'space' : e.key);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (kb.r >= 5 && recentSearches.length > 0) {
            // ↓ from the bottom row of keyboard moves into recent searches!
            setFocusArea('recent');
            setRecentIndex(0);
            return;
          }
          const next = moveCursor(kb, 'down');
          if (next) setKb(next);
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopImmediatePropagation();
          const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowLeft' ? 'left' : 'right';
          const next = moveCursor(kb, dir);
          if (next) {
            setKb(next);
          } else if (dir === 'right' && totalResults > 0) {
            // → from the last key of a row confirms the search and moves into results!
            submitSearch(query);
          }
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopImmediatePropagation();
          const currentKey = keyAt(kb);
          if (currentKey === 'ok') {
            submitSearch(query);
          } else {
            typeKey(currentKey);
          }
          return;
        }
        return;
      }

      // Results area
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setFocusedResultIndex(prev => Math.min(totalResults - 1, prev + cols));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (focusedResultIndex < cols) {
          if (showingPopular) {
            setFocusArea('refresh');
          } else {
            setFocusArea('keyboard');
          }
        } else {
          setFocusedResultIndex(prev => Math.max(0, prev - cols));
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopImmediatePropagation();
        // ← from the first column goes back to the left panel (keyboard or recent)
        if (focusedResultIndex % cols === 0) {
          if (recentSearches.length > 0 && focusedResultIndex >= cols) {
            setFocusArea('recent');
            setRecentIndex(0);
          } else {
            setFocusArea('keyboard');
          }
        } else {
          setFocusedResultIndex(prev => Math.max(0, prev - 1));
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setFocusedResultIndex(prev => Math.min(totalResults - 1, prev + 1));
      } else if (e.key === 'Enter' && totalResults > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (isTvSearch) {
          const ch = filteredChannels[focusedResultIndex];
          if (ch) {
            onSelectChannel(ch);
            onClose();
          }
        } else {
          const item = filteredVod[focusedResultIndex];
          if (item) {
            onSelectVodItem(item);
            // Search stays active underneath the detail view so Back returns here!
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, hidden, focusArea, focusedResultIndex, totalResults, isTvSearch, filteredChannels, filteredVod, query, kb, vodCols, onClose, onSelectChannel, onSelectVodItem, showingPopular, popular]);

  // Keep focused result in view
  useEffect(() => {
    if (focusArea === 'results' && resultsContainerRef.current) {
      const container = resultsContainerRef.current;
      const target = container.children[focusedResultIndex] as HTMLElement;
      if (target) {
        target.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [focusedResultIndex, focusArea]);

  // Keep focused recent search in view
  useEffect(() => {
    if (focusArea === 'recent' && recentListRef.current) {
      const container = recentListRef.current;
      const target = container.children[recentIndex] as HTMLElement;
      if (target) {
        target.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [recentIndex, focusArea]);

  if (!isOpen) return null;

  return (
    <div
      className="search-modal-backdrop search-view-full"
      style={hidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
      onClick={onClose}
    >
      <div className="search-modal-container" onClick={e => e.stopPropagation()}>
        {/* Same bar as the home: title where the tabs are, close on the right */}
        <ScreenHeader
          title={isTvSearch ? 'Buscar canales' : 'Buscar'}
          subtitle={submittedQuery ? `"${submittedQuery}"` : undefined}
          actions={[{ id: 'close', title: 'Cerrar búsqueda', icon: CloseIcon, onClick: onClose }]}
        />

        <div className="search-body">
          {/* Left panel: Search input (same width as keyboard) + on-screen keyboard */}
          <div className="search-left-panel">
            <div className={`search-input-wrapper ${focusArea === 'keyboard' ? 'is-focused' : ''}`}>
              <svg className="search-input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <div className={`search-input-text ${query ? '' : 'is-empty'}`}>
                {query ? (
                  <>
                    <span className="search-typed-text">{query}</span>
                    {focusArea === 'keyboard' && <span className="pc-search-caret" />}
                  </>
                ) : (
                  <>
                    {focusArea === 'keyboard' && <span className="pc-search-caret search-caret-start" />}
                    <span className="search-placeholder-text">Buscar...</span>
                  </>
                )}
              </div>
              {query && (
                <button
                  type="button"
                  className="search-input-submit-btn"
                  onClick={() => submitSearch(query)}
                  title="Buscar"
                >
                  Buscar
                </button>
              )}
            </div>

            <div className="search-keyboard-wrap">
              <OnScreenKeyboard
                state={kb}
                focused={focusArea === 'keyboard'}
                onPress={k => typeKey(k)}
                okLabel="Buscar"
              />
            </div>

            {/* Historial vertical de búsquedas recientes */}
            {recentSearches.length > 0 && (
              <div className="search-recent-panel">
                <div className="search-recent-header">
                  <span className="search-recent-title">Búsquedas recientes</span>
                </div>
                <div className="search-recent-list" ref={recentListRef}>
                  {recentSearches.map((s, idx) => {
                    const isFoc = focusArea === 'recent' && recentIndex === idx;
                    return (
                      <div
                        key={s}
                        className={`search-recent-item ${isFoc ? 'is-focused' : ''}`}
                        onClick={() => {
                          setQuery(s);
                          submitSearch(s);
                        }}
                      >
                        <span className="search-recent-item-text">{s}</span>
                        <button
                          type="button"
                          className="search-recent-item-remove"
                          title="Eliminar de historial"
                          onClick={e => {
                            e.stopPropagation();
                            removeRecentSearch(s);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                  <div
                    className={`search-recent-item search-recent-clear-item ${
                      focusArea === 'recent' && recentIndex === recentSearches.length ? 'is-focused' : ''
                    }`}
                    onClick={clearRecentSearches}
                  >
                    <span className="search-recent-item-text">Limpiar historial</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Results Area */}
          <div className="search-results-area">

          {showingPopular ? (
            <div className="search-results-counter search-popular-head">
              <span className="search-popular-title">Búsqueda popular</span>
              <span
                className={`search-popular-refresh ${focusArea === 'refresh' ? 'is-focused' : ''}`}
                onClick={refreshPopular}
              >
                Actualizar
              </span>
              <span className="search-popular-total">
                Total: <b>{totalResults}</b>
              </span>
            </div>
          ) : (
          <div className="search-results-counter">
            <span>
              {submittedQuery
                ? `Resultados para "${submittedQuery}": ${totalResults} ${isTvSearch ? 'canales' : 'títulos'}`
                : `Recomendados: ${totalResults} ${isTvSearch ? 'canales' : 'títulos'}`}
              {!isTvSearch && remoteState === 'loading' && ' · buscando en todo el catálogo…'}
              {!isTvSearch && remoteState === 'done' && remoteTotal > totalResults && ` · ${remoteTotal.toLocaleString('es')} en el catálogo`}
              {!isTvSearch && remoteState === 'failed' && ' · sin conexión con el catálogo completo'}
            </span>
            <span className="search-nav-hint">▲ ▼ ◀ ▶ y OK · Selecciona "Buscar" o ▶ para ver resultados</span>
          </div>
          )}

          {showSkeleton ? (
            // Titles on their way (first popular list, or the portal search with nothing to show yet): same cards, grayed
            <div className="search-vod-grid">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="search-vod-card svc-skeleton">
                  <div className="svc-poster-wrap skeleton-shimmer" />
                  <div className="svc-info">
                    <div className="svc-skeleton-line" />
                    <div className="svc-skeleton-line is-short" />
                  </div>
                </div>
              ))}
            </div>
          ) : totalResults === 0 ? (
            <div className="search-empty-state">
              <div className="search-empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <div className="search-empty-title">
                {!isTvSearch && remoteState === 'loading' ? `Buscando "${submittedQuery}" en todo el catálogo…` : `No se encontraron resultados para "${submittedQuery}"`}
              </div>
              <div className="search-empty-desc">
                {isTvSearch
                  ? 'Intenta buscar con otra palabra clave o revisa la lista de categorías.'
                  : 'Intenta buscar por género, año o un término más general.'}
              </div>
            </div>
          ) : isTvSearch ? (
            /* Channels Results Grid (2 Columns) */
            <div className="search-channels-grid" ref={resultsContainerRef}>
              {filteredChannels.map((ch, idx) => {
                const isFocused = focusArea === 'results' && focusedResultIndex === idx;
                const initials = String(ch.name || 'TV').trim().slice(0, 2).toUpperCase();

                return (
                  <div
                    key={ch.id || idx}
                    className={`search-channel-card ${isFocused ? 'is-focused' : ''}`}
                    onClick={() => {
                      onSelectChannel(ch);
                      onClose();
                    }}
                  >
                    <div className="sc-num">{idx + 1 < 10 ? `0${idx + 1}` : idx + 1}</div>
                    {ch.logo ? (
                      <img
                        className="sc-logo"
                        src={ch.logo}
                        alt=""
                        onError={e => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="sc-avatar">{initials}</div>
                    )}
                    <div className="sc-info">
                      <div className="sc-title">
                        <span>{ch.name}</span>
                        <span className="sc-badge">EN VIVO</span>
                      </div>
                      {ch.now && <div className="sc-now">{ch.now}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* VOD Results Grid (5 Columns) */
            <div className="search-vod-grid" ref={resultsContainerRef}>
              {filteredVod.map((item, idx) => {
                const isFocused = focusArea === 'results' && focusedResultIndex === idx;
                // Posters only around the focus, and none while the detail or the player covers the search: every
                // result used to keep its full-size poster decoded (lib/posterWindow.ts)
                const showPoster = !hidden && posterInWindow(idx, focusArea === 'results' ? focusedResultIndex : 0, vodCols);

                return (
                  <div
                    key={item.id || idx}
                    className={`search-vod-card ${isFocused ? 'is-focused' : ''}`}
                    onClick={() => {
                      onSelectVodItem(item);
                    }}
                  >
                    <div className="svc-poster-wrap">
                      <img
                        key={showPoster ? 'poster' : 'placeholder'}
                        className="svc-poster"
                        src={showPoster ? (item.poster || 'assets/placeholder_vertical.png') : 'assets/placeholder_vertical.png'}
                        alt={item.title}
                        data-alt-idx="0"
                        onError={e => {
                          const img = e.target as HTMLImageElement;
                          markImageFailed(img.currentSrc || img.src);
                          const alts = collectPosterAlternates(item.poster, item.posterAlternates, item.landscape, item.backdrop);
                          const nextIdx = (parseInt(img.getAttribute('data-alt-idx') || '0', 10) || 0) + 1;
                          if (nextIdx < alts.length) {
                            img.setAttribute('data-alt-idx', String(nextIdx));
                            img.src = alts[nextIdx];
                          } else if (!img.src.endsWith('assets/placeholder_vertical.png')) {
                            img.src = 'assets/placeholder_vertical.png';
                          }
                        }}
                      />
                      {item.score && item.score !== '0' && <div className="svc-score-badge">★ {item.score}</div>}
                      <div className="svc-kind-badge">{item.kind === 'serie' ? 'SERIE' : 'PELÍCULA'}</div>
                    </div>
                    <div className="svc-info">
                      <div className="svc-title">{item.title}</div>
                      <div className="svc-meta">{[item.year, item.genres?.[0]].filter(Boolean).join(' • ')}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
};