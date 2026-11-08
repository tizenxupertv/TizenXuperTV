import { kvGet, kvSet } from '../lib/kvStore';
import { VodItem, VodEpisode, VodSeason } from '../types/vod';
import { SeriesCollector, isAdultItem, belongsToSection, parseSeason } from '../lib/catalogOrganizer';

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

  const id = String(raw.id || raw.vodId || raw.programId || raw.program_id || `item-${index}`);
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
  const poster = raw.posterUrl || raw.poster_url || raw.poster || raw.image || raw.imageUrl || raw.cover || 'assets/placeholder_vertical.png';
  const landscape = raw.landscapeUrl || raw.landscape_url || raw.landscape || raw.wideImage || raw.bannerImage || poster;
  const backdrop = raw.backdropUrl || raw.backdrop_url || raw.backdrop || landscape;

  const rowName = String(raw.row || '');
  const isSeries = !!(
    raw.type === 'teleplay' || raw.type === 'series' || raw.kind === 'serie' ||
    (raw.category && raw.category.indexOf('serie') !== -1) ||
    (raw.episodes && raw.episodes.length > 0) ||
    (raw.seasons && raw.seasons.length > 0) ||
    rowName.includes('Series') || rowName.includes('Dramas') || rowName.includes('Telenovelas')
  );

  return {
    id,
    title,
    category: raw.category || '',
    kind: isSeries ? 'serie' : (raw.kind || 'pelicula'),
    score: String(score),
    year: String(year),
    duration: typeof duration === 'number' ? `${Math.floor(duration/60)} h ${duration%60} min` : String(duration),
    genres,
    director: raw.director || '—',
    actors: raw.actors || raw.actorDisplay || raw.cast || '—',
    synopsis,
    poster,
    landscape,
    backdrop,
    isSeries,
    row: rowName,
    streamUrl: raw.streamUrl || raw.stream_url || '',
    trailerUrl: raw.trailerUrl || raw.trailer_url || raw.trailer || raw.previewUrl || raw.preview_url || undefined,
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

// ---------- Live catalog
// The home rows come from the portal (getNextColumns of each root). The portal client sends one
// request at a time (rate limit), so downloading the catalog delays everything else (live TV):
//  - a saved copy younger than LIVE_FRESH_MS is shown at once;
//  - an older one (or none) is downloaded during the loading screen, up to LIVE_WAIT_MS, then the
//    saved copy or the bundled portal.js is shown (the late download is saved for the next start);
//  - once the app is idle, and when it comes back to the front, a copy older than
//    LIVE_REFRESH_AFTER_MS is downloaded again for the next start.
const LIVE_KEY = 'xuper_live_catalog_v1';
/** Bumped when the saved rows change shape or content (2: ranked TOP rows carry their full list): an older copy
    is still shown when nothing else is at hand, but never counts as fresh */
const LIVE_FORMAT = 2;
const LIVE_ROOTS = ['featured', 'movies', 'series', 'kids', 'anime', 'free', 'explorar'];
const LIVE_WAIT_MS = 6000;
const LIVE_FRESH_MS = 2 * 60 * 60 * 1000;
const LIVE_REFRESH_AFTER_MS = 30 * 60 * 1000;
let liveInFlight: Promise<any[]> | null = null;
let lastKeyAt = 0;
if (typeof window !== 'undefined') window.addEventListener('keydown', () => { lastKeyAt = Date.now(); }, true);

/** Saved copy (IndexedDB); a copy left by an earlier version in localStorage is moved over once */
async function readLiveCatalog(): Promise<{ at: number; v?: number; items: any[] } | null> {
  const saved = await kvGet<{ at: number; v?: number; items: any[] }>(LIVE_KEY);
  if (saved && Array.isArray(saved.items) && saved.items.length) return saved;
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    if (!raw) return null;
    const old = JSON.parse(raw);
    localStorage.removeItem(LIVE_KEY);
    if (old && Array.isArray(old.items) && old.items.length) {
      kvSet(LIVE_KEY, old);
      return old;
    }
  } catch {}
  return null;
}

