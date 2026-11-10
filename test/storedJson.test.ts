import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStoredJson } from '../src/lib/storedJson.ts';

function fakeStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  let reads = 0;
  return {
    data,
    get reads() { return reads; },
    getItem(key: string): string | null {
      reads++;
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    }
  };
}

test('a stored value is parsed once and the same object comes back while its text does not change', () => {
  const storage = fakeStorage({ profile: '{"history":[{"id":"a","position":120}]}' });
  const first = readStoredJson('profile', storage);
  const second = readStoredJson('profile', storage);
  assert.deepEqual(first, { history: [{ id: 'a', position: 120 }] });
  assert.equal(second, first, 'same object: not parsed again');
  assert.equal(second.history[0], first.history[0], 'so are its entries (memoized screens see no change)');
  assert.equal(storage.reads, 2, 'the text is still read every time');
});

test('a write by any other code is seen on the next read', () => {
  const storage = fakeStorage({ profile: '{"history":[]}' });
  const before = readStoredJson('profile', storage);
  storage.data.profile = '{"history":[{"id":"b"}]}';
  const after = readStoredJson('profile', storage);
  assert.notEqual(after, before);
  assert.deepEqual(after, { history: [{ id: 'b' }] });
  // Back to the first text: parsed again, never a stale object from two writes ago
  storage.data.profile = '{"history":[]}';
  assert.deepEqual(readStoredJson('profile', storage), { history: [] });
});

test('a missing key, broken JSON or blocked storage read as null', () => {
  const storage = fakeStorage({ broken: '{"history":' });
  assert.equal(readStoredJson('missing', storage), null);
  assert.equal(readStoredJson('broken', storage), null);
  assert.equal(readStoredJson('any', { getItem() { throw new Error('blocked'); } }), null);
  assert.equal(readStoredJson('any', undefined), null);
  // A key that disappears stops answering with its old value
  const gone = fakeStorage({ k: '{"a":1}' });
  assert.deepEqual(readStoredJson('k', gone), { a: 1 });
  delete gone.data.k;
  assert.equal(readStoredJson('k', gone), null);
});

test('keys do not share values', () => {
  const storage = fakeStorage({ a: '{"n":1}', b: '{"n":1}' });
  assert.notEqual(readStoredJson('a', storage), readStoredJson('b', storage));
});
