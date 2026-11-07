import { TabId } from '../components/layout/TopNavbar';
import { ContentRowDef } from '../views/DestacadosView';
import { VodItem } from '../types/vod';
import { HistoryItem } from '../types/history';
import { BrowseRoot } from '../lib/screenStack';
import type { PortalRow } from '../services/catalogService';

export interface TabRowsData {
  historyItems: HistoryItem[];
  featuredItems: VodItem[];
  movieItems: VodItem[];
  seriesItems: VodItem[];
  kidsItems: VodItem[];
  animeItems: VodItem[];
  catalogRows: Record<string, VodItem[]>;
  /** Portal rows per root category ('destacado', 'pelicula', 'serie', 'infantil', 'anime', 'explorar') */
  portalRows?: Record<string, PortalRow[]>;
}

/** Portal root of each VOD tab: its category in the catalog, and its column tree */
const TAB_PORTAL_ROOT: Partial<Record<TabId, { category: string; root: BrowseRoot }>> = {
  destacados: { category: 'destacado', root: 'featured' },
  peliculas: { category: 'pelicula', root: 'movies' },
  series: { category: 'serie', root: 'series' },
  kids: { category: 'infantil', root: 'kids' },
  anime: { category: 'anime', root: 'anime' },
  explorar: { category: 'explorar', root: 'explorar' }
};

/**
 * The tab's rows exactly as the portal sends them (getNextColumns of its root): names, order and
 * titles of the official app. Empty when the catalog has no portal rows (offline demo data).
 */
function portalTabRows(selectedTab: TabId, data: TabRowsData): ContentRowDef[] {
  const target = TAB_PORTAL_ROOT[selectedTab];
  const rows = target && data.portalRows ? data.portalRows[target.category] || [] : [];
  return rows
    .filter(r => r.items.length > 0)
    .map((r, i) => ({
      id: `portal:${target!.category}:${i}:${r.name}`,
      title: r.name,
      type: 'vod' as const,
      items: r.items,
      // Not sent by the portal: ranking numbers for its "TOP15" rows, landscape cards for trailers
      isRanked: /\btop\s?\d+/i.test(r.name),
      isWide: /tr[aá]iler/i.test(r.name),
      isCollections: r.items.every(it => !!it.collectionId),
      portalRoot: target!.root
    }));
}

/** Portal root of a VOD tab (where its collection tiles and "Ver todo" open) */
export function portalRootForTab(selectedTab: TabId): BrowseRoot | undefined {
  return TAB_PORTAL_ROOT[selectedTab]?.root;
}

/** Hero carousel items for a VOD tab */
export function heroItemsForTab(selectedTab: TabId, data: TabRowsData): VodItem[] {
  const { featuredItems, movieItems, seriesItems, kidsItems, animeItems } = data;
  if (selectedTab === 'explorar') {
    // One title per platform row (Netfix, Disney+, Prime Video…)
    const heroes = (data.portalRows?.explorar || []).map(r => r.items[0]).filter(Boolean);
    return heroes.length ? heroes.slice(0, 8) : featuredItems.slice(0, 8);
  }
  if (selectedTab === 'peliculas') return movieItems.slice(0, 8);
  if (selectedTab === 'series') return seriesItems.slice(0, 8);
  if (selectedTab === 'kids') return kidsItems.slice(0, 8);
  if (selectedTab === 'anime') return animeItems.slice(0, 8);
  return featuredItems.slice(0, 8);
}

/**
 * "Seguir viendo" of a tab: what was left unfinished that belongs to it. Películas and Series by the kind of title;
 * Kids and Anime by the titles of that section; Destacados shows all. Explorar (platform rows) has none.
 */
function continueRow(selectedTab: TabId, data: TabRowsData): ContentRowDef | null {
  const history = data.historyItems || [];
  if (!history.length) return null;
  const idsOf = (list: VodItem[]) => new Set((list || []).map(it => String(it.id)));
  let items: HistoryItem[];
  if (selectedTab === 'destacados') items = history;
  else if (selectedTab === 'peliculas') items = history.filter(h => !h.series);
  else if (selectedTab === 'series') items = history.filter(h => h.series);
  else if (selectedTab === 'kids') { const ids = idsOf(data.kidsItems); items = history.filter(h => ids.has(String(h.id))); }
  else if (selectedTab === 'anime') { const ids = idsOf(data.animeItems); items = history.filter(h => ids.has(String(h.id))); }
  else return null;
  return items.length ? { id: 'history', title: 'Seguir viendo', type: 'history', items } : null;
}

