import type { VodItem, VodEpisode, VodSeason, PersonDetail, PersonResult } from '../types/vod';
import { SeriesCollector, isAdultItem, belongsToSection, parseSeason } from '../lib/catalogOrganizer.ts';
import { formatDuration } from '../lib/vodResume.ts';
import { collectPosterAlternates } from '../lib/searchArtwork.ts';
import { getCachedTitleMeta, setCachedTitleMeta } from '../lib/titleMetaCache.ts';
import { historyService } from './historyService.ts';
import { catalogProvider } from './catalogProvider.ts';

declare global {
  interface Window {
    MagisClient?: any;
    __xuperCatalogCache?: any;
    XUPERTV_PORTAL?: {
      generatedAt?: string;
      source?: string;
      roots?: Record<string, any>;
      items: any[];
    };
    XUPERTV_CATALOG?: {
      source?: string;
      items: any[];
    };
  }
}

/** One home row of a portal root, as getNextColumns sends it (e.g. "Horror", "Netflix Series") */
export interface PortalRow {
  name: string;
  items: VodItem[];
}

function normalizeItem(raw: any, index: number): VodItem {
  if (!raw) return { id: `item-${index}`, title: 'Sin título' };
  // Collection tile: no score, year or synopsis defaults (it is a column, not a title)
  if (raw.collectionId) {
    return {
      id: String(raw.id),
      title: String(raw.title || raw.name || ''),
      category: raw.category || '',
      kind: 'coleccion',
      genres: Array.isArray(raw.genres) ? raw.genres : ['Colección'],
      poster: raw.poster || 'assets/placeholder_vertical.png',
      landscape: raw.landscape || raw.poster || '',
      backdrop: raw.backdrop || raw.poster || '',
      row: String(raw.row || ''),
      collectionId: Number(raw.collectionId)
    };
  }

  const id = String(raw.id || raw.contentId || raw.vodId || raw.programId || raw.program_id || `item-${index}`);
  const title = String(raw.title || raw.name || raw.programName || raw.programTitle || 'Sin título');
  // Only what the portal sends: no made-up score, year, duration or genre when a field is missing
  const score = raw.score || raw.vote_average || raw.rating || raw.movieRate || raw.programScore || '';
  const year = String(raw.year || raw.release_year || raw.programYear || (raw.releaseDate || '').slice(0, 4) || '');
  const duration = raw.duration || raw.runtime || raw.runtimeMinutes || '';
  
  let genres: string[] = [];
  if (Array.isArray(raw.genres)) genres = raw.genres;
  else if (typeof raw.genres === 'string') genres = raw.genres.split(',');
  else if (typeof raw.genre === 'string') genres = raw.genre.split(',');

  const synopsis = raw.synopsis || raw.overview || raw.description || raw.programUpdateContent || '';
  const posterAlternates = collectPosterAlternates(
    raw.icon,
    raw.iconUrl,
    raw.posterUrl,
    raw.poster_url,
    raw.poster,
    raw.posterAlternates,
    raw.image,
    raw.imageUrl,
    raw.cover,
    raw.landscapeUrl,
    raw.landscape_url,
    raw.landscape,
    raw.wideImage,
    raw.bannerImage,
    raw.backdropUrl,
    raw.backdrop_url,
    raw.backdrop
  );
  const poster = posterAlternates[0] || raw.posterUrl || raw.poster_url || raw.poster || raw.image || raw.imageUrl || raw.cover || 'assets/placeholder_vertical.png';
  const landscape = raw.landscapeUrl || raw.landscape_url || raw.landscape || raw.wideImage || raw.bannerImage || poster;
  const backdrop = raw.backdropUrl || raw.backdrop_url || raw.backdrop || landscape;
  const isRestricted = Boolean(
    raw.restricted === true ||
    raw.restricted === '1' ||
    raw.privateContent === true ||
    raw.isAdult === true ||
    raw.category === 'adult' ||
    String(raw.columnId || '') === '76300'
  );

  const rowName = String(raw.row || '');
  const explicitMovie =
    raw.kind === 'película' ||
    raw.kind === 'pelicula' ||
    raw.type === 'movie' ||
    raw.type === 'film' ||
    raw.category === 'pelicula';
  const isSeries = !!(
    raw.type === 'teleplay' || raw.type === 'series' || raw.kind === 'serie' ||
    (raw.category && raw.category.indexOf('serie') !== -1) ||
    (raw.episodes && raw.episodes.length > 0) ||
    (raw.seasons && raw.seasons.length > 0) ||
    (!explicitMovie && (rowName.includes('Series') || rowName.includes('Dramas') || rowName.includes('Telenovelas')))
  );

  return {
    id,
    title,
    category: isRestricted && !raw.category ? 'adult' : (raw.category || ''),
    kind: isSeries ? 'serie' : (raw.kind || 'pelicula'),
    score: String(score),
    year: String(year),
    duration: formatDuration(duration) || (typeof duration === 'number' ? `${Math.floor(duration/60)} h ${duration%60} min` : String(duration)),
    genres,
    director: raw.director || '—',
    actors: raw.actors || raw.actorDisplay || raw.cast || '—',
    tagline: raw.tagline || raw.viewPoint || undefined,
    synopsis,
    poster,
    posterAlternates,
    landscape,
    backdrop,
    isSeries,
    restricted: isRestricted || undefined,
    privateContent: isRestricted || undefined,
    row: rowName,
    streamUrl: raw.streamUrl || raw.stream_url || '',
    trailerUrl: raw.trailerUrl || raw.trailer_url || raw.trailer || raw.previewUrl || raw.preview_url || undefined,
    quality: raw.quality || raw.definition || undefined,
    qualities: Array.isArray(raw.qualities) ? raw.qualities : (raw.quality ? String(raw.quality).split(',') : undefined),
    volumeCount: raw.volumeCount !== undefined ? Number(raw.volumeCount) : (raw.volumnCount !== undefined ? Number(raw.volumnCount) : undefined),
    updateCount: raw.updateCount !== undefined ? Number(raw.updateCount) : undefined,
    moreAudio: raw.moreAudio !== undefined ? Number(raw.moreAudio) : undefined,
    moreSubtitle: raw.moreSubtitle !== undefined ? Number(raw.moreSubtitle) : undefined,
    seasons: raw.seasons || [],
    episodes: raw.episodes || []
  };
}

