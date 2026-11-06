import React, { useState, useEffect, useRef, useMemo } from 'react';
import { VodItem } from '../types/vod';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { PosterCard } from '../components/vod/PosterCard';
import { BrowseRoot } from '../lib/screenStack';
import { BrandLogo } from '../components/common/BrandLogo';

export interface CategoryDef {
  id: string;
  name: string;
  icon: string;
  badge?: string;
  matcher: (it: VodItem) => boolean;
}

export const VOD_CATEGORIES: CategoryDef[] = [
  {
    id: 'all',
    name: '★ Todos los Títulos',
    icon: '★',
    matcher: () => true
  },
  {
    id: 'netflix',
    name: 'Netflix',
    icon: '🔴',
    badge: 'Originals',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const cat = (it.category || '').toLowerCase();
      const syn = (it.synopsis || '').toLowerCase();
      return row.includes('netflix') || cat.includes('netflix') || syn.includes('netflix');
    }
  },
  {
    id: 'hbo',
    name: 'HBO Max',
    icon: '🟣',
    badge: 'Cine & Series',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const cat = (it.category || '').toLowerCase();
      return row.includes('hbo') || cat.includes('hbo');
    }
  },
  {
    id: 'disney',
    name: 'Disney+',
    icon: '🔵',
    badge: 'Magia',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const cat = (it.category || '').toLowerCase();
      const title = (it.title || '').toLowerCase();
      return row.includes('disney') || cat.includes('disney') || title.includes('disney');
    }
  },
  {
    id: 'prime_paramount',
    name: 'Prime Video & Paramount+',
    icon: '🔷',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const cat = (it.category || '').toLowerCase();
      return row.includes('prime') || row.includes('paramount') || cat.includes('prime') || cat.includes('paramount');
    }
  },
  {
    id: 'apple_hulu',
    name: 'Apple TV+ & Hulu',
    icon: '🍎',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const cat = (it.category || '').toLowerCase();
      return row.includes('apple') || row.includes('hulu') || cat.includes('apple') || cat.includes('hulu');
    }
  },
  {
    id: 'action',
    name: 'Acción y Aventura',
    icon: '🍿',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const genres = (it.genres || []).map(g => g.toLowerCase());
      return row.includes('acción') || row.includes('accion') || row.includes('aventura') || genres.some(g => /action|acción|accion|aventura|adventure/.test(g));
    }
  },
  {
    id: 'horror',
    name: 'Terror y Suspenso',
    icon: '🎃',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const genres = (it.genres || []).map(g => g.toLowerCase());
      return row.includes('horror') || row.includes('halloween') || row.includes('suspenso') || row.includes('terror') || genres.some(g => /horror|terror|thriller|suspenso/.test(g));
    }
  },
  {
    id: 'comedy',
    name: 'Comedia',
    icon: '😂',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const genres = (it.genres || []).map(g => g.toLowerCase());
      return row.includes('comedia') || genres.some(g => /comedy|comedia/.test(g));
    }
  },
  {
    id: 'drama',
    name: 'Drama y Emoción',
    icon: '🎭',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const genres = (it.genres || []).map(g => g.toLowerCase());
      return row.includes('drama') || row.includes('telenovela') || genres.some(g => /drama/.test(g));
    }
  },
  {
    id: 'scifi',
    name: 'Ciencia Ficción y Fantasía',
    icon: '🚀',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const genres = (it.genres || []).map(g => g.toLowerCase());
      return row.includes('fantastico') || row.includes('sci-fi') || row.includes('ciencia') || genres.some(g => /sci-fi|ciencia|fantasy|fantasía|fantasia|fantástico/.test(g));
    }
  },
  {
    id: 'crime',
    name: 'Crimen y Misterio',
    icon: '🔍',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const genres = (it.genres || []).map(g => g.toLowerCase());
      return row.includes('crimen') || row.includes('misterio') || genres.some(g => /crime|crimen|mystery|misterio|policial/.test(g));
    }
  },
  {
    id: 'family',
    name: 'Familia e Infantil',
    icon: '👨‍👩‍👧',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const genres = (it.genres || []).map(g => g.toLowerCase());
      return row.includes('familia') || row.includes('niños') || row.includes('mickey') || row.includes('infantil') || genres.some(g => /family|familia|infantil|kids/.test(g));
    }
  },
  {
    id: 'anime',
    name: 'Anime y Animación',
    icon: '⚡',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const title = (it.title || '').toLowerCase();
      const genres = (it.genres || []).map(g => g.toLowerCase());
      return row.includes('anime') || row.includes('dragon ball') || title.includes('dragon ball') || title.includes('naruto') || genres.some(g => /anime|animation|animación|animacion/.test(g));
    }
  },
  {
    id: 'history',
    name: 'Historia y Bélica',
    icon: '📜',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const genres = (it.genres || []).map(g => g.toLowerCase());
      return row.includes('historia') || row.includes('bélica') || row.includes('belica') || genres.some(g => /history|historia|war|bélica|belica/.test(g));
    }
  },
  {
    id: 'romance',
    name: 'Romance',
    icon: '❤️',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const genres = (it.genres || []).map(g => g.toLowerCase());
      return row.includes('romántico') || row.includes('romantico') || genres.some(g => /romance|romántico|romantico/.test(g));
    }
  },
  {
    id: 'western',
    name: 'Occidental / Western',
    icon: '🤠',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const genres = (it.genres || []).map(g => g.toLowerCase());
      return row.includes('occidental') || row.includes('western') || genres.some(g => /western|occidental/.test(g));
    }
  },
  {
    id: 'sports',
    name: 'Deportes y Especiales',
    icon: '⚽',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      const title = (it.title || '').toLowerCase();
      const genres = (it.genres || []).map(g => g.toLowerCase());
      return row.includes('deporte') || row.includes('sport') ||
             genres.some(g => /sport|deporte|fútbol|futbol|boxeo|carreras|f1|lucha/i.test(g)) ||
             /deporte|fútbol|futbol|champions|boxeo|carreras|f1|fórmula 1|lucha|ufc/i.test(title);
    }
  },
  {
    id: 'releases2026',
    name: 'Estrenos 2026',
    icon: '✨',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      return row.includes('2026') || it.year === '2026';
    }
  },
  {
    id: 'trailers',
    name: 'Tráilers y Avances',
    icon: '🎬',
    matcher: it => {
      const row = (it.row || '').toLowerCase();
      return row.includes('tráiler') || row.includes('trailer');
    }
  }
];

