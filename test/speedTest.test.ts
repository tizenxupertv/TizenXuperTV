import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSpeed, median, runSpeedTest, SPEED_URL, streamingVerdict, toMbps } from '../src/lib/speedTest.ts';

/**
 * A fake line: `mbps` of bandwidth and `pingMs` per request, on a fake clock that only moves while bytes arrive.
 * Bodies come in 16 KB chunks and honour the abort signal like a real fetch does.
 */
function fakeLine(mbps: number, pingMs: number) {
  let clock = 0;
  const requested: number[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const bytes = Number(new URL(url).searchParams.get('bytes'));
    requested.push(bytes);
    clock += pingMs;
    let sent = 0;
    const signal = init && init.signal;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            if (sent >= bytes) return { done: true, value: undefined };
            const chunk = Math.min(16384, bytes - sent);
            sent += chunk;
            clock += (chunk * 8) / (mbps * 1000);
            return { done: false, value: new Uint8Array(chunk) };
          }
        })
      }
    } as unknown as Response;
  };
  return { fetchFn, now: () => clock, requested };
}

test('speed math and labels', () => {
  assert.equal(toMbps(1e6, 1000), 8);
  assert.equal(toMbps(1e6, 0), 0);
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([]), null);
  assert.equal(formatSpeed(4.26), '4.3 Mbps');
  assert.equal(formatSpeed(58.4), '58 Mbps');
  assert.equal(streamingVerdict(3).cls, 'bad');
  assert.equal(streamingVerdict(7).cls, 'warn');
  assert.equal(streamingVerdict(12).text, 'Suficiente para Full HD.');
  assert.equal(streamingVerdict(80).text, 'Suficiente para 4K.');
});

test('a fast line: latency from the pings after the first, downloads grow until one takes long enough', async () => {
  const line = fakeLine(40, 30);
  const phases: string[] = [];
  const r = await runSpeedTest({ fetchFn: line.fetchFn, now: line.now, onProgress: p => phases.push(p.phase) });
  assert.equal(r.latencyMs, 30);
  // 25 MB at 40 Mbps takes 5 s (plus the request): enough, so 50 MB is never asked for
  assert.deepEqual(line.requested, [0, 0, 0, 0, 0, 1e6, 5e6, 10e6, 25e6]);
  assert.ok(Math.abs(r.mbps - 40) < 0.5, `measured ${r.mbps}`);
  assert.equal(phases[0], 'latency');
  assert.ok(phases.includes('download'));
});

test('a slow line runs out of time inside a download and still measures it from what arrived', async () => {
  const line = fakeLine(0.5, 50);
  const r = await runSpeedTest({ fetchFn: line.fetchFn, now: line.now });
  // 1 MB at 0.5 Mbps would take 16 s: cut at the 15 s budget
  assert.deepEqual(line.requested, [0, 0, 0, 0, 0, 1e6]);
  assert.ok(line.now() < 15500, `ran ${line.now()} ms`);
  assert.ok(Math.abs(r.mbps - 0.5) < 0.05, `measured ${r.mbps}`);
});

test('a 1 Mbps line stops after the first download: 8 s already measures it', async () => {
  const line = fakeLine(1, 50);
  const r = await runSpeedTest({ fetchFn: line.fetchFn, now: line.now });
  assert.deepEqual(line.requested, [0, 0, 0, 0, 0, 1e6]);
  assert.ok(Math.abs(r.mbps - 1) < 0.1, `measured ${r.mbps}`);
});

test('the test URL asks Cloudflare for exact sizes; an HTTP error or leaving the screen fails the test', async () => {
  const urls: string[] = [];
  await assert.rejects(runSpeedTest({
    fetchFn: async (url: string) => { urls.push(url); return { ok: false, status: 429 } as unknown as Response; }
  }), /http 429/);
  assert.equal(urls[0], `${SPEED_URL}?bytes=0`);

  const line = fakeLine(20, 10);
  const left = new AbortController();
  left.abort();
  await assert.rejects(runSpeedTest({ fetchFn: line.fetchFn, now: line.now, signal: left.signal }), /aborted/);
});