/** "01:00:00" / "3600" / "45" -> "60 min" / "45 min" */
function formatEpisodeDuration(raw: any): string {
  const v = String(raw || '').trim();
  if (!v) return '';
  const parts = v.split(':').map(n => parseInt(n, 10));
  if (parts.length >= 2 && parts.every(n => !isNaN(n))) {
    const secs = parts.reduce((acc, n) => acc * 60 + n, 0);
    return `${Math.max(1, Math.round(secs / 60))} min`;
  }
  const n = parseInt(v, 10);
  if (isNaN(n)) return v;
  return `${n > 600 ? Math.round(n / 60) : n} min`; // large values are seconds
}

const LIVE_ROOTS = ['featured', 'movies', 'series', 'kids', 'anime', 'free', 'explorar'];
let liveInFlight: Promise<any[]> | null = null;

// The TV needs a catalog session (up to 12 s) before the portal roots: 8 s cut cold starts off and showed the snapshot
const CATALOG_WAIT_MS = 25000;

function waitForCatalogRequest<T>(request: Promise<T>, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), CATALOG_WAIT_MS);
    const finish = (result: T) => {
      clearTimeout(timer);
      resolve(result);
    };
    request.then(finish, () => finish(fallback));
  });
}

function homeRoot(root: string, low: boolean): Promise<any[]> {
  return catalogProvider.home(root, 1, { low }).then(res => res.items || []);
}

function fetchCompositeHome(): Promise<any[]> {
  return catalogProvider.compositeHome().then((res: any) => {
      if (!res) return [];
      const items: any[] = [];
      const blocks = res.homeBlockList || res.blockBeanList || res.shelveList || [];
      for (const b of blocks) {
        const assets = b.shelveAssetList || b.assetList || b.dataList || [];
        for (const a of assets) {
          if (a && (a.contentId || a.id)) items.push(a);
        }
      }
      return items;
    }).catch(() => []);
}

