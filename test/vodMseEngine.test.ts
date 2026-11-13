import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVodPlaylist, canPlayVodWithMse, cdnHeaders, fileAudioLanguages, indexDuration, mseHlsConfig, mseSourceAt, mseSourceCount, mseUnsupportedReason, MSE_PLAYLIST_URL, playlistLoader, wantedAudioIndex, VOD_ENGINE_KEY } from '../src/lib/vodMseEngine.ts';
import { makeIdxg } from './helpers/idxg.ts';

/** A TV window: MSE plays the given types, hls.js and the bridge factory are there */
function tvWindow(supported: string[], extra: Record<string, unknown> = {}): any {
  const store: Record<string, string> = {};
  return {
    MediaSource: { isTypeSupported: (t: string) => supported.includes(t) },
    Hls: { isSupported: () => true },
    __xuperCreateHls: () => ({}),
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
    ...extra
  };
}

const HEVC = 'video/mp4; codecs="hvc1.1.6.L120.90"';
const AVC = 'video/mp4; codecs="avc1.640028"';
const tsTitle = { url: 'https://cdn.example/vod/1_media.ts', idxUrl: 'https://cdn.example/vod/1_idx.idxg', mime: 'video/mp2t', codec: 'H265' };

test('MSE is used only for indexed .ts titles whose video codec the TV plays through MSE', () => {
  assert.equal(canPlayVodWithMse(tsTitle, tvWindow([HEVC])), true);
  assert.equal(canPlayVodWithMse({ ...tsTitle, codec: 'H264' }, tvWindow([AVC])), true);
  assert.equal(canPlayVodWithMse(tsTitle, tvWindow([AVC])), false, 'HEVC title on a TV without HEVC in MSE');
  assert.equal(canPlayVodWithMse({ ...tsTitle, idxUrl: undefined }, tvWindow([HEVC])), false, 'no index');
  assert.equal(canPlayVodWithMse({ ...tsTitle, mime: 'video/mp4' }, tvWindow([HEVC])), false, 'not MPEG-TS');
  assert.equal(canPlayVodWithMse(tsTitle, tvWindow([HEVC], { MediaSource: undefined })), false, 'no MSE');
  assert.equal(canPlayVodWithMse(tsTitle, tvWindow([HEVC], { __xuperCreateHls: undefined })), false, 'no hls factory');
});

test('the report says why a title does not use MSE', () => {
  assert.equal(mseUnsupportedReason(tsTitle, tvWindow([HEVC])), '');
  assert.equal(mseUnsupportedReason({ ...tsTitle, idxUrl: undefined }, tvWindow([HEVC])), 'sin índice .idxg');
  assert.equal(mseUnsupportedReason({ ...tsTitle, mime: 'video/mp4' }, tvWindow([HEVC])), 'formato video/mp4');
  assert.equal(mseUnsupportedReason(tsTitle, tvWindow([AVC])), 'MSE no decodifica HEVC');
  assert.equal(mseUnsupportedReason(tsTitle, tvWindow([HEVC], { MediaSource: undefined })), 'sin MediaSource');
  assert.equal(mseUnsupportedReason(tsTitle, tvWindow([HEVC], { __xuperCreateHls: undefined })), 'sin hls.js');
  const off = tvWindow([HEVC]);
  off.localStorage.setItem(VOD_ENGINE_KEY, 'avplay');
  assert.equal(mseUnsupportedReason(tsTitle, off), 'desactivado en esta TV');
});

test('the localStorage switch turns MSE off on a TV where it misbehaves', () => {
  const w = tvWindow([HEVC]);
  w.localStorage.setItem(VOD_ENGINE_KEY, 'avplay');
  assert.equal(canPlayVodWithMse(tsTitle, w), false);
});

test('the audio MSE plays is the first one in the wanted language, or the first of the file when it has none', () => {
  const wants = (code: string) => (lang: string) => lang === code;
  assert.deepEqual(fileAudioLanguages('spa, eng'), ['spa', 'eng']);
  assert.deepEqual(fileAudioLanguages(undefined), []);
  assert.equal(wantedAudioIndex('spa,eng', wants('spa')), 0);
  assert.equal(wantedAudioIndex('spa,eng', wants('eng')), 1);
  assert.equal(wantedAudioIndex('spa,spa,spa,spa,eng', wants('eng')), 4);
  assert.equal(wantedAudioIndex('spa,eng', wants('por')), 0, 'not in the file');
  assert.equal(wantedAudioIndex(undefined, wants('spa')), 0);
});

