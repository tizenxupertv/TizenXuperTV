import { test } from 'node:test';
import assert from 'node:assert/strict';

// A browser-like localStorage, in place before the services load (they read it at import time)
const data: Record<string, string> = {};
let writes = 0;
const storage = {
  get length() { return Object.keys(data).length; },
  key: (i: number) => Object.keys(data)[i] ?? null,
  getItem: (k: string) => (k in data ? data[k] : null),
  setItem: (k: string, v: string) => { writes++; data[k] = String(v); },
  removeItem: (k: string) => { delete data[k]; }
};
(globalThis as any).localStorage = storage;
(globalThis as any).window = { localStorage: storage, addEventListener() {} };

const PROFILE = 'xuper_local_profile_v1';
const BACKUP = 'xuper_history_master_backup';
const entry = (id: string, updatedAt: number) => ({ id, title: 'Título ' + id, position: 600, duration: 6000, updatedAt });
const seed = (profile: object, backup?: object) => {
  Object.keys(data).forEach(k => delete data[k]);
  data[PROFILE] = JSON.stringify(profile);
  if (backup) data[BACKUP] = JSON.stringify(backup);
};
const ids = (list: Array<{ id: string }>) => list.map(h => h.id);

const { historyService } = await import('../src/services/historyService.ts');
const { favoritesService } = await import('../src/services/favoritesService.ts');
/** What the next start of the app does */
const restart = () => historyService.mergeAllHistories();

test('a title removed from the history stays removed after a restart', () => {
  const profile = { id: 'TV-1', history: [entry('a', 2), entry('b', 1)], favs: {} };
  seed(profile, profile);
  restart();
  assert.deepEqual(ids(historyService.getHistory()), ['a', 'b']);
  assert.equal(historyService.removeEntry('a'), true);
  restart();
  assert.deepEqual(ids(historyService.getHistory()), ['b'], 'the backup copy must not bring it back');
});

test('clearing the history is not undone by the backup copy', () => {
  const profile = { id: 'TV-1', history: [entry('a', 2), entry('b', 1)], favs: { f1: true } };
  seed(profile, profile);
  restart();
  assert.equal(historyService.clearHistory(), true);
  restart();
  assert.deepEqual(historyService.getHistory(), []);
  assert.equal(favoritesService.isFavorite('f1'), true, 'favourites stay');
});

test('a favourite removed stays removed after a restart', () => {
  const profile = { id: 'TV-1', history: [entry('a', 1)], favs: { f1: true, f2: true } };
  seed(profile, profile);
  restart();
  assert.equal(favoritesService.toggleFavorite('f1'), false);
  assert.equal(favoritesService.removeFavorite('f2'), true);
  restart();
  assert.deepEqual(favoritesService.getFavoriteIds(), []);
});

test('a backup copy left by another profile is not merged into this one', () => {
  seed({ id: 'TV-1', history: [entry('mine', 5)], favs: {} }, { id: 'TV-2', history: [entry('theirs', 9)], favs: { theirFav: true } });
  restart();
  assert.deepEqual(ids(historyService.getHistory()), ['mine']);
  assert.deepEqual(favoritesService.getFavoriteIds(), []);
  assert.equal(JSON.parse(data[BACKUP]).id, 'TV-1', 'the copy belongs to this profile from now on');
});

test('a profile whose key was lost gets its history back from the copy', () => {
  seed({}, { id: 'TV-1', history: [entry('a', 2), entry('b', 1)], favs: { f1: true } });
  delete data[PROFILE];
  restart();
  assert.deepEqual(ids(historyService.getHistory()), ['a', 'b']);
  assert.equal(favoritesService.isFavorite('f1'), true);
});

test('newer progress in the copy wins, and a start with nothing to merge writes nothing', () => {
  seed({ id: 'TV-1', history: [entry('a', 1)], favs: {} }, { id: 'TV-1', history: [{ ...entry('a', 7), position: 1200 }], favs: {} });
  restart();
  assert.equal(historyService.getHistory()[0].position, 1200);
  writes = 0;
  restart();
  assert.equal(writes, 0);
});