function fetchLiveCatalog(): Promise<any[]> {
  if (liveInFlight) return liveInFlight;
  const t0 = Date.now();
  const roots = waitForCatalogRequest<(any[] | null)[]>(Promise.all([
    ...LIVE_ROOTS.map(root => homeRoot(root, false).catch(() => null)),
    fetchCompositeHome()
  ]), []);
  liveInFlight = roots.then(lists => {
    const items = ([] as any[]).concat(...lists.map(l => l || []));
    const failed = lists.filter(l => l === null).length;
    console.log(`[catalog] live catalog: ${items.length} items in ${Date.now() - t0} ms${failed ? `, ${failed} roots failed` : ''}`);
    if (items.length < 100) throw new Error(`live catalog too small (${items.length})`);
    return items;
  });
  liveInFlight.then(() => { liveInFlight = null; }, () => { liveInFlight = null; });
  return liveInFlight;
}

const TAB_RECOMMEND_MAP: { tab: string; root: string }[] = [
  { tab: 'destacados', root: 'featured' },
  { tab: 'peliculas', root: 'movies' },
  { tab: 'series', root: 'series' },
  { tab: 'kids', root: 'kids' },
  { tab: 'anime', root: 'anime' },
  { tab: 'explorar', root: 'explorar' }
];

async function fetchTabRecommends(): Promise<Record<string, VodItem[]>> {
  if (!catalogProvider.recommends) return {};
  const result: Record<string, VodItem[]> = {};
  await Promise.all(
    TAB_RECOMMEND_MAP.map(({ tab, root }) =>
      catalogProvider.recommends!(root)
        .then(rawList => {
          if (Array.isArray(rawList) && rawList.length > 0) {
            result[tab] = rawList.map((raw, idx) => normalizeItem(raw, idx));
          }
        })
        .catch(() => {})
    )
  );
  return result;
}

class CatalogService {
  private cache: {
    featured: VodItem[];
    movies: VodItem[];
    series: VodItem[];
    kids: VodItem[];
    anime: VodItem[];
    rowsByGroup: Record<string, VodItem[]>;
    portalRows: Record<string, PortalRow[]>;
    heroByTab: Record<string, VodItem[]>;
  } | null = null;

  public getCachedCatalog() {
    return this.cache;
  }

  public async fetchCatalog(): Promise<{
    featured: VodItem[];
    movies: VodItem[];
    series: VodItem[];
    kids: VodItem[];
    anime: VodItem[];
    rowsByGroup: Record<string, VodItem[]>;
    portalRows: Record<string, PortalRow[]>;
    heroByTab: Record<string, VodItem[]>;
  }> {
    if (this.cache) return this.cache;

    const [items, heroByTab] = await Promise.all([
      fetchLiveCatalog(),
      waitForCatalogRequest(fetchTabRecommends(), {})
    ]);
    return this.categorize(items.map((item, index) => normalizeItem(item, index)), heroByTab);
  }

  private categorize(rawItems: VodItem[], heroByTab: Record<string, VodItem[]> = {}) {
    // 1. Group series seasons and filter adult content. On the way, keep the portal's rows per root
    //    (getNextColumns): the same rows, names and order as the official app's tabs.
    const collector = new SeriesCollector();
    const items: VodItem[] = [];
    const portalRows: Record<string, PortalRow[]> = {};
    const rowIndex: Record<string, PortalRow> = {};
    for (const raw of rawItems) {
      if (!raw || isAdultItem(raw)) continue;
      // Collection tiles only live in their portal row (not in the title lists, hero or search)
      const isCollection = !!raw.collectionId;
      const { item: grouped, isFresh } = isCollection ? { item: raw, isFresh: false } : collector.add(raw);
      if (isFresh) items.push(grouped);
      const root = (raw.category || '').split(',')[0].trim();
      if (!root || !raw.row) continue;
      const key = `${root}\u0000${raw.row}`;
      let row = rowIndex[key];
      if (!row) {
        row = rowIndex[key] = { name: raw.row, items: [] };
        (portalRows[root] || (portalRows[root] = [])).push(row);
      }
      // Seasons of a series share one entry, so a row never shows the same series twice
      if (row.items.indexOf(grouped) === -1) row.items.push(grouped);
    }

    const featured: VodItem[] = [];
    const movies: VodItem[] = [];
    const series: VodItem[] = [];
    const kids: VodItem[] = [];
    const anime: VodItem[] = [];
    const rowsByGroup: Record<string, VodItem[]> = {};

    for (const item of items) {
      if (item.row) {
        if (!rowsByGroup[item.row]) rowsByGroup[item.row] = [];
        rowsByGroup[item.row].push(item);
      }

      if (belongsToSection(item, 'featured')) {
        featured.push(item);
      }

      if (belongsToSection(item, 'series')) {
        series.push(item);
      } else if (belongsToSection(item, 'movies')) {
        movies.push(item);
      }

      if (belongsToSection(item, 'kids')) {
        kids.push(item);
      }
      if (belongsToSection(item, 'anime')) {
        anime.push(item);
      }
    }

    this.cache = {
      featured: featured.length >= 4 ? featured : items.slice(0, 30),
      movies: movies.length >= 4 ? movies : items.slice(0, 50),
      series: series.length >= 4 ? series : items.slice(0, 50),
      kids: kids.length >= 4 ? kids : items.slice(0, 30),
      anime: anime.length >= 4 ? anime : items.slice(0, 30),
      rowsByGroup,
      portalRows,
      heroByTab
    };

    return this.cache;
  }

