import React, { useState, useEffect, useRef, useMemo, useCallback, useReducer } from 'react';
import { VodItem } from '../types/vod';
import { PortalColumn, portalRootId, getPortalColumns, getPortalColumnPage } from '../services/catalogService';
import { parentalService } from '../services/parentalService';
import { historyService } from '../services/historyService';
import { isAdultLabel } from '../lib/catalogOrganizer';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { PosterCard } from '../components/vod/PosterCard';
import { BrowseRoot } from '../lib/screenStack';
import { ScreenHeader, SearchIcon, FilterIcon } from '../components/layout/Header';

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

function plain(text: string): string {
  return (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

/** Portal column names that answer to each app category (used when a row opens the catalog) */
const CATEGORY_COLUMN_PATTERNS: Record<string, RegExp> = {
  all: /^(all|todos|todas)$/,
  netflix: /netf?l?ix/,
  hbo: /hbo/,
  disney: /disney/,
  prime_paramount: /prime|paramount/,
  apple_hulu: /apple|hulu/,
  action: /accion|aventura/,
  horror: /horror|terror|suspenso/,
  comedy: /comedia/,
  drama: /drama/,
  scifi: /ciencia|fantast/,
  crime: /crimen|misterio/,
  family: /familia|ninos|infantil/,
  anime: /anime/,
  history: /historia|guerra/,
  romance: /romant/,
  western: /occidental|western/,
  sports: /deporte|sport/,
  releases2026: /2026/,
  trailers: /trailer/
};

const PLATFORM_CATEGORIES = ['netflix', 'hbo', 'disney', 'prime_paramount', 'apple_hulu'];

/**
 * Column a row opens on: the row's own name, then its portal column ("Netflix Series"), then the
 * column of its app category ("HBO: Series Exclusivas" -> "HBO Series"). -1 when none is here.
 */
function findInitialColumn(cols: PortalColumn[], title: string, column: string | undefined, category: string): number {
  const byTitle = title ? cols.findIndex(c => plain(c.name) === plain(title)) : -1;
  if (byTitle !== -1) return byTitle;
  const byColumn = column ? cols.findIndex(c => plain(c.name) === plain(column)) : -1;
  if (byColumn !== -1) return byColumn;
  const pattern = CATEGORY_COLUMN_PATTERNS[category];
  return pattern ? cols.findIndex(c => pattern.test(plain(c.name))) : -1;
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
  /** Portal column of the row that opened the screen (e.g. "Netflix Series") */
  initialColumn?: string;
  fixedItems?: VodItem[];
  catalogRows?: Record<string, VodItem[]>;
  catalogItems?: VodItem[];
  onClose: () => void;
  onOpenVod: (item: VodItem) => void;
  onOpenSearch?: () => void;
  onOpenFilter?: () => void;
}

type BrowseArea = 'cats' | 'grid' | 'search';

/** One sidebar entry: a portal column, the opening row's own titles, or an app category (offline) */
interface SideEntry {
  key: string;
  name: string;
  icon?: string;
  count?: number;
  colId?: number;
}

interface ColumnData {
  items: VodItem[];
  /** -1 until the first page arrives */
  total: number;
  pages: number;
  loading: boolean;
  error: boolean;
}

const CARD_H = 250;
const GAP_Y = 16;
const ROW_HEIGHT = CARD_H + GAP_Y;
const COLS = 7;
/** Titles asked to the portal at a time (6 rows) */
const PAGE_SIZE = 42;
/** Rows kept in the DOM around the focused row */
const ROWS_BEFORE = 2;
const ROWS_AFTER = 4;
/** Wait for the sidebar to stop moving before asking for a column's titles */
const SELECT_DEBOUNCE_MS = 220;
const FIXED_KEY = 'row';

const ROOT_LABEL: Record<BrowseRoot, string> = {
  featured: 'Catálogo de Destacados',
  movies: 'Catálogo de Películas',
  series: 'Catálogo de Series',
  kids: 'Catálogo Infantil y Familiar',
  anime: 'Catálogo de Anime',
  explorar: 'Explorar',
  adult: 'Adultos +18'
};

export const BrowseScreen: React.FC<BrowseScreenProps> = ({
  isTop,
  hidden,
  isSearchOpen = false,
  root,
  title,
  initialCategory,
  initialColumn,
  fixedItems,
  catalogItems,
  onClose,
  onOpenVod,
  onOpenSearch,
  onOpenFilter
}) => {
  useViewProfiler('Categorías');
  const catListRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const gridTrackRef = useRef<HTMLDivElement>(null);
  const [maxLoadedRow, setMaxLoadedRow] = useState(2);

  const wantedCat = initialCategory || resolveCategoryIdForRow(title);

  // ---------- Portal tree: the official sidebar (null while loading; 'offline' -> app categories)
  const [portalCols, setPortalCols] = useState<PortalColumn[] | null | 'offline'>(() =>
    portalRootId(root) === undefined ? 'offline' : null
  );
  useEffect(() => {
    const rootId = portalRootId(root);
    if (rootId === undefined) {
      setPortalCols('offline');
      return;
    }
    let alive = true;
    setPortalCols(null);
    const isAdultRoot = root === 'adult';
    getPortalColumns(rootId, { special: isAdultRoot })
      // Without the +18 section enabled, erotic columns stay out of the other sections
      .then(list => (isAdultRoot || parentalService.isAdultEnabled() ? list : list.filter(c => !isAdultLabel(c.name))))
      .then(async list => {
        // A platform row whose platform has no column in this section opens Explorar, which has them all
        const explorarId = portalRootId('explorar');
        if (
          root !== 'explorar' && explorarId !== undefined && PLATFORM_CATEGORIES.includes(wantedCat) &&
          findInitialColumn(list, title, initialColumn, wantedCat) === -1
        ) {
          const alt = await getPortalColumns(explorarId).catch(() => null);
          if (alt && findInitialColumn(alt, title, initialColumn, wantedCat) !== -1) return alt;
        }
        return list;
      })
      .then(
        // The adult section has no offline categories: an empty list rather than the general ones
        list => { if (alive) setPortalCols(list.length || isAdultRoot ? list : 'offline'); },
        () => { if (alive) setPortalCols(isAdultRoot ? [] : 'offline'); }
      );
    return () => { alive = false; };
    // The opening row only matters for the first load of this screen
  }, [root]);
  const isPortal = Array.isArray(portalCols);

  // Titles of each portal column, loaded page by page
  const dataRef = useRef<Record<number, ColumnData>>({});
  const [dataVersion, bumpData] = useReducer((x: number) => x + 1, 0);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const loadNextPage = useCallback((colId: number) => {
    const map = dataRef.current;
    const d = map[colId] || (map[colId] = { items: [], total: -1, pages: 0, loading: false, error: false });
    if (d.loading || (d.total >= 0 && d.items.length >= d.total)) return;
    d.loading = true;
    d.error = false;
    const page = d.pages + 1;
    const isAdultRoot = root === 'adult';
    getPortalColumnPage(colId, page, PAGE_SIZE, { restricted: isAdultRoot }).then(
      res => {
        const items = isAdultRoot
          ? res.items.map(it => ({ ...it, restricted: true, privateContent: true, category: 'adult' }))
          : res.items;
        if (isAdultRoot && items.length) {
          historyService.markPrivate(items);
        }
        d.items = d.items.concat(items);
        d.pages = page;
        // An empty page ends the column even if the total says otherwise
        d.total = items.length ? Math.max(res.total, d.items.length) : d.items.length;
      },
      () => { d.error = true; }
    ).then(() => {
      d.loading = false;
      if (aliveRef.current) bumpData();
    });
  }, [root]);

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

  const isPlatformOrCross = (id: string) =>
    ['netflix', 'hbo', 'disney', 'prime_paramount', 'apple_hulu', 'sports'].includes(id);

  // App categories with their counts (platform brands and sports draw from the full pool)
  const categoriesWithCounts = useMemo(() => {
    if (portalCols !== 'offline') return [];
    return VOD_CATEGORIES.map(cat => {
      const pool = isPlatformOrCross(cat.id) ? fullPool : allPool;
      const count = cat.id === 'all' ? allPool.length : pool.filter(cat.matcher).length;
      return { ...cat, count };
    }).filter(c => c.count > 0 || c.id === 'all');
  }, [portalCols, allPool, fullPool]);

  const fixedList = useMemo(() => {
    const seen = new Set<string>();
    return (fixedItems || []).filter(it => (seen.has(it.id) ? false : (seen.add(it.id), true)));
  }, [fixedItems]);

  // ---------- Sidebar entries and the one the screen opens on
  const { entries, initialIndex } = useMemo((): { entries: SideEntry[]; initialIndex: number } => {
    // Tree on its way: an empty sidebar ("…") rather than a flash of the offline categories
    if (portalCols === null) return { entries: [], initialIndex: 0 };
    if (!isPortal) {
      const list: SideEntry[] = categoriesWithCounts.map(c => ({ key: c.id, name: c.name, icon: c.icon, count: c.count }));
      const at = list.findIndex(e => e.key === wantedCat);
      return { entries: list, initialIndex: at !== -1 ? at : 0 };
    }
    const cols = portalCols as PortalColumn[];
    const list: SideEntry[] = cols.map(c => ({ key: `col-${c.id}`, name: c.name, colId: c.id }));
    const at = findInitialColumn(cols, title, initialColumn, wantedCat);
    if (at !== -1) return { entries: list, initialIndex: at };
    // A curated row with no column here keeps its own titles as the first entry
    if (fixedList.length) {
      return { entries: [{ key: FIXED_KEY, name: title, count: fixedList.length }, ...list], initialIndex: 0 };
    }
    return { entries: list, initialIndex: 0 };
  }, [isPortal, portalCols, categoriesWithCounts, fixedList, wantedCat, initialColumn, title]);

  const [catIndex, setCatIndex] = useState<number>(initialIndex);
  const [area, setArea] = useState<BrowseArea>('grid');
  const [headBtn, setHeadBtn] = useState<0 | 1>(0);
  const [gridIndex, setGridIndex] = useState<number>(0);

  // A new list of entries (the portal tree arrived) starts on its initial entry; the same list
  // recomputed by a parent render keeps the user's place
  const entriesSignature = `${entries.map(e => e.key).join('|')}#${initialIndex}`;
  useEffect(() => {
    setCatIndex(initialIndex);
    setGridIndex(0);
  }, [entriesSignature]);

  const activeEntry: SideEntry | undefined = entries[catIndex] || entries[0];
  const activeColId = activeEntry?.colId;

  // First page of the selected column, once the sidebar stops moving (again after a failed first page)
  useEffect(() => {
    if (activeColId === undefined) return;
    const d = dataRef.current[activeColId];
    if (d && !(d.error && d.total < 0)) return;
    const timer = setTimeout(() => loadNextPage(activeColId), SELECT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [activeColId, loadNextPage]);

  // Titles in the grid, and how many the category has in all (null: not known yet)
  const { gridItems, gridTotal, gridState } = useMemo(() => {
    if (!activeEntry) {
      return portalCols === null
        ? { gridItems: [] as VodItem[], gridTotal: null, gridState: 'loading' }
        : { gridItems: [] as VodItem[], gridTotal: 0, gridState: 'ready' };
    }
    if (activeEntry.key === FIXED_KEY) return { gridItems: fixedList, gridTotal: fixedList.length, gridState: 'ready' };
    if (activeEntry.colId !== undefined) {
      const d = dataRef.current[activeEntry.colId];
      if (!d || (d.total < 0 && !d.error)) return { gridItems: [] as VodItem[], gridTotal: null, gridState: 'loading' };
      if (d.total < 0 && d.error) return { gridItems: [] as VodItem[], gridTotal: 0, gridState: 'error' };
      return { gridItems: d.items, gridTotal: d.total, gridState: 'ready' };
    }
    const cat = VOD_CATEGORIES.find(c => c.id === activeEntry.key);
    if (!cat || cat.id === 'all') return { gridItems: allPool, gridTotal: allPool.length, gridState: 'ready' };
    const pool = isPlatformOrCross(cat.id) ? fullPool : allPool;
    const list = pool.filter(cat.matcher);
    return { gridItems: list, gridTotal: list.length, gridState: 'ready' };
    // dataVersion: the column data lives in a ref
  }, [activeEntry, portalCols, fixedList, allPool, fullPool, dataVersion]);

  // Next page when the focus gets near the last loaded row
  useEffect(() => {
    if (activeColId === undefined || area !== 'grid') return;
    const d = dataRef.current[activeColId];
    if (!d || d.total < 0 || d.items.length >= d.total) return;
    const focusRow = Math.floor(gridIndex / COLS);
    const loadedRows = Math.ceil(d.items.length / COLS);
    if (focusRow >= loadedRows - 3) loadNextPage(activeColId);
  }, [activeColId, area, gridIndex, dataVersion, loadNextPage]);

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
  }, [activeEntry?.key]);

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

  const selectEntry = (next: number) => {
    setCatIndex(next);
    setGridIndex(0);
  };

  // TV Remote Key Handler
  useScreenKeys(key => {
    if (key === 'back') {
      if (area === 'grid' || area === 'search') {
        setArea('cats');
      } else {
        onClose();
      }
      return;
    }

    if (area === 'cats') {
      if (key === 'up') {
        if (catIndex === 0) setArea('search');
        else selectEntry(catIndex - 1);
      } else if (key === 'down') {
        if (catIndex < entries.length - 1) selectEntry(catIndex + 1);
      } else if (key === 'right' || key === 'enter') {
        if (gridItems.length > 0) {
          setArea('grid');
          setGridIndex(0);
        }
      }
      return;
    }

    if (area === 'grid') {
      const total = gridItems.length;
      if (total === 0) {
        if (key === 'left' || key === 'up') setArea('cats');
        return;
      }
      if (key === 'left') {
        if (gridIndex % COLS === 0) setArea('cats');
        else setGridIndex(i => Math.max(0, i - 1));
      } else if (key === 'right') {
        if (gridIndex % COLS !== COLS - 1 && gridIndex + 1 < total) setGridIndex(i => i + 1);
      } else if (key === 'up') {
        if (gridIndex < COLS) setArea('cats');
        else setGridIndex(i => i - COLS);
      } else if (key === 'down') {
        // Into the last, shorter row: land on its last card
        const lastRowStart = Math.floor((total - 1) / COLS) * COLS;
        if (gridIndex + COLS < total) setGridIndex(i => i + COLS);
        else if (gridIndex < lastRowStart) setGridIndex(total - 1);
      } else if (key === 'enter') {
        const it = gridItems[gridIndex];
        if (it) {
          if (root === 'adult') {
            const marked = { ...it, restricted: true, privateContent: true, category: 'adult' };
            historyService.markPrivate(marked);
            onOpenVod(marked);
          } else {
            onOpenVod(it);
          }
        }
      }
      return;
    }

    if (area === 'search') {
      // Header buttons: Buscar (0) | Filtrar (1)
      if (key === 'down') setArea('cats');
      else if (key === 'left') setHeadBtn(0);
      else if (key === 'right' && onOpenFilter) setHeadBtn(1);
      else if (key === 'enter') {
        if (headBtn === 1 && onOpenFilter) onOpenFilter();
        else if (onOpenSearch) onOpenSearch();
      }
    }
  }, isTop && !hidden && !isSearchOpen);

  const screenTitle = title && title !== 'browse' ? title : ROOT_LABEL[root] || 'Catálogo';
  const entryName = activeEntry ? activeEntry.name : '';

  // Only the rows around the focus are in the DOM (a column can have thousands of titles); a spacer
  // keeps the rendered rows at their real place on the track
  const focusRow = Math.floor(gridIndex / COLS);
  const firstRow = Math.max(0, focusRow - ROWS_BEFORE);
  const lastRow = focusRow + ROWS_AFTER;
  const windowItems = gridItems.slice(firstRow * COLS, (lastRow + 1) * COLS);

  const entryCount = (e: SideEntry): number | undefined => {
    if (e.colId === undefined) return e.count;
    const d = dataRef.current[e.colId];
    return d && d.total >= 0 ? d.total : undefined;
  };

  return (
    <div className="browse-screen" style={hidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
      {/* Same bar as the home: title where the tabs are, this screen's actions on the right */}
      <ScreenHeader
        title={screenTitle}
        actions={[
          { id: 'search', title: 'Buscar', icon: SearchIcon, onClick: () => onOpenSearch && onOpenSearch() },
          ...(onOpenFilter ? [{ id: 'filter', title: 'Filtrar', icon: FilterIcon, onClick: onOpenFilter }] : [])
        ]}
        focusedAction={area === 'search' ? headBtn : null}
      />

      {/* Two Column Layout: Categories on Left, Grid on Right (like Live TV) */}
      <div className="browse-two-col">
        {/* Left Column: Categories List */}
        <div className="browse-col-cats">
          <div className="browse-col-header">
            <div className="live-header-lead">
              <span className="live-header-title">Categorías</span>
              <span className="live-header-sub">{portalCols === null ? 'Cargando…' : `${entries.length} categorías`}</span>
            </div>
          </div>

          <div className="browse-cat-vlist" ref={catListRef}>
            {entries.map((entry, idx) => {
              const isCur = idx === catIndex;
              const isFoc = area === 'cats' && idx === catIndex;
              const count = entryCount(entry);
              return (
                <div
                  key={entry.key}
                  className={`browse-cat-vrow ${isCur ? 'is-active-cat' : ''} ${isFoc ? 'is-focused' : ''}`}
                  onClick={() => {
                    selectEntry(idx);
                    setArea('grid');
                  }}
                >
                  <div className="browse-cat-info">
                    {entry.icon && <span className="browse-cat-icon">{entry.icon}</span>}
                    <span className="browse-cat-vname">{entry.name}</span>
                  </div>
                  {count !== undefined && <span className="browse-cat-vcount">{count}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Cards Grid */}
        <div className="browse-col-grid" ref={gridContainerRef}>
          {portalCols === null || gridState === 'loading' ? (
            <div className="browse-empty-category">
              <div className="browse-empty-icon">⏳</div>
              <div className="browse-empty-text">Cargando títulos…</div>
            </div>
          ) : gridState === 'error' ? (
            <div className="browse-empty-category">
              <div className="browse-empty-icon">⚠️</div>
              <div className="browse-empty-text">No se pudieron cargar los títulos. Elige la categoría otra vez para reintentar.</div>
            </div>
          ) : gridItems.length === 0 ? (
            <div className="browse-empty-category">
              <div className="browse-empty-icon">🎬</div>
              <div className="browse-empty-text">No hay títulos disponibles en esta categoría.</div>
            </div>
          ) : (
            <div className="browse-cards-grid-track" ref={gridTrackRef}>
              <div className="browse-cards-grid">
                {firstRow > 0 && (
                  <div style={{ gridColumn: '1 / -1', height: firstRow * ROW_HEIGHT - GAP_Y }} />
                )}
                {windowItems.map((item, i) => {
                  const idx = firstRow * COLS + i;
                  const cardRow = Math.floor(idx / COLS);
                  return (
                    <PosterCard
                      key={`${item.id}-${idx}`}
                      item={item}
                      isFocused={area === 'grid' && idx === gridIndex}
                      showImage={cardRow <= maxLoadedRow}
                      onActivate={it => {
                        if (root === 'adult') {
                          const marked = { ...it, restricted: true, privateContent: true, category: 'adult' };
                          historyService.markPrivate(marked);
                          onOpenVod(marked);
                        } else {
                          onOpenVod(it);
                        }
                      }}
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