test('a fragment loader is added only when the wanted audio is not the first one', () => {
  class FakeLoader { load() {} }
  const Hls = { DefaultConfig: { loader: FakeLoader } };
  assert.equal('fLoader' in mseHlsConfig(Hls, '#EXTM3U', 0), false);
  assert.equal('fLoader' in mseHlsConfig(Hls, '#EXTM3U', 0, 0), false);
  assert.equal(typeof mseHlsConfig(Hls, '#EXTM3U', 0, 1).fLoader, 'function');
});

test('only the headers the CDN checks are sent (User-Agent cannot be set from a page)', () => {
  assert.deepEqual(
    cdnHeaders({ 'Content-Auth': 'a', 'Content-License': 'l', 'User-Agent': 'ua', App: 'x', 'App-Version': '1' }),
    { 'Content-Auth': 'a', 'Content-License': 'l', App: 'x', 'App-Version': '1' }
  );
});

test('the index becomes a byte-range playlist of ~6 s pieces, the size in its header closing the last one', async () => {
  // Twelve 1 s entries of 188 * 1000 bytes
  const entries = Array.from({ length: 12 }, (_, i) => ({ off: i * 188000, ts: i * 1000 }));
  const index = makeIdxg(entries, { total: 12 * 188000, durationMs: 12000 });
  const requests: Array<{ url: string; headers: any }> = [];
  const fetchFn: any = async (url: string, init: any) => {
    requests.push({ url, headers: init.headers });
    return { ok: true, status: 200, arrayBuffer: async () => index.buffer, headers: { get: () => null } };
  };
  const res = await buildVodPlaylist({ ...tsTitle, headers: { 'Content-Auth': 'tok', 'User-Agent': 'ua' } }, fetchFn);
  assert.equal(res.pieces, 2);
  assert.equal(Math.round(res.duration), 12);
  assert.match(res.playlist, /#EXT-X-BYTERANGE:1128000@0\n/);
  assert.match(res.playlist, /#EXT-X-BYTERANGE:1128000@1128000\n/);
  assert.match(res.playlist, /#EXT-X-ENDLIST/);
  // One request, for the index: the media file is not asked for its size
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, tsTitle.idxUrl);
  assert.equal(requests[0].headers['Content-Auth'], 'tok');
  assert.equal(requests[0].headers['User-Agent'], undefined);
});

test('the duration of a title comes from its index, for AVPlay on TVs that report none', async () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({ off: i * 188000, ts: i * 1000 }));
  const index = makeIdxg(entries, { total: 12 * 188000, durationMs: 11500 });
  const ok: any = async () => ({ ok: true, status: 200, arrayBuffer: async () => index.buffer, headers: { get: () => null } });
  assert.equal(Math.round((await indexDuration(tsTitle, ok)) * 1000), 11500);
  // No index, an index that is not there, or bytes that are not one: no duration, never an error
  const missing: any = async () => ({ ok: false, status: 404, headers: { get: () => null } });
  const garbage: any = async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array(300).buffer, headers: { get: () => null } });
  assert.equal(await indexDuration(tsTitle, missing), 0);
  assert.equal(await indexDuration(tsTitle, garbage), 0);
  assert.equal(await indexDuration({ ...tsTitle, idxUrl: undefined }, ok), 0);
});

test('a missing index is an error the player turns into the AVPlay fallback', async () => {
  const fetchFn: any = async (url: string) =>
    url.endsWith('.idxg') ? { ok: false, status: 404, headers: { get: () => null } } : { ok: true, status: 206, headers: { get: () => null } };
  await assert.rejects(buildVodPlaylist(tsTitle, fetchFn), /índice HTTP 404/);
});

