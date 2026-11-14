import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCopy, buildCopy, hasUserData, readCopy } from '../src/lib/cloudBackup.ts';

function store(init: Record<string, string> = {}) {
  const data: Record<string, string> = { ...init };
  return { data, getItem: (k: string) => (k in data ? data[k] : null), setItem: (k: string, v: string) => { data[k] = v; } };
}

const PROFILES = JSON.stringify({ profiles: [{ id: 'principal', name: 'Julio' }, { id: 'pkids', name: 'Niños' }], active: 'principal' });
const LIST = JSON.stringify({ favorites: ['123'], history: [{ id: '9', title: 'Vikingos' }] });

test('buildCopy takes the profiles and each profile\'s keys, not the session or the backup copy', () => {
  const tv = store({
    xuper_profiles_v1: PROFILES,
    xuper_local_profile_v1: LIST,
    'xuper_local_profile_v1@pkids': '{"favorites":[]}',
    'xuper_live_favs_v1': '["c1"]',
    xuper_history_master_backup: LIST,
    xuper_account_session_v1: '{"token":"secret"}'
  });
  const copy = buildCopy(tv);
  assert.equal(copy.profiles, PROFILES);
  assert.deepEqual(Object.keys(copy.keys).sort(), ['xuper_live_favs_v1', 'xuper_local_profile_v1', 'xuper_local_profile_v1@pkids']);
});

test('hasUserData: a fresh install has none, a list or live favourites count', () => {
  assert.equal(hasUserData(store()), false);
  assert.equal(hasUserData(store({ xuper_local_profile_v1: '{"favorites":[],"history":[]}' })), false);
  assert.equal(hasUserData(store({ xuper_local_profile_v1: LIST })), true);
  assert.equal(hasUserData(store({ xuper_live_favs_v1: '["c1"]' })), true);
});

test('applyCopy fills an empty TV and never overwrites what the TV has', () => {
  const copy = buildCopy(store({ xuper_profiles_v1: PROFILES, xuper_local_profile_v1: LIST, 'xuper_local_profile_v1@pkids': '{"favorites":["7"]}' }));
  const fresh = store();
  assert.equal(applyCopy(fresh, copy), 3);
  assert.equal(fresh.data.xuper_local_profile_v1, LIST);
  assert.equal(fresh.data['xuper_local_profile_v1@pkids'], '{"favorites":["7"]}');
  const used = store({ xuper_local_profile_v1: '{"favorites":["1"]}' });
  applyCopy(used, copy);
  assert.equal(used.data.xuper_local_profile_v1, '{"favorites":["1"]}');
});

test('readCopy keeps only known keys of the copy\'s profiles', () => {
  const copy = readCopy({ v: 1, profiles: PROFILES, keys: { xuper_local_profile_v1: LIST, 'xuper_local_profile_v1@pother': 'x', xuper_account_session_v1: 'evil', xuper_live_favs_v1: 5 } });
  assert.deepEqual(Object.keys(copy!.keys), ['xuper_local_profile_v1']);
  assert.equal(readCopy({ v: 2, keys: {} }), null);
  assert.equal(readCopy(null), null);
});
