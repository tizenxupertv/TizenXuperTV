import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutFavorite, withoutHistory, withoutHistoryEntry } from '../src/lib/profileHistory.ts';

const profile = () => ({
  id: 'TV-12345678',
  createdAt: 1,
  favs: { 'm-1': true, 's-2': true } as Record<string, unknown>,
  history: [
    { id: 's-1', position: 300, watchedEpisodes: { e1: { position: 120 } } },
    { id: 'm-9', position: 50 }
  ]
});

test('clearing the history empties titles and progress but keeps favorites and the profile', () => {
  const original = profile();
  const cleared = withoutHistory(original);
  assert.deepEqual(cleared.history, []);
  assert.deepEqual(cleared.favs, original.favs);
  assert.equal(cleared.id, 'TV-12345678');
  assert.equal(original.history.length, 2, 'the original object is left as it was');
});

test('one title can be removed from the history, with its progress', () => {
  const result = withoutHistoryEntry(profile(), 's-1');
  assert.deepEqual(result.history.map(h => h.id), ['m-9']);
  assert.deepEqual(Object.keys(result.favs), ['m-1', 's-2']);
  // Ids may come as numbers
  assert.deepEqual(withoutHistoryEntry({ history: [{ id: 7 }, { id: 8 }] }, '7').history, [{ id: 8 }]);
});

test('one favorite can be removed and the history stays', () => {
  const original = profile();
  const result = withoutFavorite(original, 'm-1');
  assert.deepEqual(Object.keys(result.favs), ['s-2']);
  assert.equal(result.history.length, 2);
  assert.ok('m-1' in original.favs, 'the original object is left as it was');
});