export function resolveCategoryIdForRow(titleOrRow: string): string {
  const t = (titleOrRow || '').toLowerCase();
  if (t.includes('netflix')) return 'netflix';
  if (t.includes('hbo')) return 'hbo';
  if (t.includes('disney')) return 'disney';
  if (t.includes('prime') || t.includes('paramount')) return 'prime_paramount';
  if (t.includes('apple') || t.includes('hulu')) return 'apple_hulu';
  if (t.includes('terror') || t.includes('horror') || t.includes('halloween') || t.includes('suspenso')) return 'horror';
  if (t.includes('acción') || t.includes('accion') || t.includes('aventura')) return 'action';
  if (t.includes('comedia')) return 'comedy';
  if (t.includes('drama') || t.includes('telenovela')) return 'drama';
  if (t.includes('ciencia') || t.includes('fantast') || t.includes('sci-fi')) return 'scifi';
  if (t.includes('crimen') || t.includes('misterio')) return 'crime';
  if (t.includes('infantil') || t.includes('familia') || t.includes('mickey') || t.includes('niños')) return 'family';
  if (t.includes('anime') || t.includes('dragon ball')) return 'anime';
  if (t.includes('historia') || t.includes('bélica') || t.includes('belica')) return 'history';
  if (t.includes('romance') || t.includes('romántic')) return 'romance';
  if (t.includes('western') || t.includes('occidental')) return 'western';
  if (t.includes('deporte') || t.includes('sport')) return 'sports';
  if (t.includes('tráiler') || t.includes('trailer')) return 'trailers';
  if (t.includes('2026') || t.includes('estreno')) return 'releases2026';
  return 'all';
}

function fastScrollList(container: HTMLElement, targetIndex: number, itemPitch: number, pad = 12) {
  const targetTop = targetIndex * itemPitch;
  const cTop = container.scrollTop;
  const cHeight = container.clientHeight || 700;
  if (targetTop < cTop + pad) {
    container.scrollTop = Math.max(0, targetTop - pad);
  } else if (targetTop + itemPitch > cTop + cHeight - pad) {
    container.scrollTop = targetTop + itemPitch - cHeight + pad;
  }
}

