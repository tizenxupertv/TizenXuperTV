/* Development-only catalog provider. Enable with ?localCatalogMock=1 while running Vite. */
(function (root) {
  'use strict';
  var params = new URLSearchParams(root.location && root.location.search || '');
  if (params.get('localCatalogMock') !== '1') return;

  var items = [
    { id: 'local-film-1', name: 'Horizonte local', year: '2026', score: '8.1', genre: 'Drama', category: 'movies', synopsis: 'Título de prueba para navegación local.' },
    { id: 'local-film-2', name: 'Ruta de acero', year: '2025', score: '7.6', genre: 'Action', category: 'movies', synopsis: 'Título de prueba para navegación local.' },
    { id: 'local-film-3', name: 'La última señal', year: '2024', score: '7.9', genre: 'Thriller', category: 'movies', synopsis: 'Título de prueba para navegación local.' },
    { id: 'local-series-1', name: 'Distrito nueve', year: '2026', score: '8.4', genre: 'Drama', category: 'series', type: 'series', synopsis: 'Serie de prueba para navegación local.' },
    { id: 'local-series-2', name: 'Código frontera', year: '2025', score: '8.0', genre: 'Crime', category: 'series', type: 'series', synopsis: 'Serie de prueba para navegación local.' },
    { id: 'local-kids-1', name: 'Club de inventos', year: '2025', score: '7.8', genre: 'Family', category: 'kids', synopsis: 'Contenido infantil de prueba.' },
    { id: 'local-anime-1', name: 'Luz de verano', year: '2026', score: '8.2', genre: 'Animation', category: 'anime', synopsis: 'Anime de prueba para navegación local.' }
  ];

  // The startup cache accepts a complete catalog only. Repeat the small fixture into a
  // realistic-sized deterministic set so local mode exercises the same path as production.
  var seedItems = items.slice();
  for (var copyIndex = 2; copyIndex <= 20; copyIndex++) {
    seedItems.forEach(function (item) {
      var clone = copy(item);
      clone.id = item.id + '-' + copyIndex;
      clone.name = item.name + ' ' + copyIndex;
      items.push(clone);
    });
  }

  var rootIds = { featured: 100, movies: 200, series: 300, kids: 400, anime: 500, free: 600, explorar: 700, search: 800 };
  var columns = {
    200: [{ id: 201, code: 'local-movies', name: 'Películas locales', free: false, sequence: 1 }],
    300: [{ id: 301, code: 'local-series', name: 'Series locales', free: false, sequence: 1 }],
    400: [{ id: 401, code: 'local-kids', name: 'Infantil local', free: false, sequence: 1 }],
    500: [{ id: 501, code: 'local-anime', name: 'Anime local', free: false, sequence: 1 }]
  };

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function async(callback, value) { setTimeout(function () { callback(null, copy(value)); }, 0); }
  function rootItems(name) {
    if (name === 'featured' || name === 'explorar' || name === 'free') return items;
    return items.filter(function (item) { return item.category === name; });
  }
  function itemsForColumn(columnId) {
    var lookup = { 201: 'movies', 301: 'series', 401: 'kids', 501: 'anime' };
    return rootItems(lookup[columnId] || 'movies');
  }

  root.MagisClient = {
    rootIds: rootIds,
    ensureSession: function (callback) { async(callback, { ready: true, mode: 'local-mock' }); },
    home: function (name, _page, callback) { async(callback, { root: name, pageNum: 1, items: rootItems(name) }); },
    getHome: function (callback) { async(callback, { homeBlockList: [{ assetList: items }] }); },
    columns: function (parentId, callback) { async(callback, columns[parentId] || []); },
    columnPage: function (columnId, pageNum, pageSize, callback) {
      var list = itemsForColumn(Number(columnId));
      var start = (Math.max(1, Number(pageNum) || 1) - 1) * Math.max(1, Number(pageSize) || 24);
      async(callback, { items: list.slice(start, start + pageSize), total: list.length });
    },
    search: function (query, pageNum, pageSize, callback) {
      var text = String(query || '').toLowerCase();
      var list = items.filter(function (item) { return item.name.toLowerCase().indexOf(text) !== -1; });
      var start = (Math.max(1, Number(pageNum) || 1) - 1) * Math.max(1, Number(pageSize) || 24);
      async(callback, { items: list.slice(start, start + pageSize), total: list.length });
    },
    getItemData: function (id, callback) {
      var item = items.filter(function (candidate) { return candidate.id === String(id); })[0] || null;
      async(callback, item);
    }
  };
})(window);