/** Rows shown for a VOD tab (Apple TV+ hierarchy) */
export function buildTabRows(selectedTab: TabId, data: TabRowsData): ContentRowDef[] {
  const { historyItems, featuredItems, movieItems, seriesItems, kidsItems, animeItems, catalogRows } = data;
  const list: ContentRowDef[] = [];

  const portal = portalTabRows(selectedTab, data);
  if (portal.length > 0) {
    const resumeRow = continueRow(selectedTab, data);
    if (resumeRow) list.push(resumeRow);
    return list.concat(portal);
  }

  // Offline (no portal rows): rows composed by the app from the item lists
  if (selectedTab === 'destacados') {
    if (historyItems && historyItems.length > 0) {
      list.push({ id: 'history', title: 'Seguir viendo', type: 'history', items: historyItems });
    }
    if (seriesItems && seriesItems.length > 0) {
      list.push({
        id: 'top_series',
        title: 'Top 10: series en TizenXuper TV',
        type: 'vod',
        isRanked: true,
        items: seriesItems.slice(0, 10)
      });
    }
    if (movieItems && movieItems.length > 0) {
      list.push({
        id: 'top_movies',
        title: 'Top 10: películas en TizenXuper TV',
        type: 'vod',
        isRanked: true,
        items: movieItems.slice(0, 10)
      });
    }

    // Netflix Row
    const netflixItems = catalogRows['Netflix Series'] || catalogRows['Netflix Movie'];
    if (netflixItems && netflixItems.length > 0) {
      list.push({
        id: 'netflix_row',
        title: 'Netflix: Lo más visto',
        subtitle: 'Series y producciones exclusivas',
        type: 'vod',
        items: netflixItems
      });
    }

    if (seriesItems && seriesItems.length > 3) {
      list.push({
        id: 'featured_collection',
        title: 'Contra todo pronóstico',
        type: 'vod',
        isWide: true,
        items: seriesItems.slice(1, 13)
      });
    }

    if (movieItems && movieItems.length > 5) {
      list.push({
        id: 'must_watch',
        title: 'Éxitos imperdibles en TizenXuper TV',
        type: 'vod',
        items: movieItems.slice(10, 26)
      });
    }

    // HBO Row
    const hboItems = catalogRows['HBO Series'] || catalogRows['HBO Movie'];
    if (hboItems && hboItems.length > 0) {
      list.push({
        id: 'hbo_row',
        title: 'HBO: Éxitos aclamados',
        subtitle: 'Dramas y contenidos de prestigio',
        type: 'vod',
        items: hboItems
      });
    }

    // Disney+ Row
    const disneyItems = catalogRows['Disney Movie'] || catalogRows['Disney Series'];
    if (disneyItems && disneyItems.length > 0) {
      list.push({
        id: 'disney_row',
        title: 'Disney+: Magia y Aventura',
        type: 'vod',
        items: disneyItems
      });
    }

    // Trailers Row
    const trailerItems = catalogRows['Tráiler'];
    if (trailerItems && trailerItems.length > 0) {
      list.push({
        id: 'trailers_row',
        title: 'Avances y Tráilers Exclusivos',
        type: 'vod',
        isWide: true,
        items: trailerItems
      });
    }

    if (featuredItems && featuredItems.length > 0) {
      list.push({
        id: 'new_releases',
        title: 'Últimos estrenos en TizenXuper TV',
        type: 'vod',
        items: featuredItems.slice(0, 16)
      });
    }
  } else if (selectedTab === 'peliculas') {
    if (movieItems && movieItems.length > 0) {
      list.push({
        id: 'top_movies',
        title: 'Top 10: películas en TizenXuper TV',
        type: 'vod',
        isRanked: true,
        items: movieItems.slice(0, 10)
      });

      const netflixMovies = catalogRows['Netflix Movie'];
      if (netflixMovies && netflixMovies.length > 0) {
        list.push({
          id: 'netflix_movies',
          title: 'Netflix: Películas Destacadas',
          type: 'vod',
          items: netflixMovies
        });
      }

      const hboMovies = catalogRows['HBO Movie'];
      if (hboMovies && hboMovies.length > 0) {
        list.push({
          id: 'hbo_movies',
          title: 'HBO: Cine Seleccionado',
          type: 'vod',
          items: hboMovies
        });
      }

      const disneyMovies = catalogRows['Disney Movie'];
      if (disneyMovies && disneyMovies.length > 0) {
        list.push({
          id: 'disney_movies',
          title: 'Disney+: Grandes Películas',
          type: 'vod',
          items: disneyMovies
        });
      }

      const primeMovies = catalogRows['Prime Video Movie'] || catalogRows['Paramount + Movie'];
      if (primeMovies && primeMovies.length > 0) {
        list.push({
          id: 'prime_movies',
          title: 'Prime Video & Paramount+',
          type: 'vod',
          items: primeMovies
        });
      }

      list.push({
        id: 'movie_collection',
        title: 'Cine Seleccionado',
        type: 'vod',
        isWide: true,
        items: movieItems.slice(2, 10)
      });

      list.push({
        id: 'action_movies',
        title: 'Películas de Acción y Aventura',
        type: 'vod',
        items: movieItems.slice(5, 20)
      });

      const horrorItems = catalogRows['Horror'] || catalogRows['Se acerca Halloween'];
      if (horrorItems && horrorItems.length > 0) {
        list.push({
          id: 'horror_movies',
          title: 'Terror, Suspenso y Halloween',
          type: 'vod',
          items: horrorItems
        });
      }
    }
  } else if (selectedTab === 'series') {
    if (seriesItems && seriesItems.length > 0) {
      list.push({
        id: 'top_series',
        title: 'Top 10: series en TizenXuper TV',
        type: 'vod',
        isRanked: true,
        items: seriesItems.slice(0, 10)
      });

      const netflixSeries = catalogRows['Netflix Series'];
      if (netflixSeries && netflixSeries.length > 0) {
        list.push({
          id: 'netflix_series',
          title: 'Netflix: Series Originales',
          type: 'vod',
          items: netflixSeries
        });
      }

      const hboSeries = catalogRows['HBO Series'];
      if (hboSeries && hboSeries.length > 0) {
        list.push({
          id: 'hbo_series',
          title: 'HBO: Series Exclusivas',
          type: 'vod',
          items: hboSeries
        });
      }

      const disneySeries = catalogRows['Disney Series'];
      if (disneySeries && disneySeries.length > 0) {
        list.push({
          id: 'disney_series',
          title: 'Disney+: Series y Aventuras',
          type: 'vod',
          items: disneySeries
        });
      }

      const emmySeries = catalogRows['78.ª edición de los premios Primetime Emmy'];
      if (emmySeries && emmySeries.length > 0) {
        list.push({
          id: 'emmy_series',
          title: 'Series Premiadas en los Emmy',
          type: 'vod',
          items: emmySeries
        });
      }

      const telenovelas = catalogRows['Telenovelas'] || catalogRows['Serie Turquía'];
      if (telenovelas && telenovelas.length > 0) {
        list.push({
          id: 'telenovelas',
          title: 'Telenovelas y Series Internacionales',
          type: 'vod',
          items: telenovelas
        });
      }

      list.push({
        id: 'series_collection',
        title: 'Contra todo pronóstico',
        type: 'vod',
        isWide: true,
        items: seriesItems.slice(0, 10)
      });
    }
  } else if (selectedTab === 'kids') {
    const items = kidsItems.length > 0 ? kidsItems : movieItems.slice(0, 15);
    list.push({
      id: 'kids_top',
      title: 'Películas Infantiles y Familiares',
      type: 'vod',
      items: items.slice(0, 10)
    });

    const mickey = catalogRows['La aventura de Mickey'];
    if (mickey && mickey.length > 0) {
      list.push({
        id: 'mickey_aventuras',
        title: 'La aventura de Mickey y sus amigos',
        type: 'vod',
        items: mickey
      });
    }

    const marvelKids = catalogRows['Colección de Marvel'] || catalogRows['Los héroes atacan'];
    if (marvelKids && marvelKids.length > 0) {
      list.push({
        id: 'marvel_kids',
        title: 'Superhéroes y Marvel Kids',
        type: 'vod',
        items: marvelKids
      });
    }

    list.push({
      id: 'kids_magic',
      title: 'Aventuras Mágicas',
      type: 'vod',
      isWide: true,
      items: items.slice(2, 10)
    });

    const ninosFelices = catalogRows['Niños Felices'];
    if (ninosFelices && ninosFelices.length > 0) {
      list.push({
        id: 'ninos_felices',
        title: 'Niños Felices y Preescolar',
        type: 'vod',
        items: ninosFelices
      });
    }
  } else if (selectedTab === 'anime') {
    const items = animeItems.length > 0 ? animeItems : seriesItems.slice(0, 15);
    list.push({
      id: 'anime_top',
      title: 'Top 10: Anime en TizenXuper TV',
      type: 'vod',
      isRanked: true,
      items: items.slice(0, 10)
    });

    const dragonBall = catalogRows['Dragon Ball Collection'];
    if (dragonBall && dragonBall.length > 0) {
      list.push({
        id: 'dragon_ball',
        title: 'Dragon Ball: Colección Completa',
        type: 'vod',
        items: dragonBall
      });
    }

    const animeClasico = catalogRows['Anime Clásico'];
    if (animeClasico && animeClasico.length > 0) {
      list.push({
        id: 'anime_clasico',
        title: 'Anime Clásico y de Culto',
        type: 'vod',
        items: animeClasico
      });
    }

    const animeAsiatico = catalogRows['Anime Asiático'];
    if (animeAsiatico && animeAsiatico.length > 0) {
      list.push({
        id: 'anime_asiatico',
        title: 'Anime Asiático y Shonen',
        type: 'vod',
        items: animeAsiatico
      });
    }

    list.push({
      id: 'anime_collection',
      title: 'Colección Anime Exclusiva',
      type: 'vod',
      isWide: true,
      items: items.slice(2, 10)
    });
  } else if (selectedTab === 'explorar') {
    // The platform columns found in the saved catalog
    const platforms = ['Netflix Series', 'Netflix Movie', 'HBO Series', 'HBO Movie', 'Disney Series', 'Disney Movie',
      'Prime Video Series', 'Prime Video Movie', 'Apple TV+ Series', 'Apple TV+ Movie', 'Hulu Series', 'Hulu Movie',
      'Paramount + Series', 'Paramount + Movie'];
    platforms.forEach(name => {
      const items = catalogRows[name];
      if (items && items.length > 0) list.push({ id: `platform:${name}`, title: name, type: 'vod', items });
    });
  }

  // Offline rows of the other tabs also start with what was left unfinished (Destacados adds it above)
  if (selectedTab !== 'destacados') {
    const resumeRow = continueRow(selectedTab, data);
    if (resumeRow) list.unshift(resumeRow);
  }
  return list;
}