  public async getVodDetail(item: VodItem): Promise<{
    item: VodItem;
    episodes: VodEpisode[];
    seasons: VodSeason[];
  }> {
    if (!item) {
      throw new Error('Item required');
    }

    // 1. If MagisClient is available on TV (with 1200ms timeout protection)
    if (window.MagisClient && typeof window.MagisClient.detail === 'function') {
      try {
        const timeoutPromise = new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error('Detail request timeout')), 15000)
        );

        const fetchPromise = new Promise<any>((resolve, reject) => {
          try {
            window.MagisClient.detail(item.id, (err: any, data: any) => {
              if (err) return reject(err);
              resolve(data);
            });
          } catch (err) {
            reject(err);
          }
        });

        const res = await Promise.race([fetchPromise, timeoutPromise]);

        if (res && res.item) {
          const detailItem = normalizeItem(res.item, 0);
          if (!detailItem.backdrop && item.backdrop) detailItem.backdrop = item.backdrop;
          if (!detailItem.poster && item.poster) detailItem.poster = item.poster;
          if (!detailItem.landscape && item.landscape) detailItem.landscape = item.landscape;
          detailItem.posterAlternates = collectPosterAlternates(
            detailItem.poster,
            detailItem.posterAlternates,
            item.poster,
            item.posterAlternates,
            detailItem.landscape,
            item.landscape,
            detailItem.backdrop,
            item.backdrop
          );
          if (item.restricted || item.privateContent || item.category === 'adult') {
            detailItem.restricted = true;
            detailItem.privateContent = true;
            if (!detailItem.category) detailItem.category = 'adult';
          }
          const rawTrailer = res.item?.trailerUrl || res.item?.trailer_url || res.item?.trailer || res.trailerUrl || res.trailer || res.trailer_url || res.previewUrl || '';
          if (rawTrailer) detailItem.trailerUrl = String(rawTrailer);
          if (res.item?.duration) detailItem.duration = formatDuration(res.item.duration) || detailItem.duration;
          if (res.item?.qualities) detailItem.qualities = res.item.qualities;
          if (res.item?.quality) detailItem.quality = res.item.quality;

          const episodes: VodEpisode[] = (res.episodes || []).map((ep: any, idx: number) => ({
            id: String(ep.id || ep.contentId || idx + 1),
            title: ep.title || ep.name || `Capítulo ${idx + 1}`,
            name: ep.title || ep.name || `Capítulo ${idx + 1}`,
            number: ep.number || idx + 1,
            duration: formatEpisodeDuration(ep.duration),
            quality: ep.quality || 'HD',
            qualities: ep.qualities,
            streamUrl: ep.streamUrl || '',
            picture: ep.picture || ep.pic || ep.image || ep.cover || item.landscape || item.backdrop || item.poster || '',
            description: ep.description || ep.desc || ep.synopsis || 'Sin descripción disponible para este episodio.'
          }));

          const rawSeasons: any[] = res.seasons || [];
          const itemSeasons: VodSeason[] = item.seasons || [];

          // Build clean, deduplicated list of seasons
          const seenNumbers = new Set<number>();
          const seenIds = new Set<string>();
          const cleanedSeasons: VodSeason[] = [];

          const addSeason = (candidate: { id: string; name?: string; number?: number }) => {
            const sid = String(candidate.id || '').trim();
            if (!sid || seenIds.has(sid)) return;

            let snum = candidate.number ? Number(candidate.number) : 0;
            let sname = (candidate.name || '').trim();

            if (!snum && sname) {
              const p = parseSeason(sname);
              if (p.number) snum = p.number;
            }

            if (!snum) {
              let nextNum = 1;
              while (seenNumbers.has(nextNum)) nextNum++;
              snum = nextNum;
            }

            if (seenNumbers.has(snum)) {
              // Duplicate season number (e.g. duplicate Season 1 entry in portal)
              if (sid === String(item.id)) {
                const existingIdx = cleanedSeasons.findIndex(x => x.number === snum);
                if (existingIdx !== -1) {
                  seenIds.delete(cleanedSeasons[existingIdx].id);
                  cleanedSeasons[existingIdx] = {
                    id: sid,
                    name: sname || `Temporada ${snum}`,
                    number: snum,
                    episodes: []
                  };
                  seenIds.add(sid);
                }
              }
              return;
            }

            seenIds.add(sid);
            seenNumbers.add(snum);
            cleanedSeasons.push({
              id: sid,
              name: sname || `Temporada ${snum}`,
              number: snum,
              episodes: []
            });
          };

          // Priority 1: Current item being viewed
          if (detailItem.isSeries || item.isSeries || episodes.length > 0) {
            const p = parseSeason(item.title);
            addSeason({
              id: String(item.id),
              name: p.number ? `Temporada ${p.number}` : undefined,
              number: p.number || undefined
            });
          }

          // Priority 2: Seasons discovered by SeriesCollector in catalog
          for (const s of itemSeasons) {
            addSeason(s);
          }

          // Priority 3: Related seasons from sameSeasonSeriesList in portal
          for (const s of rawSeasons) {
            addSeason(s);
          }

          cleanedSeasons.sort((a, b) => a.number - b.number);

          const hasCC = Boolean((res.item as any)?.moreSubtitle || (res.item as any)?.subtitles?.length);
          const epQualities = episodes.flatMap(ep => ep.qualities || (ep.quality ? [ep.quality] : []));
          const mergedQualities = detailItem.qualities && detailItem.qualities.length ? detailItem.qualities : epQualities;
          setCachedTitleMeta(item.id, {
            quality: detailItem.quality,
            qualities: mergedQualities,
            hasCC,
            year: detailItem.year,
            duration: detailItem.duration,
            actors: detailItem.actors,
            director: detailItem.director,
            backdrop: detailItem.backdrop
          });

          return {
            item: detailItem,
            episodes,
            seasons: cleanedSeasons
          };
        }
      } catch (e) {
        // With a portal session, a failure is reported to the UI (retry) instead of showing demo data
        console.warn('[CatalogService] MagisClient.detail failed:', e);
        throw e;
      }
    }

    // 2. No portal client (offline development): the title as it is, with no made-up episodes or seasons
    const isSeriesItem = Boolean(item.isSeries || item.kind === 'serie' || (item as any).type === 'teleplay');
    return { item: { ...item, isSeries: isSeriesItem }, episodes: [], seasons: [] };
  }

}

