import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../src/lib/fetchTimeout.ts';

const never = <T>() => new Promise<T>(() => {});

test('an answer in time comes back with its status, address and body', async () => {
  const fetchFn: any = async (url: string) => ({ ok: true, status: 200, url: url + '/final', text: async () => 'hola', json: async () => ({ a: 1 }) });
  const res = await fetchWithTimeout('https://x.test/a', {}, 1000, fetchFn);
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.url, 'https://x.test/a/final');
  assert.equal(await res.text(), 'hola');
  const again = await fetchWithTimeout('https://x.test/a', {}, 1000, fetchFn);
  assert.deepEqual(await again.json(), { a: 1 });
});

test('a server that never answers is given up on, and the request is aborted', async () => {
  let aborted = false;
  const fetchFn: any = (_url: string, init: any) => {
    init.signal.addEventListener('abort', () => { aborted = true; });
    return never();
  };
  await assert.rejects(fetchWithTimeout('https://x.test/slow', {}, 30, fetchFn), /sin respuesta en 0 s/);
  assert.equal(aborted, true);
});

test('headers in time but a body that never ends is given up on too', async () => {
  const fetchFn: any = async () => ({ ok: true, status: 200, url: '', text: () => never<string>(), json: () => never() });
  const res = await fetchWithTimeout('https://x.test/half', {}, 30, fetchFn);
  await assert.rejects(res.text(), /sin respuesta/);
});

test('the caller keeps its own options and a network error passes through', async () => {
  let seen: any = null;
  const ok: any = async (_url: string, init: any) => { seen = init; return { ok: false, status: 503, url: '', text: async () => '', json: async () => null }; };
  const res = await fetchWithTimeout('https://x.test/b', { method: 'POST', headers: { Accept: 'application/json' } }, 1000, ok);
  assert.equal(res.status, 503);
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers.Accept, 'application/json');
  assert.ok(seen.signal, 'with the abort signal added');
  const failing: any = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(fetchWithTimeout('https://x.test/c', {}, 1000, failing), /Failed to fetch/);
});
