import { useState, useEffect, useCallback, useRef } from 'react';
import { catalogService, PortalRow } from '../services/catalogService';
import { historyService } from '../services/historyService';
import { VodItem } from '../types/vod';
import { HistoryItem } from '../types/history';
import { continueWatchingItems } from '../lib/vodResume';
import { catalogRetryDelayMs } from '../lib/catalogRetry';

type Catalog = Awaited<ReturnType<typeof catalogService.fetchCatalog>>;

/** VOD catalog lists and watch history; `onLoaded` runs once when the catalog arrives */
export function useCatalog(onLoaded?: (catalog: Catalog) => void) {
  const [catalogError, setCatalogError] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [featuredItems, setFeaturedItems] = useState<VodItem[]>([]);
  const [movieItems, setMovieItems] = useState<VodItem[]>([]);
  const [seriesItems, setSeriesItems] = useState<VodItem[]>([]);
  const [kidsItems, setKidsItems] = useState<VodItem[]>([]);
  const [animeItems, setAnimeItems] = useState<VodItem[]>([]);
  const [catalogRows, setCatalogRows] = useState<Record<string, VodItem[]>>({});
  const [portalRows, setPortalRows] = useState<Record<string, PortalRow[]>>({});
  const [heroByTab, setHeroByTab] = useState<Record<string, VodItem[]>>({});
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);

  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    // Only unfinished titles feed "Seguir viendo"; the full history stays in the profile
    setHistoryItems(continueWatchingItems(historyService.getHistory()));
    const unsubHist = historyService.subscribe(() => {
      setHistoryItems(continueWatchingItems(historyService.getHistory()));
    });

    // A failed load retries by itself: the notice stays up meanwhile and goes away when the catalog arrives
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const isMockFailure = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('test') === 'catalog-failure';
    if (isMockFailure) {
      setCatalogError(true);
      setCatalogLoading(true);
      return;
    }

    const load = () => {
      catalogService.fetchCatalog().then(catalog => {
        if (cancelled) return;
        setFeaturedItems(catalog.featured || []);
        setMovieItems(catalog.movies || []);
        setSeriesItems(catalog.series || []);
        setKidsItems(catalog.kids || []);
        setAnimeItems(catalog.anime || []);
        setCatalogRows(catalog.rowsByGroup || {});
        setPortalRows(catalog.portalRows || {});
        setHeroByTab(catalog.heroByTab || {});
        setCatalogError(false);
        setCatalogLoading(false);
        if (onLoadedRef.current) onLoadedRef.current(catalog);
      }).catch(() => {
        if (cancelled) return;
        attempt += 1;
        console.warn(`[Home:useCatalog] intento ${attempt} falló; reintento en ${Math.round(catalogRetryDelayMs(attempt) / 1000)} s${attempt >= 2 ? ', aviso de error visible' : ''}`);
        // Don't panic the user on transient initial network hiccups:
        // Keep showing the loading state and only surface the error toast after sustained failure.
        if (attempt >= 2) {
          setCatalogError(true);
        }
        // Keep skeleton visible while retrying so screen doesn't go pitch black
        setCatalogLoading(true);
        retryTimer = setTimeout(load, catalogRetryDelayMs(attempt));
      });
    };
    load();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubHist();
    };
  }, []);

  /** Catalog item for a history entry (falls back to the data stored in the history) */
  const findVod = useCallback((h: HistoryItem): VodItem => {
    return (movieItems.find(m => m.id === h.id) ||
            seriesItems.find(s => s.id === h.id) ||
            featuredItems.find(f => f.id === h.id) || {
              id: h.id,
              title: h.title,
              poster: h.poster,
              isSeries: Boolean(h.series)
            }) as VodItem;
  }, [movieItems, seriesItems, featuredItems]);

  return {
    catalogError,
    catalogLoading,
    featuredItems,
    movieItems,
    seriesItems,
    kidsItems,
    animeItems,
    catalogRows,
    portalRows,
    heroByTab,
    historyItems,
    findVod
  };
}
