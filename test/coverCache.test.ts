import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverCacheWanted, coverCrop, coverKey, evictionPlan, COVER_FRESH_MS } from '../src/lib/coverCache.ts';

const TIZEN_4 = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.36';
const TIZEN_6 = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36';
const TIZEN_65 = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0';

test('coverCacheWanted: on Tizen 6.0 and older, a switch can force it on or off', () => {
  assert.equal(coverCacheWanted(TIZEN_4, null), true);
  assert.equal(coverCacheWanted(TIZEN_6, null), true);
  assert.equal(coverCacheWanted(TIZEN_65, null), false);
  assert.equal(coverCacheWanted(DESKTOP, null), false);
  assert.equal(coverCacheWanted(DESKTOP, 'on'), true);
  assert.equal(coverCacheWanted(TIZEN_4, 'off'), false);
});

test('coverKey: one copy per address and card size', () => {
  assert.equal(coverKey('https://a/p.jpg', 230, 340), '230x340|https://a/p.jpg');
  assert.notEqual(coverKey('https://a/p.jpg', 230, 340), coverKey('https://a/p.jpg', 484, 340));
});

test('coverCrop: the centred part of the image that fills the card, like object-fit: cover', () => {
  // A wider image than the card loses its sides
  assert.deepEqual(coverCrop(1000, 500, 200, 200), { sx: 250, sy: 0, sw: 500, sh: 500 });
  // A taller one loses top and bottom
  assert.deepEqual(coverCrop(500, 1000, 200, 200), { sx: 0, sy: 250, sw: 500, sh: 500 });
  // Same shape: all of it
  assert.deepEqual(coverCrop(460, 680, 230, 340), { sx: 0, sy: 0, sw: 460, sh: 680 });
});

test('evictionPlan: drops stale copies, then the oldest until under both caps', () => {
  const now = 10 * COVER_FRESH_MS;
  const entries = [
    { key: 'stale', at: now - COVER_FRESH_MS - 1, bytes: 10 },
    { key: 'old', at: now - 3000, bytes: 40 },
    { key: 'mid', at: now - 2000, bytes: 40 },
    { key: 'new', at: now - 1000, bytes: 40 }
  ];
  // 120 fresh bytes over a cap of 100: the oldest fresh one goes too
  assert.deepEqual(evictionPlan(entries, 100, 10, now).sort(), ['old', 'stale']);
  // Item cap of 2
  assert.deepEqual(evictionPlan(entries, 1000, 2, now).sort(), ['old', 'stale']);
  // Room for everything fresh
  assert.deepEqual(evictionPlan(entries, 1000, 10, now), ['stale']);
});
