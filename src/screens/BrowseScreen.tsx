import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VodItem } from '../types/vod';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { PosterCard } from '../components/vod/PosterCard';
import { BrowseRoot } from '../lib/screenStack';

interface BrowseScreenProps {
  isTop: boolean;
  /** Hidden (and inactive) while a detail opened from here is on screen */
  hidden: boolean;
  isSearchOpen?: boolean;
  root: BrowseRoot;
  title: string;
  initialTag?: string;
  initialYear?: string;
  /** Titles of the row's portal column (no full listing exists): shown first, then the section */
  fixedItems?: VodItem[];
  onClose: () => void;
  onOpenVod: (item: VodItem) => void;
  onOpenSearch?: () => void;
}

type Area = 'bar' | 'menu' | 'grid';
type Filter = 'tag' | 'year';

// Card box and gaps, same as .browse-grid; the column count is measured from the screen width
const CARD_W = 176;
const CARD_H = 262;
const GAP_X = 22;
const GAP_Y = 24;
// Portal answers are TripleDES-decrypted on the main thread: smaller pages block the TV less
const PAGE_SIZE = 36;
const ROW_HEIGHT = CARD_H + GAP_Y;
const IMAGE_ROWS_AHEAD = 3;
const MENU_VISIBLE = 9;

const ROOT_LABEL: Record<BrowseRoot, string> = {
  featured: 'Destacados',
  movies: 'Películas',
  series: 'Series',
  kids: 'Kids',
  anime: 'Anime'
};

// Portal genre tags come in English
const TAG_ES: Record<string, string> = {
  Action: 'Acción', Drama: 'Drama', Adventure: 'Aventura', Crime: 'Crimen', 'Sci-Fi': 'Ciencia ficción',
  Cartoon: 'Dibujos', Comedy: 'Comedia', Romance: 'Romance', Animation: 'Animación', Family: 'Familia',
  Fantasy: 'Fantasía', Thriller: 'Suspenso', Horror: 'Terror', History: 'Historia', Mystery: 'Misterio',
  Documentary: 'Documental', 'Reality-TV': 'Reality', Short: 'Cortos', War: 'Bélica', Western: 'Western',
  Biography: 'Biografía', Music: 'Música', Sport: 'Deporte', 'Game Shows': 'Concursos'
};

export function tagLabel(tag: string): string {
  return TAG_ES[tag] || tag;
}

interface Page {
  items: VodItem[];
  total: number;
}

// Pages already asked for (this session): going back to a filter, or one prefetched, is instant
const pageCache = new Map<string, { promise: Promise<Page>; low: boolean; done: boolean }>();

/** `low`: prefetch, behind every request the user is waiting for */
function loadPage(root: BrowseRoot, tag: string, year: string, pageNum: number, low = false): Promise<Page> {
  const key = `${root}|${tag}|${year}|${pageNum}`;
  const hit = pageCache.get(key);
  // A prefetch still waiting in the queue is asked again with priority (the first answer wins)
  if (hit && (hit.done || !hit.low || low)) return hit.promise;
  const p = new Promise<Page>((resolve, reject) => {
    const client = window.MagisClient;
    if (!client || typeof client.browse !== 'function') return reject(new Error('no portal client'));
    client.browse(root, { tags: tag, year }, pageNum, PAGE_SIZE, (err: any, res: any) => {
      if (err) return reject(err);
      const items: VodItem[] = (res.items || []).map((it: any) => ({
        ...it,
        isSeries: it.type === 'teleplay' || it.kind === 'serie'
      }));
      resolve({ items, total: res.total || 0 });
    }, { low });
  });
  const promise = hit ? Promise.race([hit.promise, p]) : p;
  const entry = { promise, low, done: false };
  pageCache.set(key, entry);
  promise.then(() => { entry.done = true; }, () => pageCache.delete(key));
  return promise;
}

