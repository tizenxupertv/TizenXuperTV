import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearPlaybackLog, eventsWithinBudget, hostOf, installErrorCapture, isIspBlockPage, logPlayback, playbackEvents, setPlaybackContext, usePlaybackStorage } from '../src/lib/playbackLog.ts';

test('hostOf keeps only the host: no path, query, tokens or credentials', () => {
  assert.equal(hostOf('http://niguof.vynbszicd.com/live/cyx_x7b.m3u8?token=SECRET'), 'niguof.vynbszicd.com');
  assert.equal(hostOf('https://user:pass@cdn.example.com:8443/a/b'), 'cdn.example.com:8443');
  assert.equal(hostOf(''), '');
  assert.equal(hostOf('not a url'), '');
});

test('events carry the current channel and the TV local time', () => {
  clearPlaybackLog();
  setPlaybackContext({ channel: 'ANTENA 3 HD', category: 'Ecuador', source: 'portal' });
  const at = new Date(2026, 10, 6, 16, 5).getTime();
  logPlayback({ kind: 'error', player: 'HLS.js', detail: 'networkError/fragLoadError 403', host: 'cdn.example.com' }, at);
  assert.deepEqual(playbackEvents(), [{
    at, local: '16:05', kind: 'error', player: 'HLS.js', channel: 'ANTENA 3 HD', category: 'Ecuador', source: 'portal',
    host: 'cdn.example.com', detail: 'networkError/fragLoadError 403'
  }]);
});

test('repeated stalls on one channel within 15 s count once; the log keeps the last 100 events', () => {
  clearPlaybackLog();
  setPlaybackContext({ channel: 'A' });
  logPlayback({ kind: 'stall' }, 1000);
  logPlayback({ kind: 'stall' }, 5000);
  logPlayback({ kind: 'stall' }, 17000);
  assert.equal(playbackEvents().length, 2);
  for (let i = 0; i < 130; i++) logPlayback({ kind: 'error', detail: String(i) }, 100000 + i);
  const events = playbackEvents();
  assert.equal(events.length, 100);
  assert.equal(events.at(-1)!.detail, '129');
});

test('ISP block pages are recognized by their text or by the host they redirect to', () => {
  assert.equal(isIspBlockPage('<p class="alerta">Este sitio web no se encuentra disponible desde las redes de Entel</p>', 'http://portalbloqueo.entel.cl/'), true);
  assert.equal(isIspBlockPage('<html>Sitio bloqueado por orden judicial</html>'), true);
  assert.equal(isIspBlockPage('', 'https://bloqueo.isp.example/aviso'), true);
  assert.equal(isIspBlockPage('#EXTM3U\n#EXT-X-VERSION:3', 'http://niguof.vynbszicd.com/live/a.m3u8'), false);
  assert.equal(isIspBlockPage('<html><title>404 Not Found</title></html>', 'http://cdn.example.com/x'), false);
});

function memoryStorage() {
  const data: Record<string, string> = {};
  return { data, getItem: (k: string) => (k in data ? data[k] : null), setItem: (k: string, v: string) => { data[k] = v; } };
}

test('the log survives an app restart (saved on the TV) and forgets events older than 3 days', () => {
  clearPlaybackLog();
  const storage = memoryStorage();
  usePlaybackStorage(storage);
  const now = Date.now();
  logPlayback({ kind: 'info', player: 'App', detail: 'inicio 1.13.1' }, now - 4 * 86400000);
  setPlaybackContext({ channel: 'The Running Man', category: 'Película' });
  logPlayback({ kind: 'error', player: 'AVPlay', detail: 'seek 35 s: InvalidStateError' }, now - 60000);
  // Restart: a fresh memory, the same storage
  clearPlaybackLog();
  assert.equal(playbackEvents().length, 0);
  usePlaybackStorage(storage);
  const events = playbackEvents();
  assert.equal(events.length, 1, 'the 4-day-old event is gone');
  assert.equal(events[0].channel, 'The Running Man');
  assert.equal(events[0].detail, 'seek 35 s: InvalidStateError');
  usePlaybackStorage(null);
  clearPlaybackLog();
});

test('links inside a detail keep only their host (no paths, tokens)', () => {
  clearPlaybackLog();
  logPlayback({ kind: 'error', player: 'JS', detail: 'Failed to load https://cdn.example.com/live/a.m3u8?token=SECRET at line 3' });
  assert.equal(playbackEvents()[0].detail, 'Failed to load cdn.example.com at line 3');
});

test('script errors and unhandled promise rejections are logged once a minute per message', () => {
  clearPlaybackLog();
  const handlers: Record<string, (e: any) => void> = {};
  installErrorCapture({ addEventListener: (type: string, fn: (e: any) => void) => { handlers[type] = fn; } });
  handlers.error({ message: "TypeError: Cannot read property 'x' of undefined", filename: 'https://app.local/assets/index-abc.js?v=1', lineno: 12, colno: 40 });
  handlers.error({ message: "TypeError: Cannot read property 'x' of undefined", filename: 'https://app.local/assets/index-abc.js?v=1', lineno: 12, colno: 40 });
  handlers.unhandledrejection({ reason: new Error('seek_timeout') });
  const events = playbackEvents();
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(e => [e.kind, e.player]), [['error', 'JS'], ['error', 'JS']]);
  assert.match(events[0].detail!, /Cannot read property 'x' of undefined · index-abc\.js:12/);
  assert.match(events[1].detail!, /promesa: seek_timeout/);
});

test('a report keeps the newest events that fit the size the server accepts', () => {
  const events = Array.from({ length: 100 }, (_, i) => ({ at: i, local: '10:00', kind: 'stall' as const, player: 'HLS.js', detail: `bufferStalledError ${i}`.padEnd(100, '.') }));
  const kept = eventsWithinBudget(events, 2000, 8000);
  assert.ok(kept.length > 10 && kept.length < 100);
  assert.equal(kept.at(-1)!.at, 99, 'the newest stay');
  assert.ok(JSON.stringify(kept).length + 2000 <= 8000);
  assert.equal(eventsWithinBudget(events.slice(0, 3), 0, 8000).length, 3);
});
