import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupIdxgSegments, indexEnd, parseIdxg } from '../src/lib/vodIdxg.ts';
import { makeIdxg } from './helpers/idxg.ts';

// The first keyframes of a real title's index: uneven distances, 188-aligned offsets
const REAL_ENTRIES = [
  { ts: 0, off: 0 },
  { ts: 3999, off: 382956 },
  { ts: 4999, off: 515308 },
  { ts: 9999, off: 1180452 },
  { ts: 14999, off: 2241712 },
  { ts: 19999, off: 2552664 },
  { ts: 24999, off: 2781084 },
  { ts: 29999, off: 3010068 },
  { ts: 34999, off: 3241684 },
  { ts: 39999, off: 3481760 },
  { ts: 44791, off: 3700968 },
  { ts: 44999, off: 3805496 },
  { ts: 47624, off: 4268352 },
  { ts: 48874, off: 4482108 },
  { ts: 49999, off: 4701880 }
];
const TOTAL = 4986700;
const DURATION_MS = 51333;

test('an index is read as time then offset, with the media size and duration from its header', () => {
  const parsed = parseIdxg(makeIdxg(REAL_ENTRIES, { total: TOTAL, durationMs: DURATION_MS }));
  assert.equal(parsed.name, '0123456789ABCDEF0123456789ABCDEF.ts');
  assert.equal(parsed.mediaTotal, TOTAL);
  assert.equal(parsed.segments.length, REAL_ENTRIES.length);
  assert.deepEqual(parsed.segments[0], { start: 0, length: 382956, duration: 3.999 });
  assert.deepEqual(parsed.segments[1], { start: 382956, length: 132352, duration: 1 });
  // Keyframes 208 ms apart keep their real distance
  assert.deepEqual(parsed.segments[10], { start: 3700968, length: 104528, duration: 0.208 });
  // The last piece ends where the header says the media does, in bytes and in time
  assert.deepEqual(parsed.segments[14], { start: 4701880, length: TOTAL - 4701880, duration: 1.334 });
  const seconds = parsed.segments.reduce((sum, s) => sum + s.duration, 0);
  assert.equal(Math.round(seconds * 1000), DURATION_MS);
});

test('the pieces cover the whole file without gaps and none is longer than the target plus half a second', () => {
  const grouped = groupIdxgSegments(parseIdxg(makeIdxg(REAL_ENTRIES, { total: TOTAL, durationMs: DURATION_MS })), 6);
  let next = 0;
  for (const piece of grouped.segments) {
    assert.equal(piece.start, next);
    assert.ok(piece.duration <= 6.5, `piece of ${piece.duration} s`);
    next = piece.start + piece.length;
  }
  assert.equal(next, TOTAL);
  assert.ok(grouped.segments.length < REAL_ENTRIES.length);
});

test('offsets past 4 GB are read whole', () => {
  const big = 188 * 30000000; // 5.64 GB, on a packet boundary
  const entries = [{ ts: 0, off: 0 }, { ts: 5000, off: big }, { ts: 10000, off: big + 188000 }];
  const parsed = parseIdxg(makeIdxg(entries, { total: big + 376000, durationMs: 15000 }));
  assert.deepEqual(parsed.segments[2], { start: big + 188000, length: 188000, duration: 5 });
  assert.equal(indexEnd(makeIdxg(entries)), big + 188000);
});

test('a header without a usable size or duration: the last piece is dropped, and a size from the CDN closes it', () => {
  const index = makeIdxg(REAL_ENTRIES);
  const parsed = parseIdxg(index);
  assert.equal(parsed.segments.length, REAL_ENTRIES.length - 1);
  assert.equal(parsed.mediaTotal, 4701880);
  const withSize = parseIdxg(index, TOTAL);
  assert.equal(withSize.segments.length, REAL_ENTRIES.length);
  assert.deepEqual(withSize.segments[14], { start: 4701880, length: TOTAL - 4701880, duration: 1 });
});

test('an index cut short is read up to its last whole entry', () => {
  const whole = makeIdxg(REAL_ENTRIES, { total: TOTAL, durationMs: DURATION_MS });
  const cut = whole.slice(0, whole.length - 12 * 3 - 5);
  const parsed = parseIdxg(cut);
  // Eleven whole entries left (the twelfth lost 5 bytes): the last piece runs to the end of the media
  assert.equal(parsed.segments.length, 11);
  assert.equal(parsed.segments[10].start, 3700968);
  assert.equal(parsed.segments[10].length, TOTAL - 3700968);
});

test('bytes that are not an index, or entries in another order, are refused (the player then uses AVPlay)', () => {
  assert.throws(() => parseIdxg(new Uint8Array(200)), /Invalid \.idxg header/);
  // Offset first, then time: the order this parser used to expect, which no real index has
  const wrong = makeIdxg(REAL_ENTRIES, { total: TOTAL, durationMs: DURATION_MS });
  const view = new DataView(wrong.buffer);
  const tableStart = wrong.length - REAL_ENTRIES.length * 12;
  REAL_ENTRIES.forEach((e, i) => {
    view.setUint32(tableStart + i * 12, 0);
    view.setUint32(tableStart + i * 12 + 4, e.off);
    view.setUint32(tableStart + i * 12 + 8, e.ts);
  });
  assert.throws(() => parseIdxg(wrong), /Could not locate \.idxg segment table|Too few \.idxg entries/);
  assert.equal(indexEnd(new Uint8Array(16)), 0);
});