export const catalogService = new CatalogService();

// ---------- Portal category tree (the official app's sidebar)
// v3/getColumnContents gives the children of a column (Netflix, Hulu, Acción…), v3/getShelveData
// the titles of one of them, page by page. The tree is saved, so the sidebar shows at once next time
// (and when the portal does not answer).

export interface PortalColumn {
  id: number;
  code: string;
  name: string;
  free: boolean;
  sequence: number;
}

/** Portal column id of a root ('movies', 'series', 'kids', 'anime', 'featured', 'explorar') */
export function portalRootId(root: string): number | undefined {
  return catalogProvider.rootId(root);
}

/** opts.special: restricted children too (adult section, opened after the PIN) */
export async function getPortalColumns(columnId: number, opts?: { special?: boolean }): Promise<PortalColumn[]> {
  const special = !!(opts && opts.special);
  return catalogProvider.columns(columnId, { special });
}

// ---------- Filter screen (v3/filterGenre values, v3/filterByContent titles)

export interface FilterOptions {
  tags: string[];
  year: string[];
  originalCountry: string[];
  audio: { key: string; value: string }[];
}

/** Selected values, as the portal names them ('' = all) */
export interface FilterValues {
  tags: string;
  year: string;
  originalCountry: string;
  audio: string;
}