/** VOD rows (not history, not the ranked Top 10) end with a "Ver todo" card */
export function rowHasSeeAll(row: ContentRowDef | undefined): boolean {
  return !!row && row.type === 'vod' && !row.isRanked && !row.isCollections && row.items.length > 0;
}

// Row title words -> portal genre tag, so "Ver todo" opens already filtered
const TITLE_TAGS: [RegExp, string][] = [
  [/terror|miedo|halloween/i, 'Horror'],
  [/acci[oó]n/i, 'Action'],
  [/comedia|risa/i, 'Comedy'],
  [/romance|amor/i, 'Romance'],
  [/animaci[oó]n|animad/i, 'Animation'],
  [/ciencia ficci[oó]n|sci-?fi/i, 'Sci-Fi'],
  [/documental/i, 'Documentary'],
  [/crimen|polic/i, 'Crime'],
  [/drama/i, 'Drama'],
  [/aventura/i, 'Adventure'],
  [/familia/i, 'Family'],
  [/fantas[ií]a/i, 'Fantasy'],
  [/suspenso|thriller/i, 'Thriller']
];

// Portal column names that are genres (the home rows of each root)
const COLUMN_TAGS: Record<string, string> = {
  horror: 'Horror', terror: 'Horror', accion: 'Action', crimen: 'Crime', comedia: 'Comedy', familia: 'Family',
  fantastico: 'Fantasy', fantasia: 'Fantasy', historia: 'History', misterio: 'Mystery', romantico: 'Romance',
  romance: 'Romance', suspenso: 'Thriller', occidental: 'Western', 'ciencia ficcion': 'Sci-Fi', biografia: 'Biography',
  documental: 'Documentary', aventuras: 'Adventure', aventura: 'Adventure', animacion: 'Animation', drama: 'Drama'
};

