import { useState, useEffect, useCallback, useRef } from 'react';
import { catalogService, PortalRow } from '../services/catalogService';
import { historyService } from '../services/historyService';
import { VodItem } from '../types/vod';
import { HistoryItem } from '../types/history';
import { continueWatchingItems } from '../lib/vodResume';

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
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);

  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    // Only unfinished titles feed "Seguir viendo"; the full history stays in the profile
    setHistoryItems(continueWatchingItems(historyService.getHistory()));
    const unsubHist = historyService.subscribe(() => {
      setHistoryItems(continueWatchingItems(historyService.getHistory()));
    });

    catalogService.fetchCatalog().then(catalog => {
      setFeaturedItems(catalog.featured || []);
      setMovieItems(catalog.movies || []);
      setSeriesItems(catalog.series || []);
      setKidsItems(catalog.kids || []);
      setAnimeItems(catalog.anime || []);
      setCatalogRows(catalog.rowsByGroup || {});
      setPortalRows(catalog.portalRows || {});
      if (onLoadedRef.current) onLoadedRef.current(catalog);
    }).catch(() => setCatalogError(true)).finally(() => setCatalogLoading(false));

    return () => {
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
    historyItems,
    findVod
  };
}