/** "Ver todo": the full catalog of a section from the portal, with genre and year filters */
export const BrowseScreen: React.FC<BrowseScreenProps> = ({
  isTop,
  hidden,
  isSearchOpen = false,
  root,
  title,
  initialTag = '',
  initialYear = '',
  fixedItems,
  onClose,
  onOpenVod,
  onOpenSearch
}) => {
  const [tags, setTags] = useState<string[]>([]);
  const [years, setYears] = useState<string[]>([]);
  const [tag, setTag] = useState(initialTag);
  const [year, setYear] = useState(initialYear);
  const [items, setItems] = useState<VodItem[]>(fixedItems || []);
  const [total, setTotal] = useState(fixedItems ? fixedItems.length : 0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [area, setArea] = useState<Area>('grid');
  const [barIndex, setBarIndex] = useState(0); // 0 = genre, 1 = year, 2 = search
  const [menuCursor, setMenuCursor] = useState(0);
  const [cursor, setCursor] = useState(0);
  const pageRef = useRef(0);
  const loadingRef = useRef(false);
  const queryRef = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Columns that fit the body: the key logic and the CSS grid share this number
  const [cols, setCols] = useState(9);
  useEffect(() => {
    const measure = () => {
      const w = bodyRef.current ? bodyRef.current.clientWidth : 0;
      setCols(Math.max(1, Math.floor((w + GAP_X) / (CARD_W + GAP_X))) || 9);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const COLS = cols;

  // Filter values of the section
  useEffect(() => {
    const client = window.MagisClient;
    if (!client || typeof client.browseFilters !== 'function') return;
    client.browseFilters(root, (err: any, res: any) => {
      if (err || !res) return;
      setTags(res.tags || []);
      setYears((res.year || []).slice(0, 30));
    });
  }, [root]);

  const loadMore = useCallback(() => {
    if (loadingRef.current) return;
    const query = queryRef.current;
    loadingRef.current = true;
    setLoading(true);
    const first = pageRef.current === 0;
    // Without filters, the row's own titles come first and the section follows (no repeats)
    const lead = fixedItems && !tag && !year ? fixedItems : [];
    const leadIds = new Set(lead.map(it => it.id));
    loadPage(root, tag, year, pageRef.current + 1).then(page => {
      if (query !== queryRef.current) return;
      pageRef.current += 1;
      const fresh = page.items.filter(it => !leadIds.has(it.id));
      // A new filter replaces the grid only when its first page is here (no empty screen meanwhile)
      setItems(prev => (first ? lead.concat(fresh) : prev.concat(fresh)));
      if (first && !lead.length) setCursor(0);
      setTotal(lead.length + page.total);
      setFailed(false);
    }, () => {
      if (query === queryRef.current) setFailed(true);
    }).then(() => {
      if (query !== queryRef.current) return;
      loadingRef.current = false;
      setLoading(false);
    });
  }, [root, tag, year, fixedItems]);

  // New filter: start over from page 1
  useEffect(() => {
    queryRef.current += 1;
    pageRef.current = 0;
    loadingRef.current = false;
    loadMore();
  }, [loadMore]);

  // Next page when the cursor gets close to the end of what is loaded
  useEffect(() => {
    if (area !== 'grid' || loading || failed) return;
    if (items.length < total && cursor >= items.length - COLS * 2) loadMore();
  }, [cursor, area, items.length, total, loading, failed, loadMore]);

  // Keep the focused row in view (two rows above it stay visible)
  const focusRow = Math.floor(cursor / COLS);
  useEffect(() => {
    if (gridRef.current) gridRef.current.style.transform = `translateY(${-Math.max(0, focusRow - 1) * ROW_HEIGHT}px)`;
  }, [focusRow]);

  // Virtual windowing: only render cards within a visible window (2 rows above, 5 rows below)
  // This prevents mounting hundreds/thousands of DOM nodes on Samsung TV, keeping controls 100% responsive
  const totalRows = Math.ceil(items.length / COLS);
  const startRow = Math.max(0, focusRow - 2);
  const endRow = Math.min(totalRows, focusRow + 5);
  const startIndex = startRow * COLS;
  const endIndex = Math.min(items.length, endRow * COLS);
  const visibleItems = items.slice(startIndex, endIndex);
  const paddingTop = startRow * ROW_HEIGHT;
  const paddingBottom = Math.max(0, (totalRows - endRow) * ROW_HEIGHT);

  const tagOptions = ['', ...tags];
  const yearOptions = ['', ...years];
  const menuFilter: Filter = barIndex === 0 ? 'tag' : 'year';
  const menuOptions = menuFilter === 'tag' ? tagOptions : yearOptions;
  const optionLabel = (f: Filter, v: string) => (f === 'tag' ? (v ? tagLabel(v) : 'Todos') : v || 'Todos');

  // The option the cursor rests on is fetched ahead, so OK often finds it ready. Only that one:
  // each answer is decrypted on the main thread, and prefetching every option made the menu lag
  useEffect(() => {
    if (area !== 'menu') return;
    const v = menuOptions[menuCursor];
    if (v === undefined) return;
    const t = setTimeout(() => {
      if (menuFilter === 'tag') loadPage(root, v, year, 1).catch(() => {});
      else loadPage(root, tag, v, 1).catch(() => {});
    }, 450);
    return () => clearTimeout(t);
  }, [area, menuCursor, menuFilter]);

  const openMenu = () => {
    setArea('menu');
    const at = Math.max(0, menuOptions.indexOf(menuFilter === 'tag' ? tag : year));
    setMenuCursor(at);
  };

  useScreenKeys(key => {
    if (key === 'back') {
      // If a dropdown menu is open, close the menu to bar; otherwise exit BrowseScreen to return to previous page
      if (area === 'menu') {
        setArea('bar');
      } else {
        onClose();
      }
      return;
    }
    if (area === 'grid') {
      if (key === 'left') setCursor(c => (c % COLS === 0 ? c : c - 1));
      else if (key === 'right') setCursor(c => (c % COLS === COLS - 1 || c + 1 >= items.length ? c : c + 1));
      else if (key === 'down') setCursor(c => (c + COLS < items.length ? c + COLS : c));
      else if (key === 'up') {
        if (cursor < COLS) setArea('bar');
        else setCursor(c => c - COLS);
      } else if (key === 'enter') {
        const it = items[cursor];
        if (it) onOpenVod(it);
      }
      return;
    }
    if (area === 'bar') {
      if (key === 'left') setBarIndex(c => Math.max(0, c - 1));
      else if (key === 'right') setBarIndex(c => Math.min(2, c + 1));
      else if (key === 'down' && items.length) setArea('grid');
      else if (key === 'enter') {
        if (barIndex === 2) {
          if (onOpenSearch) onOpenSearch();
        } else {
          openMenu();
        }
      }
      return;
    }
    // Open menu: ▲ ▼ choose, OK applies, ◄ / Back close
    if (key === 'up') setMenuCursor(c => Math.max(0, c - 1));
    else if (key === 'down') setMenuCursor(c => Math.min(menuOptions.length - 1, c + 1));
    else if (key === 'left') setArea('bar');
    else if (key === 'enter') {
      const value = menuOptions[menuCursor] || '';
      if (menuFilter === 'tag') setTag(value);
      else setYear(value);
      setArea('grid');
    }
  }, isTop && !hidden && !isSearchOpen);

  const menuStart = Math.min(Math.max(0, menuCursor - Math.floor(MENU_VISIBLE / 2)), Math.max(0, menuOptions.length - MENU_VISIBLE));

  const filterButton = (index: number, f: Filter, value: string) => (
    <div className={`browse-filter ${area !== 'grid' && barIndex === index ? 'is-focused' : ''} ${value ? 'is-active' : ''}`}>
      <span className="browse-filter-name">{f === 'tag' ? 'Género' : 'Año'}</span>
      <span className="browse-filter-value">{optionLabel(f, value)}</span>
      <svg className="browse-filter-caret" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M6 9l6 6 6-6" />
      </svg>
      {area === 'menu' && barIndex === index && (
        <div className="browse-menu">
          {menuOptions.slice(menuStart, menuStart + MENU_VISIBLE).map((v, i) => {
            const idx = menuStart + i;
            return (
              <div key={v || 'all'} className={`browse-menu-row ${idx === menuCursor ? 'is-focused' : ''}`}>
                <span className="browse-menu-check">{v === value ? '✓' : ''}</span>
                <span>{optionLabel(f, v)}</span>
              </div>
            );
          })}
          {menuOptions.length > MENU_VISIBLE && (
            <div className="browse-menu-more">{menuCursor + 1} / {menuOptions.length}</div>
          )}
        </div>
      )}
    </div>
  );

  // The row's title while its filter is on; the section name once the user changes the filters
  const sectionTitle = tag === initialTag && year === initialYear && title ? title : ROOT_LABEL[root];

  return (
    <div className="browse-screen" style={hidden ? { display: 'none' } : undefined}>
      <div className="browse-head">
        <div className="browse-heading">
          <h1 className="browse-title">{sectionTitle}</h1>
          <div className="browse-subtitle">
            <span className="browse-count">
              {total ? `${total.toLocaleString('es')} títulos disponibles` : loading ? 'Cargando títulos…' : 'Catálogo completo'}
            </span>
            <span className="browse-subtitle-dot">•</span>
            <span className="browse-subtitle-desc">Filtra por género o año, o busca por título</span>
          </div>
        </div>
        {/* Fixed on the right: Filters + Search button */}
        <div className="browse-filters">
          {filterButton(0, 'tag', tag)}
          {filterButton(1, 'year', year)}
          <div
            className={`browse-filter browse-search-btn ${area !== 'grid' && barIndex === 2 ? 'is-focused' : ''}`}
            onClick={() => onOpenSearch && onOpenSearch()}
          >
            <svg
              className="browse-search-icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="browse-filter-value">Buscar</span>
          </div>
        </div>
      </div>

      <div className="browse-body" ref={bodyRef}>
        <div
          className={`browse-grid ${loading && pageRef.current === 0 && items.length ? 'is-loading' : ''}`}
          ref={gridRef}
          style={{
            gridTemplateColumns: `repeat(${cols}, ${CARD_W}px)`,
            paddingTop: `${paddingTop}px`,
            paddingBottom: `${paddingBottom}px`,
            boxSizing: 'content-box'
          }}
        >
          {visibleItems.map((it, idx) => {
            const i = startIndex + idx;
            return (
              <PosterCard
                key={`${it.id}-${i}`}
                item={it}
                isFocused={area === 'grid' && i === cursor}
                showImage={true}
                onActivate={onOpenVod}
              />
            );
          })}
        </div>
        {!loading && !items.length && (
          <div className="browse-empty">{failed ? 'No se pudo cargar el catálogo. Atrás para volver.' : 'No hay títulos con estos filtros.'}</div>
        )}
      </div>
    </div>
  );
};
