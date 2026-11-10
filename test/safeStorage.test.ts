import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropCaches, saveItem } from '../src/lib/safeStorage.ts';

/** A store that refuses to hold more than `quota` characters, like a full localStorage */
function limitedStorage(quota: number, initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  const size = (d: Record<string, string>) => Object.keys(d).reduce((n, k) => n + k.length + d[k].length, 0);
  return {
    data,
    get length() { return Object.keys(data).length; },
    key: (i: number) => Object.keys(data)[i] ?? null,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      const next = { ...data, [k]: v };
      if (size(next) > quota) throw new Error('QuotaExceededError');
      data[k] = v;
    },
    removeItem: (k: string) => { delete data[k]; }
  };
}

const PAGE = 'x'.repeat(400);

test('a save that fits is just saved', () => {
  const storage = limitedStorage(1000);
  assert.equal(saveItem('xuper_local_profile_v1', '{"history":[]}', storage), true);
  assert.equal(storage.data.xuper_local_profile_v1, '{"history":[]}');
});

test('with the store full, the channel caches make room for the history', () => {
  const storage = limitedStorage(1000, {
    xuper_magis_page_v1_76182_1_50: PAGE,
    xuper_magis_page_v1_76183_1_50: PAGE,
    xuper_tg_session_v1: 'token'
  });
  const profile = '{"history":[' + '"entry",'.repeat(40) + '"last"]}';
  assert.equal(saveItem('xuper_local_profile_v1', profile, storage), true);
  assert.equal(storage.data.xuper_local_profile_v1, profile);
  assert.equal(storage.data.xuper_tg_session_v1, 'token', 'what is not a cache is never dropped');
  assert.equal(Object.keys(storage.data).filter(k => k.indexOf('xuper_magis_page_v1_') === 0).length, 0);
});

test('then the playback log goes, and a save that still does not fit says so', () => {
  const storage = limitedStorage(600, { 'xuper.playbackLog.v1': 'l'.repeat(450), xuper_parental_v1: 'pin' });
  assert.equal(saveItem('xuper_local_profile_v1', 'p'.repeat(300), storage), true);
  assert.equal(storage.data['xuper.playbackLog.v1'], undefined);
  assert.equal(saveItem('xuper_live_favs_v1', 'f'.repeat(900), storage), false);
  assert.equal(storage.data.xuper_parental_v1, 'pin');
  assert.equal(storage.data.xuper_local_profile_v1, 'p'.repeat(300), 'what was saved before stays');
});

test('dropCaches removes only cache keys, and no storage is no save', () => {
  const storage = limitedStorage(5000, { xuper_magis_page_v1_1_1_50: PAGE, xuper_magis_cats_v1: 'cats', xuper_profiles_v1: 'p' });
  assert.equal(dropCaches(storage), 1);
  assert.deepEqual(Object.keys(storage.data).sort(), ['xuper_magis_cats_v1', 'xuper_profiles_v1']);
  assert.equal(saveItem('k', 'v', undefined), false);
});
