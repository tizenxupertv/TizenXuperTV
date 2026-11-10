import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backBufferFor, isLegacyVideoTv, isLowMemoryTv } from '../src/lib/tvMemory.ts';
import { mseHlsConfig } from '../src/lib/vodMseEngine.ts';

const TIZEN_3 = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 3.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/3.0 TV Safari/538.1';
const TIZEN_4 = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.36 (KHTML, like Gecko) 56.0.2924.0/4.0 TV Safari/537.36';
const TIZEN_5_5 = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) 69.0.3497.106.1/5.5 TV Safari/537.36';
const TIZEN_9 = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 9.0) AppleWebKit/537.36 (KHTML, like Gecko) 120.0.6099.5/9.0 TV Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

test('Tizen 4.0 and older count as low-memory TVs; newer TVs and browsers do not', () => {
  assert.equal(isLowMemoryTv(TIZEN_3), true);
  assert.equal(isLowMemoryTv(TIZEN_4), true);
  assert.equal(isLowMemoryTv(TIZEN_5_5), false);
  assert.equal(isLowMemoryTv(TIZEN_9), false);
  assert.equal(isLowMemoryTv(DESKTOP), false);
  assert.equal(isLowMemoryTv(''), false);
});

test('low-memory TVs keep at most 10 s behind the playhead; others keep the requested back buffer', () => {
  assert.equal(backBufferFor(20, TIZEN_4), 10);
  assert.equal(backBufferFor(30, TIZEN_3), 10);
  assert.equal(backBufferFor(5, TIZEN_4), 5);
  assert.equal(backBufferFor(20, TIZEN_9), 20);
  // In Node (no navigator) the requested value is kept
  assert.equal(mseHlsConfig({ DefaultConfig: { loader: class {} } }, '', 0).backBufferLength, 20);
});

test('Tizen 6.0 and older get the plain preview box (their engines show the preview sound without the picture)', () => {
  const ua = (v: string) => `Mozilla/5.0 (SMART-TV; LINUX; Tizen ${v}) AppleWebKit/537.36 (KHTML, like Gecko) Version/${v} TV Safari/537.36`;
  assert.equal(isLegacyVideoTv(ua('4.0')), true);
  assert.equal(isLegacyVideoTv(ua('5.5')), true);
  assert.equal(isLegacyVideoTv(ua('6.0')), true);
  assert.equal(isLegacyVideoTv(ua('6.5')), false);
  assert.equal(isLegacyVideoTv(ua('9.0')), false);
  assert.equal(isLegacyVideoTv('Mozilla/5.0 (Macintosh) Chrome/130.0 Safari/537.36'), false, 'a desktop browser');
});