import { setTrackOffset } from '../utils/scrollHelper';
import { useViewProfiler } from '../lib/perfMonitor';

interface BrowseScreenProps {
  isTop: boolean;
  /** Hidden (and inactive) while a detail opened from here is on screen */
  hidden: boolean;
  isSearchOpen?: boolean;
  root: BrowseRoot;
  title: string;
  initialTag?: string;
  initialYear?: string;
  initialCategory?: string;
  fixedItems?: VodItem[];
  catalogRows?: Record<string, VodItem[]>;
  catalogItems?: VodItem[];
  onClose: () => void;
  onOpenVod: (item: VodItem) => void;
  onOpenSearch?: () => void;
}

type BrowseArea = 'cats' | 'grid' | 'search';

const CARD_H = 250;
const GAP_Y = 16;
const ROW_HEIGHT = CARD_H + GAP_Y;
const COLS = 7;

const ROOT_LABEL: Record<BrowseRoot, string> = {
  featured: 'Catálogo de Destacados',
  movies: 'Catálogo de Películas',
  series: 'Catálogo de Series',
  kids: 'Catálogo Infantil y Familiar',
  anime: 'Catálogo de Anime'
};

export const BrowseScreen: React.FC<BrowseScreenProps> = ({
  isTop,
  hidden,
  isSearchOpen = false,
  root,
  title,
  initialCategory,
  fixedItems,
  catalogItems,
  onClose,
  onOpenVod,
  onOpenSearch
}) => {
  useViewProfiler('Categorías');
  const catListRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const gridTrackRef = useRef<HTMLDivElement>(null);
  const [maxLoadedRow, setMaxLoadedRow] = useState(2);

  // Pool of items for this section (both full un-segmented pool and section pool)
  const { fullPool, allPool } = useMemo(() => {
    const list: VodItem[] = [];
    const seen = new Set<string>();

    if (fixedItems && fixedItems.length) {
      for (const it of fixedItems) {
        if (!seen.has(it.id)) {
          seen.add(it.id);
          list.push(it);
        }
      }
    }

    if (catalogItems && catalogItems.length) {
      for (const it of catalogItems) {
        if (!seen.has(it.id)) {
          seen.add(it.id);
          list.push(it);
        }
      }
    } else if (typeof window !== 'undefined' && window.XUPERTV_PORTAL?.items) {
      for (const it of window.XUPERTV_PORTAL.items) {
        const id = String(it.id || it.vodId);
        if (!seen.has(id)) {
          seen.add(id);
          list.push(it);
        }
      }
    }

    let filtered = list;
    if (root === 'movies') {
      filtered = list.filter(it => !it.isSeries);
    } else if (root === 'series') {
      filtered = list.filter(it => it.isSeries);
    } else if (root === 'kids') {
      filtered = list.filter(it => {
        const cat = (it.category || '').toLowerCase();
        const row = (it.row || '').toLowerCase();
        const genres = (it.genres || []).map(g => g.toLowerCase());
        return cat.includes('kids') || row.includes('kids') || genres.some(g => /infantil|familia|kids/i.test(g));
      });
    } else if (root === 'anime') {
      filtered = list.filter(it => {
        const cat = (it.category || '').toLowerCase();
        const row = (it.row || '').toLowerCase();
        const t = (it.title || '').toLowerCase();
        return cat.includes('anime') || row.includes('anime') || t.includes('dragon ball') || t.includes('naruto');
      });
    }
    return { fullPool: list, allPool: filtered };
  }, [fixedItems, catalogItems, root]);

  // Compute counts for all defined categories (platform brands and sports draw from full pool)
  const categoriesWithCounts = useMemo(() => {
    const isPlatformOrCross = (id: string) =>
      ['netflix', 'hbo', 'disney', 'prime_paramount', 'apple_hulu', 'sports'].includes(id);

    return VOD_CATEGORIES.map(cat => {
      let count = 0;
      const pool = isPlatformOrCross(cat.id) ? fullPool : allPool;
      if (cat.id === 'all') {
        count = allPool.length;
      } else {
        count = pool.filter(cat.matcher).length;
      }
      return { ...cat, count };
    }).filter(c => c.count > 0 || c.id === 'all');
  }, [allPool, fullPool]);

  // Determine initial selected category
  const resolvedInitialCat = useMemo(() => {
    if (initialCategory) return initialCategory;
    return resolveCategoryIdForRow(title);
  }, [initialCategory, title]);

  const initialCatIndex = useMemo(() => {
    const at = categoriesWithCounts.findIndex(c => c.id === resolvedInitialCat);
    return at !== -1 ? at : 0;
  }, [categoriesWithCounts, resolvedInitialCat]);

  const [selectedCatId, setSelectedCatId] = useState<string>(
    categoriesWithCounts[initialCatIndex]?.id || 'all'
  );
  const [catIndex, setCatIndex] = useState<number>(initialCatIndex);
  const [area, setArea] = useState<BrowseArea>('grid');
  const [gridIndex, setGridIndex] = useState<number>(0);

  // Synchronize category selection if initialCatIndex changes
  useEffect(() => {
    if (categoriesWithCounts[initialCatIndex]) {
      setSelectedCatId(categoriesWithCounts[initialCatIndex].id);
      setCatIndex(initialCatIndex);
    }
  }, [initialCatIndex, categoriesWithCounts]);

  // Items currently displayed in the grid
  const activeCategory = useMemo(() => {
    return categoriesWithCounts.find(c => c.id === selectedCatId) || categoriesWithCounts[0] || VOD_CATEGORIES[0];
  }, [selectedCatId, categoriesWithCounts]);

  const activeItems = useMemo(() => {
    if (!activeCategory || activeCategory.id === 'all') {
      return allPool;
    }
    const isPlatformOrCross = ['netflix', 'hbo', 'disney', 'prime_paramount', 'apple_hulu', 'sports'].includes(activeCategory.id);
    const pool = isPlatformOrCross ? fullPool : allPool;
    return pool.filter(activeCategory.matcher);
  }, [activeCategory, allPool, fullPool]);

  // Zero-reflow category list scrolling
  useEffect(() => {
    if (area === 'cats' && catListRef.current) {
      fastScrollList(catListRef.current, catIndex, 48, 12);
    }
  }, [area, catIndex]);

  // Reset scroll and image window on category change
  useEffect(() => {
    setMaxLoadedRow(2);
    if (gridTrackRef.current) {
      setTrackOffset(gridTrackRef.current, 'y', 0, false);
    }
  }, [selectedCatId]);

  // Hardware-accelerated GPU track scrolling & progressive image windowing
  useEffect(() => {
    if (area === 'grid') {
      const rowIndex = Math.floor(gridIndex / COLS);
      const targetOffset = Math.max(0, (rowIndex - 1) * ROW_HEIGHT);
      if (gridTrackRef.current) {
        setTrackOffset(gridTrackRef.current, 'y', targetOffset);
      }
      const targetRow = rowIndex + 2;
      setMaxLoadedRow(prev => (targetRow > prev ? targetRow : prev));
    }
  }, [area, gridIndex]);

  // TV Remote Key Handler
  useScreenKeys(key => {
    if (key === 'back') {
      if (area === 'grid') {
        // Return from grid to categories column
        setArea('cats');
      } else if (area === 'search') {
        setArea('cats');
      } else {
        // Exit BrowseScreen back to previous screen
        onClose();
      }
      return;
    }

    if (area === 'cats') {
      if (key === 'up') {
        if (catIndex === 0) {
          setArea('search');
        } else {
          const next = catIndex - 1;
          setCatIndex(next);
          setSelectedCatId(categoriesWithCounts[next].id);
          setGridIndex(0);
        }
      } else if (key === 'down') {
        if (catIndex < categoriesWithCounts.length - 1) {
          const next = catIndex + 1;
          setCatIndex(next);
          setSelectedCatId(categoriesWithCounts[next].id);
          setGridIndex(0);
        }
      } else if (key === 'right' || key === 'enter') {
        if (activeItems.length > 0) {
          setArea('grid');
          setGridIndex(0);
        }
      }
      return;
    }

    if (area === 'grid') {
      const total = activeItems.length;
      if (key === 'left') {
        if (gridIndex % COLS === 0) {
          // On leftmost card column: jump seamlessly back to categories column
          setArea('cats');
        } else {
          setGridIndex(i => Math.max(0, i - 1));
        }
      } else if (key === 'right') {
        if (gridIndex % COLS !== COLS - 1 && gridIndex + 1 < total) {
          setGridIndex(i => i + 1);
        }
      } else if (key === 'up') {
        if (gridIndex < COLS) {
          setArea('cats');
        } else {
          setGridIndex(i => i - COLS);
        }
      } else if (key === 'down') {
        if (gridIndex + COLS < total) {
          setGridIndex(i => i + COLS);
        }
      } else if (key === 'enter') {
        const it = activeItems[gridIndex];
        if (it) onOpenVod(it);
      }
      return;
    }

    if (area === 'search') {
      if (key === 'down') {
        setArea('cats');
      } else if (key === 'enter') {
        if (onOpenSearch) onOpenSearch();
      }
      return;
    }
  }, isTop && !hidden && !isSearchOpen);

  const screenTitle = title && title !== 'browse' ? title : ROOT_LABEL[root] || 'Catálogo';

  return (
    <div className="browse-screen" style={hidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
      {/* Brand Header */}
      <div className="browse-head">
        <div className="browse-head-left">
          <BrandLogo />
          <div className="browse-header-divider" />
          <div className="browse-heading">
            <h1 className="browse-title">{screenTitle}</h1>
            <div className="browse-subtitle">
              <span className="browse-count">{activeCategory.name}</span>
              <span className="browse-subtitle-dot">•</span>
              <span className="browse-subtitle-desc">{activeItems.length} títulos en esta categoría</span>
            </div>
          </div>
        </div>

        <div className="browse-head-right">
          <div
            className={`browse-search-pill ${area === 'search' ? 'is-focused' : ''}`}
            onClick={() => onOpenSearch && onOpenSearch()}
          >
            <svg
              className="browse-search-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span>Buscar títulos</span>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Categories on Left, Grid on Right (like Live TV) */}
      <div className="browse-two-col">
        {/* Left Column: Categories List */}
        <div className="browse-col-cats">
          <div className="browse-col-header">
            <span className="browse-col-title">CATEGORÍAS</span>
            <span className="browse-col-count">{categoriesWithCounts.length}</span>
          </div>

          <div className="browse-cat-vlist" ref={catListRef}>
            {categoriesWithCounts.map((cat, idx) => {
              const isCur = cat.id === selectedCatId;
              const isFoc = area === 'cats' && idx === catIndex;
              return (
                <div
                  key={cat.id}
                  className={`browse-cat-vrow ${isCur ? 'is-active-cat' : ''} ${isFoc ? 'is-focused' : ''}`}
                  onClick={() => {
                    setSelectedCatId(cat.id);
                    setCatIndex(idx);
                    setArea('grid');
                    setGridIndex(0);
                  }}
                >
                  <div className="browse-cat-info">
                    <span className="browse-cat-icon">{cat.icon}</span>
                    <span className="browse-cat-vname">{cat.name}</span>
                  </div>
                  {cat.count !== undefined && (
                    <span className="browse-cat-vcount">{cat.count}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Cards Grid */}
        <div className="browse-col-grid" ref={gridContainerRef}>
          <div className="browse-grid-subhead">
            <h2 className="browse-category-name">{activeCategory.name}</h2>
            <span className="browse-category-total">{activeItems.length} títulos disponibles</span>
          </div>

          {activeItems.length === 0 ? (
            <div className="browse-empty-category">
              <div className="browse-empty-icon">🎬</div>
              <div className="browse-empty-text">No hay títulos disponibles en esta categoría.</div>
            </div>
          ) : (
            <div className="browse-cards-grid-track" ref={gridTrackRef}>
              <div className="browse-cards-grid">
                {activeItems.map((item, idx) => {
                  const isFocusedCard = area === 'grid' && idx === gridIndex;
                  const cardRow = Math.floor(idx / COLS);
                  const isCardShown = cardRow <= maxLoadedRow;
                  return (
                    <PosterCard
                      key={`${item.id}-${idx}`}
                      item={item}
                      isFocused={isFocusedCard}
                      showImage={isCardShown}
                      onActivate={onOpenVod}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
