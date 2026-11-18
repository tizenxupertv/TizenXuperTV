import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerValue, directHlsPlayer, directStreamMeta } from '../src/lib/directLink.ts';

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.97 Safari/537.36 CrKey/1.44.191160';

test('headerValue: any case, empty when missing', () => {
  assert.equal(headerValue({ referer: 'https://teveo.cu/' }, 'Referer'), 'https://teveo.cu/');
  assert.equal(headerValue({ 'User-Agent': ua }, 'user-agent'), ua);
  assert.equal(headerValue({ Referer: '' }, 'Referer'), '');
  assert.equal(headerValue(undefined, 'Referer'), '');
  assert.equal(headerValue(null, 'Referer'), '');
});

test('directHlsPlayer: AVPlay only for a link that asks for its own User-Agent on the TV', () => {
  assert.equal(directHlsPlayer({ 'User-Agent': ua }, true), 'avplay');
  assert.equal(directHlsPlayer({ 'User-Agent': ua, Referer: 'https://player.instantvideocloud.net/' }, true), 'avplay');
});

test('directHlsPlayer: a Referer alone stays on hls.js (AVPlay cannot send it either)', () => {
  assert.equal(directHlsPlayer({ Referer: 'https://www.teleyucatan.gob.mx/' }, true), 'hls');
  assert.equal(directHlsPlayer(undefined, true), 'hls');
});

test('directHlsPlayer: a desktop browser always uses hls.js (its proxy sends every header)', () => {
  assert.equal(directHlsPlayer({ 'User-Agent': ua }, false), 'hls');
});

test('directStreamMeta: marks the link as direct and never carries empty headers', () => {
  assert.deepEqual(directStreamMeta('https://a.tv/x.m3u8', undefined), { url: 'https://a.tv/x.m3u8', direct: true });
  assert.deepEqual(directStreamMeta('https://a.tv/x.m3u8', {}), { url: 'https://a.tv/x.m3u8', direct: true });
  assert.deepEqual(directStreamMeta('https://a.tv/x.m3u8', { Referer: 'https://a.tv/' }), {
    url: 'https://a.tv/x.m3u8',
    headers: { Referer: 'https://a.tv/' },
    direct: true
  });
});
