import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { VodItem } from '../types/vod';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { FilterRoot } from '../lib/screenStack';
import { FilterOptions, FilterValues, getFilterOptions, getFilteredPage } from '../services/catalogService';
import { setTrackOffset } from '../utils/scrollHelper';
import { useViewProfiler } from '../lib/perfMonitor';
import { ScreenHeader, SearchIcon } from '../components/layout/Header';
import { cardMeta } from '../components/search/SearchModal';

/**
 * Filter screen of the official app: Tipo / Género / Año / País / Audio over the full catalog of a
 * root (v3/filterGenre for the values, v3/filterByContent for the titles).
 *
 * Layout: the type as pills on top, the other filters as a vertical menu on the left (OK opens that filter's
 * options as a vertical list, like the ⚙ of the detail and Perfil), and the titles taking the rest of the screen.
 */

const TYPES: { value: FilterRoot; label: string }[] = [
  { value: 'movies', label: 'Película' },
  { value: 'series', label: 'Series' },
  { value: 'kids', label: 'Kids' },
  { value: 'anime', label: 'Anime' }
];

// The portal sends the values in English
const TAG_ES: Record<string, string> = {
  Action: 'Acción', Drama: 'Drama', Adventure: 'Aventuras', Crime: 'Crimen', 'Sci-Fi': 'Ciencia ficción',
  Cartoon: 'Dibujos animados', Comedy: 'Comedia', Romance: 'Romántico', Animation: 'Animación', Family: 'Familia',
  Fantasy: 'Fantasía', Thriller: 'Suspenso', Horror: 'Terror', History: 'Historia', Mystery: 'Misterio',
  Documentary: 'Documental', 'Reality-TV': 'Reality', Short: 'Cortometraje', War: 'Bélica', Western: 'Western',
  Biography: 'Biografía', Music: 'Música', Sport: 'Deportes', 'Game Shows': 'Concursos'
};

const COUNTRY_ES: Record<string, string> = {
  Brazil: 'Brasil', Portugal: 'Portugal', 'United States': 'Estados Unidos', Mexico: 'México',
  'United Kingdom': 'Reino Unido', Japan: 'Japón', 'South Korea': 'Corea del Sur', Spain: 'España',
  Germany: 'Alemania', India: 'India', Kuwait: 'Kuwait', Other: 'Otros'
};

const AUDIO_ES: Record<string, string> = { por: 'Portugués', spa: 'Español', eng: 'Inglés' };

type FilterKey = keyof FilterValues;

interface FilterRow {
  key: FilterKey;
  label: string;
  options: { value: string; label: string }[];
}

const NO_FILTERS: FilterValues = { tags: '', year: '', originalCountry: '', audio: '' };
const ALL = { value: '', label: 'Todos' };

/** Same card as Buscar (poster, then title and year · genre); its height is fixed so the rows keep one pitch */
const CARD_H = 384;
const GAP_Y = 16;
const ROW_HEIGHT = CARD_H + GAP_Y;
const COLS = 6;
const PAGE_SIZE = 42;
const ROWS_BEFORE = 2;
const ROWS_AFTER = 4;
/** Wait for the selection to settle before asking the portal */
const RELOAD_DEBOUNCE_MS = 250;
/** Options list: height of one option and how many fit before it scrolls */
const OPTION_H = 52;
const OPTIONS_VISIBLE = 10;

interface Results {
  items: VodItem[];
  /** -1 until the first page arrives */
  total: number;
  pages: number;
  loading: boolean;
  error: boolean;
}

const EMPTY_RESULTS: Results = { items: [], total: -1, pages: 0, loading: true, error: false };

interface FilterScreenProps {
  isTop: boolean;
  /** Hidden (and inactive) while a detail opened from here is on screen */
  hidden: boolean;
  isSearchOpen?: boolean;
  initialRoot: FilterRoot;
  onClose: () => void;
  onOpenVod: (item: VodItem) => void;
  onOpenSearch?: () => void;
}