export function getFilterOptions(root: string): Promise<FilterOptions> {
  return new Promise((resolve, reject) => {
    const client = window.MagisClient;
    if (!client || typeof client.browseFilters !== 'function') return reject(new Error('no portal client'));
    client.browseFilters(root, (err: any, res: any) => {
      if (err) return reject(err);
      resolve({
        tags: res.tags || [],
        year: (res.year || []).map(String),
        originalCountry: res.originalCountry || [],
        audio: res.audio || []
      });
    });
  });
}

export function getFilteredPage(
  root: string,
  filters: FilterValues,
  pageNum: number,
  pageSize: number
): Promise<{ items: VodItem[]; total: number }> {
  return new Promise((resolve, reject) => {
    const client = window.MagisClient;
    if (!client || typeof client.browse !== 'function') return reject(new Error('no portal client'));
    client.browse(root, filters, pageNum, pageSize, (err: any, res: { items: any[]; total: number }) => {
      if (err) return reject(err);
      const offset = (pageNum - 1) * pageSize;
      const isAdultRoot = root === 'adult';
      const items = (res.items || []).map((raw, i) => {
        const item = normalizeItem(raw, offset + i);
        if (isAdultRoot) {
          item.restricted = true;
          item.privateContent = true;
          if (!item.category) item.category = 'adult';
        }
        return item;
      });
      if (isAdultRoot && items.length) {
        historyService.markPrivate(items);
      }
      resolve({ items, total: res.total || 0 });
    });
  });
}

/** "Búsqueda popular" of the search screen: the titles of the first child of the hot-search root */
export async function getPopularSearchPage(pageNum: number, pageSize: number): Promise<{ items: VodItem[]; total: number }> {
  const rootId = portalRootId('search');
  if (rootId === undefined) throw new Error('no portal client');
  const cols = await getPortalColumns(rootId);
  if (!cols.length) return { items: [], total: 0 };
  return getPortalColumnPage(cols[0].id, pageNum, pageSize);
}

// Memory + KV cache for column pages (SWR pattern)
const columnPageMemoryCache = new Map<string, { items: VodItem[]; total: number; at: number }>();

export async function getPortalColumnPage(
  columnId: number,
  pageNum: number,
  pageSize: number,
  opts?: { restricted?: boolean }
): Promise<{ items: VodItem[]; total: number }> {
  const isRestricted = Boolean(opts?.restricted || columnId === 76300);
  const cacheKey = `xuper_col_page_${columnId}_p${pageNum}_s${pageSize}${isRestricted ? '_r' : ''}`;

  // 1. In-memory instant check (< 1ms)
  const mem = columnPageMemoryCache.get(cacheKey);
  if (mem && (Date.now() - mem.at < 15 * 60 * 1000)) {
    return { items: mem.items, total: mem.total };
  }

  return catalogProvider.columnPage(columnId, pageNum, pageSize, opts).then(res => {
      const offset = (pageNum - 1) * pageSize;
      const rawList = res.items || [];
      const items = rawList.map((raw, i) => {
        const item = normalizeItem(isRestricted ? { ...raw, restricted: true, privateContent: true, category: raw?.category || 'adult' } : raw, offset + i);
        if (isRestricted) {
          item.restricted = true;
          item.privateContent = true;
          if (!item.category) item.category = 'adult';
        }
        return item;
      });
      const total = res.total || 0;
      
      // Save in cache only when items exist
      if (items.length > 0) {
        columnPageMemoryCache.set(cacheKey, { items, total, at: Date.now() });
      }

      return { items, total };
  });
}

export function getPersons(contentId: string): Promise<PersonResult> {
  return new Promise((resolve) => {
    const client = window.MagisClient;
    if (!client || typeof client.getPerson !== 'function') {
      return resolve({ directors: [], actors: [] });
    }
    client.getPerson(contentId, (err: any, data: any) => {
      if (err || !data) return resolve({ directors: [], actors: [] });
      const dirList = (data.directorList || data.directors || []).map((d: any) => ({
        puId: String(d.puId || ''),
        name: String(d.name || ''),
        icon: d.icon || undefined,
        birthPlace: d.birthPlace || undefined,
        birthTime: d.birthTime || undefined,
        awards: d.awards || undefined,
        introduction: d.introduction || undefined,
        personType: 1
      }));
      const actList = (data.actorDisplayList || data.actors || []).map((a: any) => ({
        puId: String(a.puId || ''),
        name: String(a.name || ''),
        icon: a.icon || undefined,
        birthPlace: a.birthPlace || undefined,
        birthTime: a.birthTime || undefined,
        awards: a.awards || undefined,
        introduction: a.introduction || undefined,
        personType: 0
      }));
      resolve({ directors: dirList, actors: actList });
    });
  });
}

