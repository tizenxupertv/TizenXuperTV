import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfileStore, displayName, keyFor, MAX_PROFILES, PROFILES_KEY } from '../src/lib/localProfiles.ts';

function memory(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; }
  };
}

test('a TV without profiles has only "Principal", which keeps the original keys', () => {
  const store = createProfileStore(memory(), memory());
  assert.deepEqual(store.list().map(p => p.name), ['Principal']);
  assert.equal(store.key('xuper_local_profile_v1'), 'xuper_local_profile_v1');
  assert.equal(store.needsPicker(), false);
});

test('other profiles keep their data under their own keys', () => {
  const local = memory();
  const store = createProfileStore(local, memory());
  const ana = store.create('ana maría')!;
  assert.equal(ana.name, 'Ana María');
  assert.ok(store.select(ana.id));
  const reloaded = createProfileStore(local, memory());
  assert.equal(reloaded.active().id, ana.id);
  assert.equal(reloaded.key('xuper_hidden_tabs'), `xuper_hidden_tabs@${ana.id}`);
});

test('the picker shows with two or more profiles, once per launch', () => {
  const local = memory();
  const session = memory();
  const store = createProfileStore(local, session);
  store.create('Luis');
  assert.equal(store.needsPicker(), true);
  store.markChosen();
  assert.equal(createProfileStore(local, session).needsPicker(), false, 'the reload after a switch does not ask again');
  assert.equal(createProfileStore(local, memory()).needsPicker(), true, 'the next launch asks again');
});

test('deleting a profile removes its data and falls back to "Principal"', () => {
  const local = memory();
  const store = createProfileStore(local, memory());
  const luis = store.create('Luis')!;
  store.select(luis.id);
  local.setItem(keyFor('xuper_local_profile_v1', luis.id), '{"history":[]}');
  local.setItem('xuper_local_profile_v1', '{"history":[1]}');
  assert.ok(store.remove(luis.id));
  assert.equal(store.active().id, 'principal');
  assert.equal(local.getItem(keyFor('xuper_local_profile_v1', luis.id)), null);
  assert.equal(local.getItem('xuper_local_profile_v1'), '{"history":[1]}', 'the main profile keeps its data');
  assert.equal(store.remove('principal'), false, 'the main profile cannot be deleted');
});

test('at most six profiles, with clean names', () => {
  const store = createProfileStore(memory(), memory());
  for (let i = 0; i < 10; i++) store.create(`perfil ${i}`);
  assert.equal(store.list().length, MAX_PROFILES);
  assert.equal(store.create('otro'), null);
  assert.equal(displayName('  \u0007hola   mundo con un nombre largo '), 'Hola Mundo Con U');
  assert.equal(store.rename('principal', '   '), false);
});

test('damaged saved data still gives a usable list', () => {
  const store = createProfileStore(memory({ [PROFILES_KEY]: '{"profiles":[{"id":"../x","name":"Bad"},{"id":"pabc","name":"Eva"}],"active":"nope"}' }), memory());
  assert.deepEqual(store.list().map(p => p.name), ['Principal', 'Eva']);
  assert.equal(store.active().id, 'principal');
});

test('on start, data left by deleted profiles is removed', () => {
  const local = memory({
    [PROFILES_KEY]: '{"profiles":[{"id":"principal","name":"Principal"},{"id":"pkeep","name":"Eva"}],"active":"principal"}',
    'xuper_local_profile_v1@pgone': '{}',
    'xuper_local_profile_v1@pkeep': '{}',
    'xuper_local_profile_v1': '{}',
    'other@pgone': 'x'
  });
  createProfileStore(local, memory(), () => Object.keys(local.data));
  assert.deepEqual(Object.keys(local.data).sort(), [PROFILES_KEY, 'other@pgone', 'xuper_local_profile_v1', 'xuper_local_profile_v1@pkeep'].sort());
});
