import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearPlaybackLog, hostOf, isIspBlockPage, logPlayback, playbackEvents, setPlaybackContext } from '../src/lib/playbackLog.ts';

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

test('repeated stalls on one channel within 15 s count once; the log keeps the last 40 events', () => {
  clearPlaybackLog();
  setPlaybackContext({ channel: 'A' });
  logPlayback({ kind: 'stall' }, 1000);
  logPlayback({ kind: 'stall' }, 5000);
  logPlayback({ kind: 'stall' }, 17000);
  assert.equal(playbackEvents().length, 2);
  for (let i = 0; i < 60; i++) logPlayback({ kind: 'error', detail: String(i) }, 100000 + i);
  const events = playbackEvents();
  assert.equal(events.length, 40);
  assert.equal(events.at(-1)!.detail, '59');
});

test('ISP block pages are recognized by their text or by the host they redirect to', () => {
  assert.equal(isIspBlockPage('<p class="alerta">Este sitio web no se encuentra disponible desde las redes de Entel</p>', 'http://portalbloqueo.entel.cl/'), true);
  assert.equal(isIspBlockPage('<html>Sitio bloqueado por orden judicial</html>'), true);
  assert.equal(isIspBlockPage('', 'https://bloqueo.isp.example/aviso'), true);
  assert.equal(isIspBlockPage('#EXTM3U\n#EXT-X-VERSION:3', 'http://niguof.vynbszicd.com/live/a.m3u8'), false);
  assert.equal(isIspBlockPage('<html><title>404 Not Found</title></html>', 'http://cdn.example.com/x'), false);
});
