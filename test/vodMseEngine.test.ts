import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVodPlaylist, canPlayVodWithMse, cdnHeaders, mseHlsConfig, MSE_PLAYLIST_URL, playlistLoader, VOD_ENGINE_KEY } from '../src/lib/vodMseEngine.ts';

/** `.idxg` index like the portal's: magic, file name, then 12-byte entries (u64 offset, u32 ms) */
function idxg(entries: Array<{ off: number; ts: number }>): Uint8Array {
  const tableStart = 48;
  const buf = new Uint8Array(tableStart + entries.length * 12);
  buf[4] = 0x69; buf[5] = 0x64; buf[6] = 0x78; buf[7] = 0x67;
  const view = new DataView(buf.buffer);
  entries.forEach((e, i) => {
    const pos = tableStart + i * 12;
    view.setUint32(pos, Math.floor(e.off / 4294967296), false);
    view.setUint32(pos + 4, e.off >>> 0, false);
    view.setUint32(pos + 8, e.ts, false);
  });
  return buf;
}

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

test('the localStorage switch turns MSE off on a TV where it misbehaves', () => {
  const w = tvWindow([HEVC]);
  w.localStorage.setItem(VOD_ENGINE_KEY, 'avplay');
  assert.equal(canPlayVodWithMse(tsTitle, w), false);
});

test('only the headers the CDN checks are sent (User-Agent cannot be set from a page)', () => {
  assert.deepEqual(
    cdnHeaders({ 'Content-Auth': 'a', 'Content-License': 'l', 'User-Agent': 'ua', App: 'x', 'App-Version': '1' }),
    { 'Content-Auth': 'a', 'Content-License': 'l', App: 'x', 'App-Version': '1' }
  );
});

test('the index becomes a byte-range playlist of ~6 s pieces, the file size closing the last one', async () => {
  // Twelve 1 s entries of 188 * 1000 bytes
  const entries = Array.from({ length: 12 }, (_, i) => ({ off: i * 188000, ts: i * 1000 }));
  const size = 12 * 188000;
  const requests: Array<{ url: string; headers: any }> = [];
  const fetchFn: any = async (url: string, init: any) => {
    requests.push({ url, headers: init.headers });
    if (url.endsWith('.idxg')) return { ok: true, status: 200, arrayBuffer: async () => idxg(entries).buffer, headers: { get: () => null } };
    return { ok: true, status: 206, headers: { get: (h: string) => (h === 'Content-Range' ? `bytes 0-0/${size}` : null) } };
  };
  const res = await buildVodPlaylist({ ...tsTitle, headers: { 'Content-Auth': 'tok', 'User-Agent': 'ua' } }, fetchFn);
  assert.equal(res.pieces, 2);
  assert.equal(Math.round(res.duration), 12);
  assert.match(res.playlist, /#EXT-X-BYTERANGE:1128000@0\n/);
  assert.match(res.playlist, /#EXT-X-BYTERANGE:1128000@1128000\n/);
  assert.match(res.playlist, /#EXT-X-ENDLIST/);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers['Content-Auth'], 'tok');
  assert.equal(requests[0].headers['User-Agent'], undefined);
  assert.equal(requests[1].headers.Range, 'bytes=0-0');
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
