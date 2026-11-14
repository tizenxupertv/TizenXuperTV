import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unwrapPngTs } from '../src/lib/pngWrappedTs.ts';

const MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function chunk(type: string, data: number[]): number[] {
  const n = data.length;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...[...type].map(c => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
}
function ts(packets: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < packets; p++) { out.push(0x47); for (let i = 1; i < 188; i++) out.push(p & 255); }
  return out;
}

test('the TS of a PNG with a private chunk (14-nov layout: TS from byte 41, IDAT and IEND after)', () => {
  const video = ts(6);
  const png = Uint8Array.from([...MAGIC, ...chunk('IHDR', new Array(13).fill(1)), ...chunk('prVt', video), ...chunk('IDAT', new Array(10).fill(2)), ...chunk('IEND', [])]);
  const out = unwrapPngTs(png)!;
  assert.equal(out.byteOffset, 41);
  assert.deepEqual(Array.from(out), video);
});

test('the earlier layout (TS from byte 67) still works', () => {
  const video = ts(4);
  const png = Uint8Array.from([...MAGIC, ...chunk('IHDR', new Array(13).fill(1)), ...chunk('tEXt', new Array(14).fill(3)), ...chunk('zzZz', video), ...chunk('IEND', [])]);
  const out = unwrapPngTs(png)!;
  assert.equal(out.byteOffset, 67);
  assert.equal(out.length, video.length);
});

test('a broken chunk list falls back to the first run of TS packets; plain TS and other bytes are left alone', () => {
  const video = ts(5);
  const png = Uint8Array.from([...MAGIC, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 9, 9, ...video, 1, 2, 3]);
  const out = unwrapPngTs(png)!;
  assert.equal(out.byteOffset, 18);
  assert.equal(out.length, video.length);
  assert.equal(unwrapPngTs(Uint8Array.from(video)), null);
  assert.equal(unwrapPngTs(Uint8Array.from([1, 2, 3])), null);
});