function resolveLocalCatalogFallback(personName: string, resolve: (res: { items: VodItem[]; total: number }) => void) {
  const norm = personName.trim().toLowerCase();
  const cached = catalogService.getCachedCatalog();
  const candidates: VodItem[] = cached
    ? [...cached.featured, ...cached.movies, ...cached.series, ...cached.kids, ...cached.anime]
    : [];

  const matched = candidates.filter(it =>
    (it.actors && it.actors.toLowerCase().includes(norm)) ||
    (it.director && it.director.toLowerCase().includes(norm)) ||
    (it.title && it.title.toLowerCase().includes(norm))
  );

  const seen: Record<string, boolean> = {};
  const unique = matched.filter(it => {
    if (seen[it.id]) return false;
    seen[it.id] = true;
    return true;
  });

  resolve({ items: unique, total: unique.length });
}

export function getPersonWorks(
  puId: string,
  pageNum = 1,
  pageSize = 24,
  personName?: string
): Promise<{ items: VodItem[]; total: number }> {
  return new Promise((resolve) => {
    const client = window.MagisClient;

    const fallbackToSearch = () => {
      if (!personName) return resolve({ items: [], total: 0 });
      if (client && typeof client.search === 'function') {
        client.search(personName, (sErr: any, sRes: any) => {
          if (!sErr && sRes && sRes.items && sRes.items.length > 0) {
            return resolve({
              items: sRes.items.map((raw: any, i: number) => normalizeItem(raw, i)),
              total: sRes.total || sRes.items.length
            });
          }
          resolveLocalCatalogFallback(personName, resolve);
        }, { pageSize });
        return;
      }
      resolveLocalCatalogFallback(personName, resolve);
    };

    if (client && typeof client.getItemByPerson === 'function' && puId) {
      client.getItemByPerson(puId, pageNum, pageSize, (err: any, res: { items: any[]; total: number }) => {
        if (!err && res && res.items && res.items.length > 0) {
          const offset = (pageNum - 1) * pageSize;
          return resolve({
            items: (res.items || []).map((raw, i) => normalizeItem(raw, offset + i)),
            total: res.total || 0
          });
        }
        fallbackToSearch();
      });
      return;
    }

    fallbackToSearch();
  });
}

export function getChannelCatchup(channelCode: string, columnId = 0, pageNum = 1, pageSize = 50): Promise<{ programs: any[]; total: number }> {
  return new Promise((resolve) => {
    const client = window.MagisClient;
    if (!client || typeof client.getAllbackProgram !== 'function') {
      return resolve({ programs: [], total: 0 });
    }
    client.getAllbackProgram(channelCode, columnId, pageNum, pageSize, (err: any, res: any) => {
      if (err || !res) return resolve({ programs: [], total: 0 });
      resolve({ programs: res.programs || [], total: res.total || 0 });
    });
  });
}

export function getCatchupStreamUrl(channelCode: string, contentId: string, columnId = 0): Promise<string | null> {
  return new Promise((resolve) => {
    const client = window.MagisClient;
    if (!client || typeof client.startPlayBTV !== 'function') {
      return resolve(null);
    }
    client.startPlayBTV(channelCode, contentId, columnId, (err: any, res: any) => {
      if (err || !res || !res.url) return resolve(null);
      resolve(res.url);
    });
  });
}

export interface EpgProgramItem {
  contentId?: string;
  programName: string;
  startTime: string;
  endTime: string;
  desc?: string;
  remark?: string;
}

export function getChannelProgram(channelCode: string, columnId = 0): Promise<{ channelCode: string; name: string; programList: EpgProgramItem[] }> {
  return new Promise((resolve) => {
    const client = window.MagisClient;
    if (!client || typeof client.getChannelProgram !== 'function') {
      return resolve({ channelCode, name: '', programList: [] });
    }
    client.getChannelProgram(channelCode, columnId, (err: any, res: any) => {
      if (err || !res) return resolve({ channelCode, name: '', programList: [] });
      resolve({
        channelCode: res.channelCode || channelCode,
        name: res.name || '',
        programList: res.programList || []
      });
    });
  });
}

