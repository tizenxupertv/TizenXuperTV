import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { VodItem } from '../types/vod';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { PosterCard } from '../components/vod/PosterCard';
import { FilterRoot } from '../lib/screenStack';
import { FilterOptions, FilterValues, getFilterOptions, getFilteredPage } from '../services/catalogService';
import { setTrackOffset } from '../utils/scrollHelper';
import { useViewProfiler } from '../lib/perfMonitor';
import { ScreenHeader, SearchIcon } from '../components/layout/Header';

/**
 * Filter screen of the official app: Tipo / Género / Año / País / Audio over the full catalog of a
 * root (v3/filterGenre for the values, v3/filterByContent for the titles).
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

type RowKey = 'type' | keyof FilterValues;

interface FilterRow {
  key: RowKey;
  label: string;
  options: { value: string; label: string }[];
}

const NO_FILTERS: FilterValues = { tags: '', year: '', originalCountry: '', audio: '' };
const ALL = { value: '', label: 'Todos' };

const CARD_H = 250;
const GAP_Y = 16;
const ROW_HEIGHT = CARD_H + GAP_Y;
const COLS = 7;
const PAGE_SIZE = 42;
const ROWS_BEFORE = 2;
const ROWS_AFTER = 4;
/** Wait for the selection to settle before asking the portal */
const RELOAD_DEBOUNCE_MS = 250;

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
  const [area, setArea] = useState<'header' | 'filters' | 'grid'>('filters');
  const [rowIdx, setRowIdx] = useState(0);
  const [colByRow, setColByRow] = useState<number[]>([0, 0, 0, 0, 0]);
  const [gridIndex, setGridIndex] = useState(0);
  const [maxLoadedRow, setMaxLoadedRow] = useState(2);

  const pageTrackRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const chipTrackRefs = useRef<(HTMLDivElement | null)[]>([]);

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
      { key: 'type', label: 'Tipo', options: TYPES.map(t => ({ value: t.value, label: t.label })) },
      { key: 'tags', label: 'Género', options: [ALL, ...o.tags.map(t => ({ value: t, label: TAG_ES[t] || t }))] },
      { key: 'year', label: 'Año', options: [ALL, ...o.year.map(y => ({ value: y, label: y }))] },
      { key: 'originalCountry', label: 'País', options: [ALL, ...o.originalCountry.map(c => ({ value: c, label: COUNTRY_ES[c] || c }))] },
      { key: 'audio', label: 'Audio', options: [ALL, ...o.audio.map(a => ({ value: a.key, label: AUDIO_ES[a.key] || a.value }))] }
    ];
  }, [options]);

  const selectedIndex = useCallback((row: FilterRow): number => {
    const current = row.key === 'type' ? root : values[row.key];
    const at = row.options.findIndex(opt => opt.value === current);
    return at === -1 ? 0 : at;
  }, [root, values]);

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
    if (pageTrackRef.current) setTrackOffset(pageTrackRef.current, 'y', 0, false);
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

  // ---------- Scrolling: chips of the focused row, and the page when the grid has the focus
  useEffect(() => {
    if (area !== 'filters') return;
    const track = chipTrackRefs.current[rowIdx];
    const chip = track && (track.children[colByRow[rowIdx]] as HTMLElement | undefined);
    const clip = track && track.parentElement;
    if (!track || !chip || !clip) return;
    const view = clip.clientWidth;
    const right = chip.offsetLeft + chip.offsetWidth;
    const max = Math.max(0, track.scrollWidth - view);
    const current = Number(track.dataset.offset || 0);
    let next = current;
    if (right > current + view - 40) next = right - view + 120;
    else if (chip.offsetLeft < current + 40) next = chip.offsetLeft - 120;
    next = Math.min(max, Math.max(0, next));
    if (next !== current) {
      track.dataset.offset = String(next);
      setTrackOffset(track, 'x', next);
    }
  }, [area, rowIdx, colByRow]);

  useEffect(() => {
    const track = pageTrackRef.current;
    if (!track) return;
    if (area !== 'grid') {
      setTrackOffset(track, 'y', 0);
      return;
    }
    const focusRow = Math.floor(gridIndex / COLS);
    // First row under the filters; further down, the previous row stays visible on top
    const gridTop = gridRef.current ? gridRef.current.offsetTop : 0;
    setTrackOffset(track, 'y', focusRow === 0 ? 0 : gridTop + (focusRow - 1) * ROW_HEIGHT);
    setMaxLoadedRow(prev => Math.max(prev, focusRow + 2));
  }, [area, gridIndex]);

  // ---------- Remote
  const select = (row: FilterRow, value: string) => {
    if (row.key === 'type') {
      if (value === root) return;
      // Other type, other values: genre, year and country start again (audio stays)
      setRoot(value as FilterRoot);
      setValues(v => ({ ...NO_FILTERS, audio: v.audio }));
      setColByRow(cols => cols.map((c, i) => (i === 0 ? c : 0)));
      return;
    }
    const key = row.key;
    setValues(v => (v[key] === value ? v : { ...v, [key]: value }));
  };

  const focusRowAt = (next: number) => {
    setRowIdx(next);
    // A row takes the focus on its selected value
    setColByRow(cols => cols.map((c, i) => (i === next ? selectedIndex(rows[next]) : c)));
  };

  useScreenKeys(key => {
    if (key === 'back') {
      if (area !== 'filters') setArea('filters');
      else onClose();
      return;
    }

    // Header action (Buscar), above the Tipo row
    if (area === 'header') {
      if (key === 'down') setArea('filters');
      else if (key === 'enter' && onOpenSearch) onOpenSearch();
      return;
    }

    if (area === 'filters') {
      const row = rows[rowIdx];
      const col = colByRow[rowIdx];
      if (key === 'up') {
        if (rowIdx > 0) focusRowAt(rowIdx - 1);
        else if (onOpenSearch) setArea('header');
      } else if (key === 'down') {
        if (rowIdx < rows.length - 1) focusRowAt(rowIdx + 1);
        else if (results.items.length > 0) {
          setArea('grid');
          setGridIndex(0);
        }
      } else if (key === 'left') {
        if (col > 0) setColByRow(cols => cols.map((c, i) => (i === rowIdx ? c - 1 : c)));
      } else if (key === 'right') {
        if (col < row.options.length - 1) setColByRow(cols => cols.map((c, i) => (i === rowIdx ? c + 1 : c)));
      } else if (key === 'enter') {
        const opt = row.options[col];
        if (opt) select(row, opt.value);
      }
      return;
    }

    // Grid
    const total = results.items.length;
    if (key === 'left') {
      if (gridIndex % COLS !== 0) setGridIndex(i => i - 1);
    } else if (key === 'right') {
      if (gridIndex % COLS !== COLS - 1 && gridIndex + 1 < total) setGridIndex(i => i + 1);
    } else if (key === 'up') {
      if (gridIndex < COLS) setArea('filters');
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
  const firstRow = area === 'grid' ? Math.max(0, focusRow - ROWS_BEFORE) : 0;
  const lastRow = (area === 'grid' ? focusRow : 0) + ROWS_AFTER;
  const windowItems = results.items.slice(firstRow * COLS, (lastRow + 1) * COLS);
  const totalLabel = results.total < 0 ? 'Cargando…' : `${results.total.toLocaleString('es')} títulos`;

  const typeLabel = TYPES.find(t => t.value === root)?.label || '';
  const activeCount = (['tags', 'year', 'originalCountry', 'audio'] as (keyof FilterValues)[]).filter(k => values[k]).length;

  return (
    <div className="filter-screen" style={hidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
      <ScreenHeader
        title="Filtrar"
        actions={onOpenSearch ? [{ id: 'search', title: 'Buscar', icon: SearchIcon, onClick: onOpenSearch }] : []}
        focusedAction={area === 'header' ? 0 : null}
      />

      <div className="filter-page-clip">
        <div className="filter-page-track" ref={pageTrackRef}>
          <div className="filter-panel">
            {rows.map((row, r) => {
              const sel = selectedIndex(row);
              return (
                <div key={row.key} className="filter-row">
                  <div className="filter-row-label">{row.label}:</div>
                  <div className="filter-chips-clip">
                    <div className="filter-chips" ref={el => { chipTrackRefs.current[r] = el; }}>
                      {row.options.map((opt, c) => (
                        <div
                          key={opt.value || 'all'}
                          className={`filter-chip ${c === sel ? 'is-selected' : ''} ${row.key === 'type' ? 'is-type' : ''} ${
                            area === 'filters' && r === rowIdx && c === colByRow[r] ? 'is-focused' : ''
                          }`}
                          onClick={() => select(row, opt.value)}
                        >
                          {opt.label}
                        </div>
                      ))}
                      {row.key !== 'type' && !options && <div className="filter-chip is-loading">…</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="filter-results-head">
            <span className="filter-results-type">{typeLabel}</span>
            <span>{totalLabel}</span>
            {activeCount > 0 && <span className="filter-results-active">{activeCount} {activeCount === 1 ? 'filtro activo' : 'filtros activos'}</span>}
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
          ) : (
            <div className="browse-cards-grid filter-grid" ref={gridRef}>
              {firstRow > 0 && <div style={{ gridColumn: '1 / -1', height: firstRow * ROW_HEIGHT - GAP_Y }} />}
              {windowItems.map((item, i) => {
                const idx = firstRow * COLS + i;
                return (
                  <PosterCard
                    key={`${item.id}-${idx}`}
                    item={item}
                    isFocused={area === 'grid' && idx === gridIndex}
                    showImage={Math.floor(idx / COLS) <= maxLoadedRow}
                    onActivate={onOpenVod}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