test('the playlist loader answers the generated playlist from memory with hls.js 1.x load stats', async () => {
  class FakeXhrLoader {
    stats = { loading: { start: 0, first: 0, end: 0 }, loaded: 0, total: 0 };
    loaded: string[] = [];
    load(context: any) { this.loaded.push(context.url); }
  }
  const Loader = playlistLoader({ DefaultConfig: { loader: FakeXhrLoader } }, '#EXTM3U\n');
  const loader: any = new Loader();
  const got: any = await new Promise(resolve => {
    loader.load({ url: MSE_PLAYLIST_URL }, {}, { onSuccess: (response: any, stats: any) => resolve({ response, stats }) });
  });
  assert.equal(got.response.data, '#EXTM3U\n');
  assert.ok(got.stats.loading.end > 0);
  assert.equal(got.stats.total, 8);
  loader.load({ url: 'https://cdn.example/vod/1_media.ts' }, {}, {});
  assert.deepEqual(loader.loaded, ['https://cdn.example/vod/1_media.ts']);
});

test('resume goes in the hls.js start position; a short offset starts from the beginning', () => {
  const Hls = { DefaultConfig: { loader: class {} } };
  assert.equal(mseHlsConfig(Hls, '', 1234).startPosition, 1234);
  assert.equal(mseHlsConfig(Hls, '', 3).startPosition, -1);
  assert.equal(mseHlsConfig(Hls, '', 0).backBufferLength, 20);
});

const withBackups = {
  ...tsTitle,
  url: 'https://a.cdn/vod/x_media.ts',
  idxUrl: 'https://a.cdn/vod/x_idx.idxg',
  headers: { 'Content-Auth': 'auth-a' },
  backupUrls: [
    { url: 'https://b.cdn/vod/x_media.ts', idxUrl: 'https://b.cdn/vod/x_idx.idxg', headers: { 'Content-Auth': 'auth-b' } },
    { url: 'https://c.cdn/vod/x_media.ts', idxUrl: 'https://c.cdn/vod/x_idx.idxg', headers: { 'Content-Auth': 'auth-c' } }
  ]
};

test('mseSourceAt: the title moved to its n-th CDN, the later ones left as its backups', () => {
  assert.equal(mseSourceAt(withBackups, 0), withBackups);
  const b: any = mseSourceAt(withBackups, 1);
  assert.equal(b.url, 'https://b.cdn/vod/x_media.ts');
  assert.equal(b.idxUrl, 'https://b.cdn/vod/x_idx.idxg');
  assert.deepEqual(b.headers, { 'Content-Auth': 'auth-b' });
  assert.equal(b.backupUrls.length, 1);
  assert.equal(b.mime, tsTitle.mime);
  assert.equal(mseSourceAt(withBackups, 3), null);
  // A backup without its own headers keeps the title's
  const plain: any = mseSourceAt({ ...withBackups, backupUrls: [{ url: 'https://d.cdn/m.ts', idxUrl: 'https://d.cdn/i.idxg' }] }, 1);
  assert.deepEqual(plain.headers, { 'Content-Auth': 'auth-a' });
  assert.equal(mseSourceCount(withBackups), 3);
  assert.equal(mseSourceCount(tsTitle), 1);
});

test('an index the main CDN does not have is read from a backup, whose media and headers the playlist then uses', async () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({ off: i * 188000, ts: i * 1000 }));
  const index = makeIdxg(entries, { total: 12 * 188000, durationMs: 12000 });
  const asked: Array<{ url: string; auth: string }> = [];
  const fetchFn: any = async (url: string, init: any) => {
    asked.push({ url, auth: init.headers['Content-Auth'] });
    if (url.startsWith('https://a.cdn')) return { ok: false, status: 404, headers: { get: () => null } };
    if (url.startsWith('https://b.cdn')) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(300).buffer, headers: { get: () => null } };
    return { ok: true, status: 200, arrayBuffer: async () => index.buffer, headers: { get: () => null } };
  };
  const res = await buildVodPlaylist(withBackups, fetchFn);
  assert.equal(res.skipped, 2);
  assert.match(res.playlist, /https:\/\/c\.cdn\/vod\/x_media\.ts/);
  assert.deepEqual(asked.map(a => a.auth), ['auth-a', 'auth-b', 'auth-c']);
});

test('when no CDN has the index, the error says what the main one answered and how many were tried', async () => {
  const fetchFn: any = async () => ({ ok: false, status: 404, headers: { get: () => null } });
  await assert.rejects(buildVodPlaylist(withBackups, fetchFn), /índice HTTP 404 \(3 CDN\)/);
});