function plain(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export interface BrowseTarget {
  root: BrowseRoot;
  tag?: string;
  year?: string;
  /** Portal column the row comes from, when it is not a genre or a year (e.g. "Netflix Movie") */
  column?: string;
}

/**
 * Where "Ver todo" of a row goes. The row's own portal column wins: a genre or year column opens
 * the section's full catalog with that filter; any other column (a platform, a curated list)
 * opens the titles of that column, since the portal has no full listing per column. Rows made by
 * the app (slices of a section) fall back to the genre or year in their title.
 */
export function browseTargetForRow(row: ContentRowDef, selectedTab: TabId): BrowseTarget {
  const items = row.items as VodItem[];
  let root: BrowseRoot;
  if (selectedTab === 'kids') root = 'kids';
  else if (selectedTab === 'anime') root = 'anime';
  else if (selectedTab === 'series') root = 'series';
  else if (selectedTab === 'peliculas') root = 'movies';
  else root = items.filter(it => it.isSeries).length > items.length / 2 ? 'series' : 'movies';

  // Portal column shared by most of the row's titles
  const counts: Record<string, number> = {};
  items.forEach(it => { if (it.row) counts[it.row] = (counts[it.row] || 0) + 1; });
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  if (top && counts[top] >= items.length * 0.6) {
    const tag = COLUMN_TAGS[plain(top)];
    const year = /\b(19|20)\d{2}\b/.exec(top);
    if (tag || year) return { root, tag, year: year ? year[0] : undefined };
    return { root, column: top };
  }

  const text = `${row.title} ${row.subtitle || ''}`;
  const tagHit = TITLE_TAGS.find(([re]) => re.test(text));
  const yearHit = /\b(19|20)\d{2}\b/.exec(text);
  return { root, tag: tagHit ? tagHit[1] : undefined, year: yearHit ? yearHit[0] : undefined };
}