function homeRoot(root: string, low: boolean): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const client = window.MagisClient;
    if (!client || typeof client.home !== 'function') return reject(new Error('no portal client'));
    client.home(root, 1, (err: any, res: any) => (err ? reject(err) : resolve((res && res.items) || [])), { low });
  });
}

/** Downloads every root's rows; saves them when complete enough */
/** `low`: background refresh, behind every request the user is waiting for */
function fetchLiveCatalog(low = false): Promise<any[]> {
  if (liveInFlight) return liveInFlight;
  const t0 = Date.now();
  // Background: one root at a time, each only while the remote has rested for 4 s, so a request
  // the user makes never lands behind a long download. Foreground: all roots at once.
  const idle = (): Promise<void> => new Promise(resolve => {
    const check = () => (Date.now() - lastKeyAt >= 4000 ? resolve() : setTimeout(check, 1000));
    check();
  });
  const roots: Promise<any[][]> = low
    ? LIVE_ROOTS.reduce<Promise<any[][]>>(
        (acc, root) => acc.then(lists => idle().then(() => homeRoot(root, true)).catch(() => [] as any[]).then(items => lists.concat([items]))),
        Promise.resolve([])
      )
    : Promise.all(LIVE_ROOTS.map(root => homeRoot(root, false).catch(() => [] as any[])));
  liveInFlight = roots.then(lists => {
    const items = ([] as any[]).concat(...lists);
    console.log(`[catalog] live catalog: ${items.length} items in ${Date.now() - t0} ms`);
    if (items.length < 100) throw new Error(`live catalog too small (${items.length})`);
    kvSet(LIVE_KEY, { at: Date.now(), v: LIVE_FORMAT, items });
    console.log(`[catalog] live catalog saved: ${items.length} items`);
    return items;
  });
  liveInFlight.then(() => { liveInFlight = null; }, () => { liveInFlight = null; });
  return liveInFlight;
}

class CatalogService {
  /** Refreshes the saved live catalog for the next start (no change on screen) */
  public async refreshLiveInBackground(): Promise<void> {
    const saved = await readLiveCatalog();
    if (saved && saved.v === LIVE_FORMAT && Date.now() - saved.at < LIVE_REFRESH_AFTER_MS) return;
    // The answers are decrypted on the main thread: start only while the remote rests
    if (Date.now() - lastKeyAt < 4000) {
      setTimeout(() => this.refreshLiveInBackground(), 4000);
      return;
    }
    fetchLiveCatalog(true).catch(e => console.log('[catalog] live refresh failed:', e && e.message));
  }

  private cache: {
    featured: VodItem[];
    movies: VodItem[];
    series: VodItem[];
    kids: VodItem[];
    anime: VodItem[];
    rowsByGroup: Record<string, VodItem[]>;
    portalRows: Record<string, PortalRow[]>;
  } | null = null;

