import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPersons,
  getPersonWorks,
  getChannelCatchup,
  getCatchupStreamUrl,
  getPortalColumns,
  getPortalColumnPage
} from '../src/services/catalogService.ts';

test('catalogService: getPersons fetches and separates directors and actors', async () => {
  // Mock window.MagisClient
  (globalThis as any).window = {
    MagisClient: {
      getPerson: (contentId: string, cb: Function) => {
        assert.equal(contentId, '12345');
        cb(null, {
          directors: [
            { puId: 'd1', name: 'Christopher Nolan', birthPlace: 'London', personType: 1 }
          ],
          actors: [
            { puId: 'a1', name: 'Leonardo DiCaprio', birthPlace: 'Los Angeles', personType: 2 }
          ]
        });
      }
    }
  };

  const res = await getPersons('12345');
  assert.equal(res.directors.length, 1);
  assert.equal(res.directors[0].name, 'Christopher Nolan');
  assert.equal(res.actors.length, 1);
  assert.equal(res.actors[0].name, 'Leonardo DiCaprio');
});

test('catalogService: getPersonWorks retrieves filmography list', async () => {
  (globalThis as any).window = {
    MagisClient: {
      getItemByPerson: (puId: string, pNum: number, pSize: number, cb: Function) => {
        assert.equal(puId, 'p_nolan');
        cb(null, {
          items: [
            { id: 'm1', name: 'Inception', score: '8.8', year: '2010' },
            { id: 'm2', name: 'Interstellar', score: '8.7', year: '2014' }
          ],
          total: 2
        });
      }
    }
  };

  const res = await getPersonWorks('p_nolan', 1, 20);
  assert.equal(res.total, 2);
  assert.equal(res.items.length, 2);
  assert.equal(res.items[0].title, 'Inception');
  assert.equal(res.items[1].title, 'Interstellar');
});

test('catalogService: getChannelCatchup and getCatchupStreamUrl retrieve BTV replay data', async () => {
  (globalThis as any).window = {
    MagisClient: {
      getAllbackProgram: (code: string, colId: number, pNum: number, pSize: number, cb: Function) => {
        assert.equal(code, 'espn_hd');
        cb(null, {
          programs: [
            { contentId: 'btv_1', name: 'SportsCenter', startTime: '20:00', endTime: '21:00' }
          ],
          total: 1
        });
      },
      startPlayBTV: (code: string, contentId: string, colId: number, cb: Function) => {
        assert.equal(contentId, 'btv_1');
        cb(null, {
          url: 'https://stream.server.tv/btv/replay_btv_1.m3u8'
        });
      }
    }
  };

  const catchup = await getChannelCatchup('espn_hd');
  assert.equal(catchup.total, 1);
  assert.equal(catchup.programs[0].name, 'SportsCenter');

  const url = await getCatchupStreamUrl('espn_hd', 'btv_1');
  assert.equal(url, 'https://stream.server.tv/btv/replay_btv_1.m3u8');
});

test('catalogService: local portal contract loads categories and a movie page', async () => {
  const requested: Array<{ kind: string; args: unknown[] }> = [];
  (globalThis as any).window = {
    MagisClient: {
      columns: (parentId: number, cb: Function) => {
        requested.push({ kind: 'columns', args: [parentId] });
        cb(null, [
          { id: 91001, code: 'movies-action', name: 'Acción', free: false, sequence: 1 },
          { id: 91002, code: 'movies-drama', name: 'Drama', free: false, sequence: 2 }
        ]);
      },
      columnPage: (columnId: number, pageNum: number, pageSize: number, cb: Function) => {
        requested.push({ kind: 'columnPage', args: [columnId, pageNum, pageSize] });
        assert.equal(columnId, 91001);
        assert.equal(pageNum, 1);
        assert.equal(pageSize, 24);
        cb(null, {
          total: 1,
          items: [{
            id: 'local-movie-1',
            name: 'Película de prueba',
            year: '2026',
            score: '8.0',
            genre: 'Action',
            poster: 'assets/placeholder_vertical.png'
          }]
        });
      }
    }
  };

  const columns = await getPortalColumns(91000);
  const page = await getPortalColumnPage(91001, 1, 24);

  assert.deepEqual(columns.map(column => column.name), ['Acción', 'Drama']);
  assert.equal(page.total, 1);
  assert.equal(page.items[0].title, 'Película de prueba');
  assert.equal(page.items[0].year, '2026');
  assert.deepEqual(requested.map(entry => entry.kind), ['columns', 'columnPage']);
});

test('heroItemsForTab: prioritizes official recommended hero items when available', async () => {
  const { heroItemsForTab } = await import('../src/app/tabRows.ts');

  const dummyCatalog: any = {
    historyItems: [],
    featuredItems: [{ id: 'f1', title: 'Fallback Featured' }],
    movieItems: [{ id: 'm1', title: 'Fallback Movie' }],
    seriesItems: [{ id: 's1', title: 'Fallback Series' }],
    kidsItems: [{ id: 'k1', title: 'Fallback Kids' }],
    animeItems: [{ id: 'a1', title: 'Fallback Anime' }],
    catalogRows: {},
    portalRows: {},
    heroByTab: {
      destacados: [
        { id: 'hero-rec-1', title: 'Estreno Exclusivo Destacados', tagline: 'Un thriller impactante' }
      ],
      peliculas: [
        { id: 'hero-mov-1', title: 'Película Hero Oficial', tagline: 'La más vista del mes' }
      ]
    }
  };

  // With heroByTab present for destacados
  const heroDestacados = heroItemsForTab('destacados', dummyCatalog);
  assert.equal(heroDestacados.length, 1);
  assert.equal(heroDestacados[0].id, 'hero-rec-1');
  assert.equal(heroDestacados[0].title, 'Estreno Exclusivo Destacados');

  // With heroByTab present for peliculas
  const heroPeliculas = heroItemsForTab('peliculas', dummyCatalog);
  assert.equal(heroPeliculas.length, 1);
  assert.equal(heroPeliculas[0].id, 'hero-mov-1');
  assert.equal(heroPeliculas[0].title, 'Película Hero Oficial');

  // For series where heroByTab is not populated, falls back to slicing catalog rows
  const heroSeries = heroItemsForTab('series', dummyCatalog);
  assert.equal(heroSeries.length, 1);
  assert.equal(heroSeries[0].id, 's1');
  assert.equal(heroSeries[0].title, 'Fallback Series');
});

test('catalogService: getFilteredPage for adult root tags items restricted and marks them private', async () => {
  const { getFilteredPage } = await import('../src/services/catalogService.ts');
  const { historyService } = await import('../src/services/historyService.ts');

  (globalThis as any).window = {
    MagisClient: {
      browse: (root: string, filters: any, pageNum: number, pageSize: number, cb: Function) => {
        assert.equal(root, 'adult');
        cb(null, {
          items: [
            { id: 'adult_item_1', contentId: 'adult_item_1', name: 'Item Adulto 1' }
          ],
          total: 1
        });
      }
    }
  };

  const page = await getFilteredPage('adult', { tags: '', year: '', originalCountry: '', audio: '' }, 1, 24);
  assert.equal(page.total, 1);
  assert.equal(page.items[0].id, 'adult_item_1');
  assert.equal(page.items[0].restricted, true);
  assert.equal(page.items[0].privateContent, true);
  assert.equal(page.items[0].category, 'adult');
  assert.equal(historyService.isRestricted(page.items[0]), true);
});