/**
 * Title details asked for in the background (focused card, rotating hero). The portal answers one request at a
 * time, so each of these delayed the grid pages and the detail behind it: walking a grid queued one request per
 * card. Now only the latest wish is kept, and it starts only when the portal queue is empty.
 */
let backgroundWish: { item: VodItem; includeMediaOptions: boolean } | null = null;
let backgroundPumping = false;
const BACKGROUND_IDLE_POLL_MS = 400;

function portalIdle(): boolean {
  const client = window.MagisClient;
  return !client || typeof client.isIdle !== 'function' || client.isIdle();
}

async function pumpBackgroundWishes(): Promise<void> {
  backgroundPumping = true;
  try {
    while (backgroundWish) {
      if (!portalIdle()) {
        await new Promise(resolve => setTimeout(resolve, BACKGROUND_IDLE_POLL_MS));
        continue;
      }
      const wish = backgroundWish;
      backgroundWish = null;
      await enrichTitleMeta(wish.item, wish.includeMediaOptions);
    }
  } finally {
    backgroundPumping = false;
  }
}

/** Same as enrichTitleMeta, but yields to every other portal request and drops wishes overtaken by a newer one */
export function enrichTitleMetaInBackground(item: VodItem, includeMediaOptions = false): void {
  if (!item?.id) return;
  backgroundWish = { item, includeMediaOptions };
  if (!backgroundPumping) void pumpBackgroundWishes();
}

const metaEnrichInFlight = new Map<string, Promise<void>>();
const metaEnrichAttempted = new Set<string>();
/** Titles whose play options were already asked for in this run: a title without subtitles or year stays without them */
const mediaEnrichAttempted = new Set<string>();

/**
 * Fetches detail (and optionally mediaOptions) in the background for a title
 * and persists its quality/CC metadata in titleMetaCache.
 */
export function enrichTitleMeta(item: VodItem, includeMediaOptions = false): Promise<void> {
  if (!item?.id) return Promise.resolve();
  const id = String(item.id);
  const cached = getCachedTitleMeta(id);
  const hasQuality = Boolean(cached?.quality || cached?.qualities?.length || item.quality || item.qualities?.length);
  const hasCC = Boolean(cached?.hasCC || (item as any).moreSubtitle || (item as any).subtitles?.length);

  const hasYear = Boolean(cached?.year || (item.year && item.year !== '—'));

  if (hasQuality && (!includeMediaOptions || (hasCC && hasYear))) {
    return Promise.resolve();
  }
  // Asked once per run: the hero used to ask again on every pass for a title that has no subtitles to find
  if (metaEnrichAttempted.has(id) && (!includeMediaOptions || mediaEnrichAttempted.has(id))) {
    return Promise.resolve();
  }
  const existing = metaEnrichInFlight.get(id);
  if (existing) return existing;

  metaEnrichAttempted.add(id);
  if (includeMediaOptions) mediaEnrichAttempted.add(id);
  const task = (async () => {
    try {
      const detail = await catalogService.getVodDetail(item);
      const afterDetail = getCachedTitleMeta(id);
      const stillNeedsMedia =
        includeMediaOptions &&
        (!(afterDetail?.quality || afterDetail?.qualities?.length) || !afterDetail?.hasCC);

      if (stillNeedsMedia && window.MagisClient && typeof window.MagisClient.mediaOptions === 'function') {
        const playableId = detail.item.isSeries && detail.episodes.length ? detail.episodes[0].id : detail.item.id;
        const playableSeries = detail.item.isSeries ? (detail.seasons[0]?.id || detail.item.id) : '';
        await new Promise<void>(resolve => {
          window.MagisClient.mediaOptions(playableId, playableSeries, (err: any, m: any) => {
            if (!err && m) {
              setCachedTitleMeta(id, {
                qualities: Array.isArray(m.qualities) ? m.qualities : undefined,
                hasCC: Array.isArray(m.subtitles) && m.subtitles.length > 0
              });
            }
            resolve();
          });
        });
      }
    } catch {
      // Best-effort background enrichment; a failed request may be tried again later
      metaEnrichAttempted.delete(id);
      mediaEnrichAttempted.delete(id);
    } finally {
      metaEnrichInFlight.delete(id);
    }
  })();

  metaEnrichInFlight.set(id, task);
  return task;
}