  public async fetchCatalog(): Promise<{
    featured: VodItem[];
    movies: VodItem[];
    series: VodItem[];
    kids: VodItem[];
    anime: VodItem[];
    rowsByGroup: Record<string, VodItem[]>;
    portalRows: Record<string, PortalRow[]>;
  }> {
    if (this.cache) return this.cache;

    // 0. Live catalog: a recent saved copy, else fresh from the portal, else any saved copy
    const saved = await readLiveCatalog();
    // A copy saved before the Explorar root was downloaded lacks its rows: not fresh
    const savedComplete = !!saved && saved.items.some((it: any) => String(it.category || '').split(',')[0] === 'explorar');
    if (saved && savedComplete && saved.v === LIVE_FORMAT && Date.now() - saved.at < LIVE_FRESH_MS) {
      return this.categorize(saved.items.map((it: any, idx: number) => normalizeItem(it, idx)));
    }
    const fresh = await Promise.race([
      fetchLiveCatalog().catch(() => null),
      new Promise<null>(resolve => setTimeout(() => resolve(null), LIVE_WAIT_MS))
    ]);
    const live = fresh && fresh.length ? fresh : (saved ? saved.items : []);
    if (live.length) return this.categorize(live.map((it: any, idx: number) => normalizeItem(it, idx)));

    // 1. Check window.XUPERTV_PORTAL (rich bundled portal catalog with 610 items)
    if (typeof window !== 'undefined' && window.XUPERTV_PORTAL && Array.isArray(window.XUPERTV_PORTAL.items) && window.XUPERTV_PORTAL.items.length > 0) {
      const all = window.XUPERTV_PORTAL.items.map((it: any, idx: number) => normalizeItem(it, idx));
      return this.categorize(all);
    }

    // 2. Check window.XUPERTV_CATALOG
    if (typeof window !== 'undefined' && window.XUPERTV_CATALOG && Array.isArray(window.XUPERTV_CATALOG.items) && window.XUPERTV_CATALOG.items.length > 0) {
      const all = window.XUPERTV_CATALOG.items.map((it: any, idx: number) => normalizeItem(it, idx));
      return this.categorize(all);
    }

    // 3. Check localStorage cache
    try {
      const cached = localStorage.getItem('xuper_portal_cache_v2');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
          const all = parsed.items.map((it: any, idx: number) => normalizeItem(it, idx));
          return this.categorize(all);
        }
      }
    } catch (e) {}

    // 4. Fallback demo data
    return this.getDemoCatalog();
  }

  private categorize(rawItems: VodItem[]) {
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
      portalRows
    };

    return this.cache;
  }

  private getDemoCatalog() {
    const demos: VodItem[] = [
      {
        id: 'spiderman',
        title: 'Spider-Man: Lejos de Casa',
        category: 'destacado',
        kind: 'destacado',
        score: '8.4',
        year: '2024',
        duration: '02:09:00',
        genres: ['Película', 'Acción', 'Aventura'],
        synopsis: 'La realidad no es lo que parece cuando Spidey se enfrenta a los alucinantes poderes de Mysterio tras los eventos de Endgame.',
        poster: 'assets/catalog/spiderman.jpg',
        backdrop: 'assets/catalog/spiderman.jpg',
        landscape: 'assets/catalog/spiderman.jpg'
      },
      {
        id: 'matchbox',
        title: 'Matchbox: La Película',
        category: 'destacado',
        kind: 'destacado',
        score: '7.8',
        year: '2024',
        duration: '01:52:00',
        genres: ['Acción', 'Velocidad'],
        synopsis: 'Carreras a alta velocidad y desafíos extremos en una pista urbana donde solo el mejor piloto sobrevive.',
        poster: 'assets/catalog/matchbox.jpg',
        backdrop: 'assets/catalog/matchbox.jpg',
        landscape: 'assets/catalog/matchbox.jpg'
      },
      {
        id: 'tenzing',
        title: 'Tenzing: En la cima',
        category: 'destacado',
        kind: 'destacado',
        score: '8.1',
        year: '2024',
        duration: '02:08:00',
        genres: ['Aventura', 'Drama'],
        synopsis: 'La inspiradora historia de Tenzing Norgay y su épica ascensión junto a Edmund Hillary hacia el techo del mundo.',
        poster: 'assets/catalog/tenzing.jpg',
        backdrop: 'assets/catalog/tenzing.jpg',
        landscape: 'assets/catalog/tenzing.jpg'
      },
      {
        id: 'sacrifice',
        title: 'Sacrifice',
        category: 'destacado',
        kind: 'destacado',
        score: '7.5',
        year: '2024',
        duration: '01:48:00',
        genres: ['Suspenso', 'Misterio'],
        synopsis: 'Un secreto ancestral resucita en un remoto pueblo costero donde cada habitante parece ocultar una verdad perturbadora.',
        poster: 'assets/catalog/sacrifice.jpg',
        backdrop: 'assets/catalog/sacrifice.jpg'
      },
      {
        id: 'masterplan',
        title: 'El Gran Golpe',
        category: 'destacado',
        kind: 'destacado',
        score: '8.0',
        year: '2024',
        duration: '02:04:00',
        genres: ['Crimen', 'Acción'],
        synopsis: 'Una banda de cerebros criminales planea el robo más sofisticado de la historia en el banco central de Ginebra.',
        poster: 'assets/catalog/masterplan.jpg',
        backdrop: 'assets/catalog/masterplan.jpg'
      },
      {
        id: 'carrie',
        title: 'Carrie: Revelación',
        category: 'pelicula',
        kind: 'pelicula',
        score: '7.2',
        year: '2024',
        duration: '01:45:00',
        genres: ['Terror', 'Drama'],
        synopsis: 'Una joven marginada descubre que sus habilidades telequinéticas pueden ser su salvación o su total destrucción.',
        poster: 'assets/catalog/carrie.jpg',
        backdrop: 'assets/catalog/carrie.jpg'
      },
      {
        id: 'fall2',
        title: 'Vértigo Extremo',
        category: 'pelicula',
        kind: 'pelicula',
        score: '7.4',
        year: '2024',
        duration: '01:54:00',
        genres: ['Suspenso', 'Supervivencia'],
        synopsis: 'Dos escaladoras quedan atrapadas en lo alto de una antena de comunicaciones desmantelada en pleno desierto.',
        poster: 'assets/catalog/fall2.jpg',
        backdrop: 'assets/catalog/fall2.jpg'
      },
      {
        id: 'amor',
        title: 'Amor en París',
        category: 'pelicula',
        kind: 'pelicula',
        score: '7.6',
        year: '2024',
        duration: '01:40:00',
        genres: ['Romance', 'Comedia'],
        synopsis: 'Un encuentro fortuito en las orillas del Sena desencadena una semana inolvidable llena de magia y decisiones.',
        poster: 'assets/catalog/amor.jpg',
        backdrop: 'assets/catalog/amor.jpg'
      },
      {
        id: 'animales',
        title: 'Mundo Salvaje',
        category: 'pelicula',
        kind: 'pelicula',
        score: '8.3',
        year: '2024',
        duration: '01:36:00',
        genres: ['Documental', 'Aventura'],
        synopsis: 'Un recorrido visual sin precedentes por los ecosistemas más recónditos de la Tierra narrado en 4K Ultra HD.',
        poster: 'assets/catalog/animales.jpg',
        backdrop: 'assets/catalog/animales.jpg'
      },
      {
        id: 'marsupilami',
        title: 'La Selva de Marsupilami',
        category: 'pelicula',
        kind: 'pelicula',
        score: '7.0',
        year: '2024',
        duration: '01:35:00',
        genres: ['Animación', 'Aventura'],
        synopsis: 'El legendario animal de cola elástica lidera la defensa del bosque tropical contra invasores inesperados.',
        poster: 'assets/catalog/marsupilami.jpg',
        backdrop: 'assets/catalog/marsupilami.jpg'
      },
      {
        id: 'cartas',
        title: 'Cartas del Pasado',
        category: 'pelicula',
        kind: 'pelicula',
        score: '7.9',
        year: '2024',
        duration: '01:58:00',
        genres: ['Drama', 'Misterio'],
        synopsis: 'Una serie de cartas sin abrir durante cincuenta años desvela una historia de pasión prohibida durante la guerra.',
        poster: 'assets/catalog/cartas.jpg',
        backdrop: 'assets/catalog/cartas.jpg'
      },
      {
        id: 'hechizo',
        title: 'Bajo el Hechizo',
        category: 'pelicula',
        kind: 'pelicula',
        score: '7.3',
        year: '2024',
        duration: '01:42:00',
        genres: ['Fantasía', 'Aventura'],
        synopsis: 'Un antiguo medallón otorga visiones del porvenir a quien se atreva a pronunciar el conjuro guardado en las sombras.',
        poster: 'assets/catalog/hechizo.jpg',
        backdrop: 'assets/catalog/hechizo.jpg'
      },
      {
        id: 'reacher',
        title: 'Reacher',
        category: 'serie',
        kind: 'serie',
        score: '8.8',
        year: '2024',
        duration: '8 Episodios',
        genres: ['Acción', 'Crimen'],
        synopsis: 'Un veterano investigador de la policía militar recorre Estados Unidos enfrentándose a conspiraciones letales.',
        isSeries: true,
        poster: 'assets/catalog/search-reacher.jpg',
        backdrop: 'assets/catalog/search-reacher.jpg',
        landscape: 'assets/catalog/search-reacher.jpg'
      },
      {
        id: 'ted-lasso',
        title: 'Ted Lasso',
        category: 'serie',
        kind: 'serie',
        score: '8.9',
        year: '2024',
        duration: '12 Episodios',
        genres: ['Comedia', 'Deportes'],
        synopsis: 'Un bondadoso entrenador universitario de fútbol americano en EE.UU. viaja a Londres para dirigir un club de la Premier League inglesa.',
        isSeries: true,
        poster: 'assets/catalog/search-reacher.jpg',
        backdrop: 'assets/catalog/spiderman.jpg',
        landscape: 'assets/catalog/spiderman.jpg'
      },
      {
        id: 'stick',
        title: 'Stick: El swing perfecto',
        category: 'serie',
        kind: 'serie',
        score: '8.5',
        year: '2024',
        duration: '10 Episodios',
        genres: ['Comedia', 'Deportes'],
        synopsis: 'Un prodigio del golf venido a menos busca redención liderando a un equipo de inadaptados hacia la gran final del circuito.',
        isSeries: true,
        poster: 'assets/catalog/search-outer-banks.jpg',
        backdrop: 'assets/catalog/matchbox.jpg',
        landscape: 'assets/catalog/matchbox.jpg'
      },
      {
        id: 'the-dink',
        title: 'The Dink',
        category: 'pelicula',
        kind: 'pelicula',
        score: '7.6',
        year: '2024',
        duration: '01:48:00',
        genres: ['Comedia', 'Deportes'],
        synopsis: 'Un extenista profesional desesperado por salvar el club de su infancia se ve forzado a jugar en el torneo más ridículo y feroz de pickleball.',
        poster: 'assets/catalog/fall2.jpg',
        backdrop: 'assets/catalog/fall2.jpg',
        landscape: 'assets/catalog/fall2.jpg'
      },
      {
        id: 'swagger',
        title: 'Swagger: Pasión por la cancha',
        category: 'serie',
        kind: 'serie',
        score: '8.3',
        year: '2024',
        duration: '10 Episodios',
        genres: ['Drama', 'Deportes'],
        synopsis: 'Inspirada en las vivencias de Kevin Durant, la serie explora el mundo del baloncesto juvenil estadounidense y las familias que sueñan con triunfar.',
        isSeries: true,
        poster: 'assets/catalog/search-senor-cielos.jpg',
        backdrop: 'assets/catalog/tenzing.jpg',
        landscape: 'assets/catalog/tenzing.jpg'
      },
      {
        id: 'acapulco',
        title: 'Acapulco',
        category: 'pelicula',
        kind: 'pelicula',
        score: '8.1',
        year: '2024',
        duration: '01:50:00',
        genres: ['Comedia', 'Romance'],
        synopsis: 'En 1984, el sueño de Máximo Gallardo se hace realidad cuando consigue el trabajo de su vida en Las Colinas, el resort más glamoroso de Acapulco.',
        poster: 'assets/catalog/amor.jpg',
        backdrop: 'assets/catalog/amor.jpg',
        landscape: 'assets/catalog/amor.jpg'
      },
      {
        id: 'palmer',
        title: 'Palmer',
        category: 'pelicula',
        kind: 'pelicula',
        score: '8.2',
        year: '2024',
        duration: '01:50:00',
        genres: ['Drama'],
        synopsis: 'Tras doce años en prisión, Eddie Palmer regresa a casa para rehacer su vida y forja un vínculo inesperado con un niño marginado.',
        poster: 'assets/catalog/cartas.jpg',
        backdrop: 'assets/catalog/cartas.jpg',
        landscape: 'assets/catalog/cartas.jpg'
      },
      {
        id: 'the-morning-show',
        title: 'The Morning Show',
        category: 'serie',
        kind: 'serie',
        score: '8.6',
        year: '2024',
        duration: '10 Episodios',
        genres: ['Drama', 'Noticias'],
        synopsis: 'Una mirada sincera y despiadada a las relaciones de poder entre hombres y mujeres que despiertan cada día a Estados Unidos.',
        isSeries: true,
        poster: 'assets/catalog/search-betty.jpg',
        backdrop: 'assets/catalog/sacrifice.jpg',
        landscape: 'assets/catalog/sacrifice.jpg'
      },
      {
        id: 'amigos-vecinos',
        title: 'Amigos y Vecinos',
        category: 'pelicula',
        kind: 'pelicula',
        score: '7.8',
        year: '2024',
        duration: '01:42:00',
        genres: ['Comedia', 'Drama'],
        synopsis: 'Una comunidad suburbana aparentemente perfecta se ve revolucionada cuando un vecino extravagante decide desafiar todas las normas de convivencia.',
        poster: 'assets/catalog/masterplan.jpg',
        backdrop: 'assets/catalog/masterplan.jpg',
        landscape: 'assets/catalog/masterplan.jpg'
      },
      {
        id: 'greyhound',
        title: 'Greyhound: En la mira del enemigo',
        category: 'pelicula',
        kind: 'pelicula',
        score: '8.4',
        year: '2024',
        duration: '01:31:00',
        genres: ['Bélica', 'Acción', 'Historia'],
        synopsis: 'En los primeros días de la Segunda Guerra Mundial, un convoy internacional de 37 barcos aliados cruza el traicionero Atlántico Norte asediado por submarinos nazis.',
        poster: 'assets/catalog/tenzing.jpg',
        backdrop: 'assets/catalog/tenzing.jpg',
        landscape: 'assets/catalog/tenzing.jpg'
      },
      {
        id: 'plan-familiar',
        title: 'Plan Familiar',
        category: 'pelicula',
        kind: 'pelicula',
        score: '7.9',
        year: '2024',
        duration: '01:58:00',
        genres: ['Acción', 'Comedia'],
        synopsis: 'Un devoto padre de familia suburbana debe huir por carretera con su esposa e hijos cuando su pasado como asesino de élite del gobierno lo alcanza.',
        poster: 'assets/catalog/matchbox.jpg',
        backdrop: 'assets/catalog/matchbox.jpg',
        landscape: 'assets/catalog/matchbox.jpg'
      },
      {
        id: 'fundacion',
        title: 'Fundación',
        category: 'serie',
        kind: 'serie',
        score: '8.7',
        year: '2024',
        duration: '10 Episodios',
        genres: ['Ciencia Ficción', 'Aventura'],
        synopsis: 'Basada en las premiadas novelas de Isaac Asimov, narra la épica travesía de un grupo de exiliados para salvar a la humanidad de la caída del Imperio Galáctico.',
        isSeries: true,
        poster: 'assets/catalog/search-one-piece.jpg',
        backdrop: 'assets/catalog/fall2.jpg',
        landscape: 'assets/catalog/fall2.jpg'
      },
      {
        id: 'f1-movie',
        title: 'F1: La Película',
        category: 'pelicula',
        kind: 'pelicula',
        score: '8.8',
        year: '2025',
        duration: '02:15:00',
        genres: ['Deportes', 'Acción', 'Drama'],
        synopsis: 'Un veterano piloto de carreras sale de su retiro para competir como mentor junto a un joven novato en el equipo más competitivo de la Fórmula 1.',
        poster: 'assets/catalog/spiderman.jpg',
        backdrop: 'assets/catalog/spiderman.jpg',
        landscape: 'assets/catalog/spiderman.jpg'
      },
      {
        id: 'outer-banks',
        title: 'Outer Banks',
        category: 'serie',
        kind: 'serie',
        score: '8.2',
        year: '2024',
        duration: '10 Episodios',
        genres: ['Aventura', 'Drama'],
        synopsis: 'Un grupo de adolescentes en una isla costera sigue un mapa del tesoro que destapa una conspiración de alto nivel.',
        isSeries: true,
        poster: 'assets/catalog/search-outer-banks.jpg',
        backdrop: 'assets/catalog/search-outer-banks.jpg',
        landscape: 'assets/catalog/search-outer-banks.jpg'
      },
      {
        id: 'one-piece',
        title: 'One Piece',
        category: 'serie',
        kind: 'serie',
        score: '8.9',
        year: '2024',
        duration: '8 Episodios',
        genres: ['Aventura', 'Fantasía'],
        synopsis: 'Monkey D. Luffy y su tripulación pirata zarpan en busca del tesoro definitivo para proclamarse Rey de los Piratas.',
        isSeries: true,
        poster: 'assets/catalog/search-one-piece.jpg',
        backdrop: 'assets/catalog/search-one-piece.jpg',
        landscape: 'assets/catalog/search-one-piece.jpg'
      },
      {
        id: 'senor-cielos',
        title: 'El Señor de los Cielos',
        category: 'serie',
        kind: 'serie',
        score: '8.0',
        year: '2024',
        duration: '12 Episodios',
        genres: ['Acción', 'Drama'],
        synopsis: 'La vida y leyenda de Aurelio Casillas y su imperio en los cielos con aviones de carga cargados de poder.',
        isSeries: true,
        poster: 'assets/catalog/search-senor-cielos.jpg',
        backdrop: 'assets/catalog/search-senor-cielos.jpg',
        landscape: 'assets/catalog/search-senor-cielos.jpg'
      },
      {
        id: 'chapo',
        title: 'El Chapo',
        category: 'serie',
        kind: 'serie',
        score: '8.1',
        year: '2024',
        duration: '9 Episodios',
        genres: ['Crimen', 'Biografía'],
        synopsis: 'Crónica dramática del ascenso, captura y escape del legendario capo de la droga.',
        isSeries: true,
        poster: 'assets/catalog/search-chapo.jpg',
        backdrop: 'assets/catalog/search-chapo.jpg',
        landscape: 'assets/catalog/search-chapo.jpg'
      },
      {
        id: 'betty',
        title: 'Betty la Fea: La Historia Continúa',
        category: 'serie',
        kind: 'serie',
        score: '8.3',
        year: '2024',
        duration: '10 Episodios',
        genres: ['Comedia', 'Drama'],
        synopsis: 'Veinte años después, Beatriz Pinzón Solano sigue construyendo su legado en Ecomoda frente a nuevos desafíos.',
        isSeries: true,
        poster: 'assets/catalog/search-betty.jpg',
        backdrop: 'assets/catalog/search-betty.jpg',
        landscape: 'assets/catalog/search-betty.jpg'
      },
      {
        id: 'cuatro-manos',
        title: 'Cuatro manos, dos hermanas',
        category: 'serie',
        kind: 'serie',
        score: '9.0',
        year: '2024',
        duration: '8 Episodios',
        genres: ['Drama', 'Música'],
        synopsis: 'Dos pianistas prodigio deben superar la rivalidad familiar para salvar la academia de música de su infancia.',
        isSeries: true,
        poster: 'assets/catalog/search-cuatro-manos.jpg',
        backdrop: 'assets/catalog/search-cuatro-manos.jpg',
        landscape: 'assets/catalog/search-cuatro-manos.jpg'
      },
      {
        id: 'linternas',
        title: 'Linternas',
        category: 'serie',
        kind: 'serie',
        score: '8.8',
        year: '2024',
        duration: '8 Episodios',
        genres: ['Acción', 'Ciencia Ficción'],
        synopsis: 'Dos guardianes interestelares son enviados al corazón de la Tierra para investigar un oscuro secreto.',
        isSeries: true,
        poster: 'assets/catalog/search-linternas.jpg',
        backdrop: 'assets/catalog/search-linternas.jpg',
        landscape: 'assets/catalog/search-linternas.jpg'
      },
      {
        id: 'secret-woman',
        title: 'Una mujer sin pasado',
        category: 'serie',
        kind: 'serie',
        score: '7.9',
        year: '2024',
        duration: '12 Episodios',
        genres: ['Misterio', 'Suspenso'],
        synopsis: 'Al despertar sin recuerdos en una clínica privada, una mujer descubre pistas sobre un complot que pone en jaque al gobierno.',
        isSeries: true,
        poster: 'assets/catalog/search-secret-woman.jpg',
        backdrop: 'assets/catalog/search-secret-woman.jpg',
        landscape: 'assets/catalog/search-secret-woman.jpg'
      },
      {
        id: 'the-general',
        title: 'El maquinista de la General',
        category: 'pelicula',
        kind: 'pelicula',
        score: '8.3',
        year: '1926',
        duration: '01:18:00',
        genres: ['Comedia', 'Acción', 'Clásico'],
        synopsis: 'Un maquinista persigue a los espías que robaron su locomotora y secuestraron a su prometida.',
        poster: 'assets/catalog/the-general.jpg',
        backdrop: 'assets/catalog/the-general.jpg',
        landscape: 'assets/catalog/the-general.jpg'
      },
      {
        id: 'sintel',
        title: 'Sintel: La leyenda del dragón',
        category: 'pelicula',
        kind: 'pelicula',
        score: '8.0',
        year: '2024',
        duration: '01:15:00',
        genres: ['Animación', 'Fantasía', 'Aventura'],
        synopsis: 'Una joven solitaria cruza un mundo hostil para reencontrarse con el dragón que crió de cachorro.',
        poster: 'assets/catalog/sintel.jpg',
        backdrop: 'assets/catalog/sintel.jpg',
        landscape: 'assets/catalog/sintel.jpg'
      },
      {
        id: 'minions',
        title: 'Minions: Fiebre Tropical',
        category: 'kids',
        kind: 'kids',
        score: '7.7',
        year: '2024',
        duration: '01:30:00',
        genres: ['Animación', 'Comedia', 'Infantil'],
        synopsis: 'Los pequeños secuaces amarillos causan el descontrol más divertido mientras buscan al villano más temido del planeta.',
        poster: 'assets/catalog/search-minions.jpg',
        backdrop: 'assets/catalog/search-minions.jpg',
        landscape: 'assets/catalog/search-minions.jpg'
      }
    ];

    return this.categorize(demos);
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
          const rawTrailer = res.item?.trailerUrl || res.item?.trailer_url || res.item?.trailer || res.trailerUrl || res.trailer || res.trailer_url || res.previewUrl || '';
          if (rawTrailer) detailItem.trailerUrl = String(rawTrailer);

          const episodes: VodEpisode[] = (res.episodes || []).map((ep: any, idx: number) => ({
            id: String(ep.id || ep.contentId || idx + 1),
            title: ep.title || ep.name || `Capítulo ${idx + 1}`,
            name: ep.title || ep.name || `Capítulo ${idx + 1}`,
            number: ep.number || idx + 1,
            duration: formatEpisodeDuration(ep.duration),
            quality: ep.quality || 'HD',
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
  const ids = window.MagisClient?.rootIds as Record<string, number> | undefined;
  return ids ? ids[root] : undefined;
}

/** opts.special: restricted children too (adult section, opened after the PIN) */
export function getPortalColumns(columnId: number, opts?: { special?: boolean }): Promise<PortalColumn[]> {
  const special = !!(opts && opts.special);
  const key = `xuper_columns_v1_${columnId}${special ? '_s' : ''}`;
  return new Promise<PortalColumn[]>((resolve, reject) => {
    const client = window.MagisClient;
    if (!client || typeof client.columns !== 'function') return reject(new Error('no portal client'));
    client.columns(columnId, (err: any, list: PortalColumn[]) => (err ? reject(err) : resolve(list || [])), { special });
  }).then(
    list => {
      if (list.length) kvSet(key, list);
      return list;
    },
    async err => {
      const saved = await kvGet<PortalColumn[]>(key);
      if (saved && saved.length) return saved;
      throw err;
    }
  );
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
      resolve({ items: (res.items || []).map((raw, i) => normalizeItem(raw, offset + i)), total: res.total || 0 });
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

export function getPortalColumnPage(
  columnId: number,
  pageNum: number,
  pageSize: number
): Promise<{ items: VodItem[]; total: number }> {
  return new Promise((resolve, reject) => {
    const client = window.MagisClient;
    if (!client || typeof client.columnPage !== 'function') return reject(new Error('no portal client'));
    client.columnPage(columnId, pageNum, pageSize, (err: any, res: { items: any[]; total: number }) => {
      if (err) return reject(err);
      const offset = (pageNum - 1) * pageSize;
      resolve({
        items: (res.items || []).map((raw, i) => normalizeItem(raw, offset + i)),
        total: res.total || 0
      });
    });
  });
}