export const FilterScreen: React.FC<FilterScreenProps> = ({
  isTop,
  hidden,
  isSearchOpen = false,
  initialRoot,
  onClose,
  onOpenVod,
  onOpenSearch
}) => {
  useViewProfiler('Filtros');
  const [root, setRoot] = useState<FilterRoot>(initialRoot);
  const [values, setValues] = useState<FilterValues>(NO_FILTERS);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [results, setResults] = useState<Results>(EMPTY_RESULTS);
  const [area, setArea] = useState<'header' | 'type' | 'side' | 'grid'>('side');
  const [typeCol, setTypeCol] = useState(Math.max(0, TYPES.findIndex(t => t.value === initialRoot)));
  // Left menu: the list of filters, or the options of one of them
  const [sideMode, setSideMode] = useState<'menu' | 'options'>('menu');
  const [sideRow, setSideRow] = useState(0);
  const [optIdx, setOptIdx] = useState(0);
  const [gridIndex, setGridIndex] = useState(0);
  const [maxLoadedRow, setMaxLoadedRow] = useState(2);

  const gridTrackRef = useRef<HTMLDivElement>(null);
  const optionsTrackRef = useRef<HTMLDivElement>(null);

  // ---------- Values of the selected type
  useEffect(() => {
    let alive = true;
    setOptions(null);
    getFilterOptions(root).then(
      opts => { if (alive) setOptions(opts); },
      () => { if (alive) setOptions({ tags: [], year: [], originalCountry: [], audio: [] }); }
    );
    return () => { alive = false; };
  }, [root]);

  const rows: FilterRow[] = useMemo(() => {
    const o = options || { tags: [], year: [], originalCountry: [], audio: [] };
    return [
      { key: 'tags', label: 'Género', options: [ALL, ...o.tags.map(t => ({ value: t, label: TAG_ES[t] || t }))] },
      { key: 'year', label: 'Año', options: [ALL, ...o.year.map(y => ({ value: y, label: y }))] },
      { key: 'originalCountry', label: 'País', options: [ALL, ...o.originalCountry.map(c => ({ value: c, label: COUNTRY_ES[c] || c }))] },
      { key: 'audio', label: 'Audio', options: [ALL, ...o.audio.map(a => ({ value: a.key, label: AUDIO_ES[a.key] || a.value }))] }
    ];
  }, [options]);

  const selectedIndex = useCallback((row: FilterRow): number => {
    const at = row.options.findIndex(opt => opt.value === values[row.key]);
    return at === -1 ? 0 : at;
  }, [values]);

  const activeFilters = rows.filter(r => values[r.key]);
  const activeCount = activeFilters.length;
  // The menu: the four filters, plus "Limpiar filtros" while any is on
  const menuCount = rows.length + (activeCount > 0 ? 1 : 0);

  // ---------- Titles for the selection, page by page
  const tokenRef = useRef(0);
  const loadPage = useCallback((page: number, base: Results) => {
    const token = tokenRef.current;
    getFilteredPage(root, values, page, PAGE_SIZE).then(
      res => {
        if (token !== tokenRef.current) return;
        const items = base.items.concat(res.items);
        // An empty page ends the list even if the total says otherwise
        const total = res.items.length ? Math.max(res.total, items.length) : items.length;
        setResults({ items, total, pages: page, loading: false, error: false });
      },
      () => {
        if (token !== tokenRef.current) return;
        setResults({ ...base, loading: false, error: true });
      }
    );
  }, [root, values]);

  useEffect(() => {
    tokenRef.current++;
    setResults(EMPTY_RESULTS);
    setGridIndex(0);
    setMaxLoadedRow(2);
    if (gridTrackRef.current) setTrackOffset(gridTrackRef.current, 'y', 0, false);
    const timer = setTimeout(() => loadPage(1, { ...EMPTY_RESULTS, total: 0 }), RELOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [loadPage]);

  // Next page when the focus gets near the last loaded row
  useEffect(() => {
    if (area !== 'grid' || results.loading || results.error || results.items.length >= results.total) return;
    const focusRow = Math.floor(gridIndex / COLS);
    if (focusRow >= Math.ceil(results.items.length / COLS) - 3) {
      setResults(r => ({ ...r, loading: true }));
      loadPage(results.pages + 1, results);
    }
  }, [area, gridIndex, results, loadPage]);

  // ---------- Scrolling: the grid keeps the previous row in view; a long options list follows its focus
  useEffect(() => {
    const track = gridTrackRef.current;
    if (!track || area !== 'grid') return;
    const focusRow = Math.floor(gridIndex / COLS);
    setTrackOffset(track, 'y', focusRow === 0 ? 0 : (focusRow - 1) * ROW_HEIGHT);
    setMaxLoadedRow(prev => Math.max(prev, focusRow + 2));
  }, [area, gridIndex]);

  const optionsRow = rows[sideRow];
  const optionsLength = optionsRow ? optionsRow.options.length : 0;
  useEffect(() => {
    const track = optionsTrackRef.current;
    if (!track || sideMode !== 'options') return;
    const max = Math.max(0, optionsLength - OPTIONS_VISIBLE);
    const first = Math.min(max, Math.max(0, optIdx - Math.floor(OPTIONS_VISIBLE / 2)));
    setTrackOffset(track, 'y', first * OPTION_H, false);
  }, [sideMode, optIdx, optionsLength, sideRow]);

  // ---------- Remote
  const selectType = (value: FilterRoot) => {
    if (value === root) return;
    // Other type, other values: genre, year and country start again (audio stays)
    setRoot(value);
    setValues(v => ({ ...NO_FILTERS, audio: v.audio }));
  };

  const selectValue = (row: FilterRow, value: string) => {
    const key = row.key;
    setValues(v => (v[key] === value ? v : { ...v, [key]: value }));
  };

  useScreenKeys(key => {
    if (key === 'back') {
      if (area === 'grid') setArea('side');
      else if (area === 'side' && sideMode === 'options') setSideMode('menu');
      else onClose();
      return;
    }

    // Header action (Buscar), above the types
    if (area === 'header') {
      if (key === 'down') setArea('type');
      else if (key === 'enter' && onOpenSearch) onOpenSearch();
      return;
    }

    // Types: pills in a row
    if (area === 'type') {
      if (key === 'left') setTypeCol(c => Math.max(0, c - 1));
      else if (key === 'right') setTypeCol(c => Math.min(TYPES.length - 1, c + 1));
      else if (key === 'up') { if (onOpenSearch) setArea('header'); }
      else if (key === 'down') setArea('side');
      else if (key === 'enter') selectType(TYPES[typeCol].value);
      return;
    }

    // Left menu
    if (area === 'side') {
      if (sideMode === 'menu') {
        if (key === 'up') {
          if (sideRow > 0) setSideRow(r => r - 1);
          else { setTypeCol(Math.max(0, TYPES.findIndex(t => t.value === root))); setArea('type'); }
        } else if (key === 'down') {
          setSideRow(r => Math.min(menuCount - 1, r + 1));
        } else if (key === 'right') {
          if (results.items.length > 0) setArea('grid');
        } else if (key === 'enter') {
          if (sideRow >= rows.length) {
            setValues(NO_FILTERS);
            setSideRow(0);
          } else {
            setOptIdx(selectedIndex(rows[sideRow]));
            setSideMode('options');
          }
        }
        return;
      }
      // The options of one filter
      const row = rows[sideRow];
      if (!row) return;
      if (key === 'up') setOptIdx(i => Math.max(0, i - 1));
      else if (key === 'down') setOptIdx(i => Math.min(row.options.length - 1, i + 1));
      else if (key === 'left') setSideMode('menu');
      else if (key === 'enter') {
        const opt = row.options[optIdx];
        if (opt) selectValue(row, opt.value);
        setSideMode('menu');
      }
      return;
    }

    // Grid
    const total = results.items.length;
    if (key === 'left') {
      if (gridIndex % COLS !== 0) setGridIndex(i => i - 1);
      else setArea('side');
    } else if (key === 'right') {
      if (gridIndex % COLS !== COLS - 1 && gridIndex + 1 < total) setGridIndex(i => i + 1);
    } else if (key === 'up') {
      if (gridIndex < COLS) { setTypeCol(Math.max(0, TYPES.findIndex(t => t.value === root))); setArea('type'); }
      else setGridIndex(i => i - COLS);
    } else if (key === 'down') {
      const lastRowStart = Math.floor((total - 1) / COLS) * COLS;
      if (gridIndex + COLS < total) setGridIndex(i => i + COLS);
      else if (gridIndex < lastRowStart) setGridIndex(total - 1);
    } else if (key === 'enter') {
      const it = results.items[gridIndex];
      if (it) onOpenVod(it);
    }
  }, isTop && !hidden && !isSearchOpen);

  // Only the rows around the focus are in the DOM; a spacer keeps them at their real place
  const focusRow = Math.floor(gridIndex / COLS);
  const firstRow = Math.max(0, focusRow - ROWS_BEFORE);
  const lastRow = focusRow + ROWS_AFTER;
  const windowItems = results.items.slice(firstRow * COLS, (lastRow + 1) * COLS);
  const totalLabel = results.total < 0 ? 'Cargando…' : `${results.total.toLocaleString('es')} títulos`;
  const typeLabel = TYPES.find(t => t.value === root)?.label || '';

  return (
    <div className="filter-screen" style={hidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
      <ScreenHeader
        title="Filtrar"
        actions={onOpenSearch ? [{ id: 'search', title: 'Buscar', icon: SearchIcon, onClick: onOpenSearch }] : []}
        focusedAction={area === 'header' ? 0 : null}
      />

      <div className="filter-types">
        {TYPES.map((t, c) => (
          <div
            key={t.value}
            className={`filter-type ${t.value === root ? 'is-selected' : ''} ${area === 'type' && c === typeCol ? 'is-focused' : ''}`}
            onClick={() => selectType(t.value)}
          >
            {t.label}
          </div>
        ))}
      </div>

      <div className="filter-body">
        <div className="filter-side">
          {sideMode === 'menu' ? (
            <>
              {rows.map((row, r) => (
                <div
                  key={row.key}
                  className={`filter-side-row ${area === 'side' && sideRow === r ? 'is-focused' : ''}`}
                  onClick={() => { setArea('side'); setSideRow(r); setOptIdx(selectedIndex(row)); setSideMode('options'); }}
                >
                  <span className="filter-side-label">{row.label}</span>
                  <span className={`filter-side-value ${values[row.key] ? 'is-set' : ''}`}>{row.options[selectedIndex(row)]?.label}</span>
                  <span className="filter-side-chevron">›</span>
                </div>
              ))}
              {activeCount > 0 && (
                <div
                  className={`filter-side-row is-clear ${area === 'side' && sideRow === rows.length ? 'is-focused' : ''}`}
                  onClick={() => setValues(NO_FILTERS)}
                >
                  <span className="filter-side-label">Limpiar filtros</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="filter-side-head">‹ {optionsRow ? optionsRow.label : ''}</div>
              <div className="filter-options-clip" style={{ maxHeight: OPTIONS_VISIBLE * OPTION_H }}>
                <div className="filter-options-track" ref={optionsTrackRef}>
                  {optionsRow && optionsRow.options.map((opt, o) => {
                    const chosen = opt.value === values[optionsRow.key];
                    return (
                      <div
                        key={opt.value || 'all'}
                        className={`filter-option ${chosen ? 'is-chosen' : ''} ${o === optIdx ? 'is-focused' : ''}`}
                        style={{ height: OPTION_H }}
                        onClick={() => { selectValue(optionsRow, opt.value); setSideMode('menu'); }}
                      >
                        <span>{opt.label}</span>
                        {chosen && <span className="filter-option-check">✓</span>}
                      </div>
                    );
                  })}
                  {!options && <div className="filter-option is-loading" style={{ height: OPTION_H }}>Cargando…</div>}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="filter-main">
          <div className="filter-results-head">
            <span className="filter-results-type">{typeLabel}</span>
            <span>{totalLabel}</span>
            {activeFilters.map(r => (
              <span key={r.key} className="filter-active-chip">{r.options[selectedIndex(r)]?.label}</span>
            ))}
          </div>

          {results.error && results.items.length === 0 ? (
            <div className="browse-empty-category">
              <div className="browse-empty-icon">⚠️</div>
              <div className="browse-empty-text">No se pudieron cargar los títulos. Cambia un filtro para reintentar.</div>
            </div>
          ) : results.total === 0 ? (
            <div className="browse-empty-category">
              <div className="browse-empty-icon">🎬</div>
              <div className="browse-empty-text">No hay títulos con estos filtros.</div>
            </div>
          ) : results.total < 0 ? (
            // First page on its way: cards of the same size, so the layout does not jump when the titles arrive
            <div className="filter-grid-clip">
              <div className="browse-cards-grid filter-grid">
                {Array.from({ length: COLS * 3 }, (_, i) => (
                  <div key={i} className="filter-skeleton skeleton-shimmer" />
                ))}
              </div>
            </div>
          ) : (
            <div className="filter-grid-clip">
              <div className="browse-cards-grid filter-grid" ref={gridTrackRef}>
                {firstRow > 0 && <div style={{ gridColumn: '1 / -1', height: firstRow * ROW_HEIGHT - GAP_Y }} />}
                {windowItems.map((item, i) => {
                  const idx = firstRow * COLS + i;
                  return (
                    <div
                      key={`${item.id}-${idx}`}
                      className={`search-vod-card ${area === 'grid' && idx === gridIndex ? 'is-focused' : ''}`}
                      onClick={() => onOpenVod(item)}
                    >
                      <div className="svc-poster-wrap">
                        {Math.floor(idx / COLS) <= maxLoadedRow && (
                          <img
                            className="svc-poster"
                            src={item.poster || 'assets/placeholder_vertical.png'}
                            alt={item.title}
                            onError={e => {
                              (e.target as HTMLImageElement).src = 'assets/placeholder_vertical.png';
                            }}
                          />
                        )}
                        <div className="poster-bottom-vignette">
                          <div className="poster-vignette-title">{item.title || 'Sin título'}</div>
                          <div className="poster-vignette-genre">{cardMeta(item)}</div>
                        </div>
                      </div>
                    </div>
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
