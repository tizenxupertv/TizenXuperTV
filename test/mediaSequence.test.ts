import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSequenceFixer } from '../src/lib/mediaSequence.ts';

const BASE = 'http://bcdod.faolmbghu.com/live/cyx-F513/cyx-F513_xycjco_';

/** A live playlist like the portal's: `seq` is the server's number, `files` the segment numbers in the names */
function playlist(seq: number, files: number[], query = ''): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-ALLOW-CACHE:YES',
    `#EXT-X-MEDIA-SEQUENCE:${seq}`,
    '#EXT-X-TARGETDURATION:5',
    ...files.flatMap(f => [`#EXT-SEGMENT:0-296099/rd=${f}`, '#EXTINF:5.022, no desc', `${BASE}${f}.ts${query}`])
  ].join('\n');
}
const seqOf = (text: string) => Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text)![1]);

test('a consistent live playlist passes unchanged', () => {
  const fix = createSequenceFixer();
  const first = playlist(11500, [1, 2, 3, 4, 5, 6]);
  const second = playlist(11501, [2, 3, 4, 5, 6, 7]);
  assert.equal(fix(first), first);
  assert.equal(fix(second), second);
});

test('a server that shifts its numbering by one keeps the first numbers (seen on Canal 13 Chile HD)', () => {
  const fix = createSequenceFixer();
  fix(playlist(11500, [1, 2, 3, 4, 5, 6]));
  // Next refresh: the server says 11502 although file 2 was 11501 a moment ago
  const shifted = fix(playlist(11502, [2, 3, 4, 5, 6, 7]));
  assert.equal(seqOf(shifted), 11501);
  // The segment lines themselves are untouched
  assert.equal(shifted.split('\n').filter(l => l.startsWith('http')).length, 6);
  // And the numbering stays on that track afterwards
  assert.equal(seqOf(fix(playlist(11504, [3, 4, 5, 6, 7, 8]))), 11502);
});

test('changing tokens in the segment query do not count as different segments', () => {
  const fix = createSequenceFixer();
  fix(playlist(10, [1, 2, 3], '?token=a'));
  assert.equal(seqOf(fix(playlist(12, [2, 3, 4], '?token=b'))), 11);
});

test('a playlist with nothing in common never numbers backwards', () => {
  const fix = createSequenceFixer();
  fix(playlist(100, [1, 2, 3]));
  assert.equal(seqOf(fix(playlist(50, [70, 71, 72]))), 103);
  // A real jump forward is kept
  assert.equal(seqOf(fix(playlist(500, [90, 91]))), 500);
});

test('master playlists, VOD without a sequence and other text pass unchanged', () => {
  const fix = createSequenceFixer();
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8';
  assert.equal(fix(master), master);
  const vod = '#EXTM3U\n#EXTINF:10,\na.ts\n#EXT-X-ENDLIST';
  assert.equal(fix(vod), vod);
  assert.equal(fix('<html>blocked</html>'), '<html>blocked</html>');
});

test('behind the dev proxy, segments are told apart by the proxied address', () => {
  const fix = createSequenceFixer();
  const proxied = (seq: number, files: number[]) =>
    playlist(seq, files).replace(new RegExp(BASE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '(\\d+)\\.ts', 'g'), (_m, f) => `/stream-proxy?url=${encodeURIComponent(`${BASE}${f}.ts`)}&auth=x`);
  fix(proxied(20, [1, 2, 3]));
  assert.equal(seqOf(fix(proxied(22, [2, 3, 4]))), 21);
});

test('it forgets old segments beyond the limit', () => {
  const fix = createSequenceFixer(4);
  fix(playlist(1, [1, 2, 3]));
  fix(playlist(4, [4, 5, 6]));
  // Segment 1 was forgotten: a list starting there is numbered as new (and never backwards)
  assert.equal(seqOf(fix(playlist(1, [1]))), 7);
});
