import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbOf, isLightCopy } from '../src/services/catalogService.ts';

test('the hero recognises the light copies the Pi publishes', () => {
  assert.equal(isLightCopy('https://tizenxuper-img.pages.dev/0123456789abcdef0123.jpg'), true);
  assert.equal(isLightCopy('https://joqotx.p27i1en9.com/public/images/x.jpg'), false, 'a portal original');
  assert.equal(isLightCopy(undefined), false);
});

test('a tiny inline JPEG preview from the catalog is kept', () => {
  const thumb = 'data:image/jpeg;base64,' + 'A'.repeat(400);
  assert.equal(thumbOf(thumb), thumb);
});

test('anything that is not a small inline JPEG is dropped', () => {
  assert.equal(thumbOf(undefined), undefined);
  assert.equal(thumbOf(''), undefined);
  assert.equal(thumbOf('https://example.invalid/a.jpg'), undefined, 'an address would download, not preview');
  assert.equal(thumbOf('data:image/svg+xml;base64,PHN2Zz4='), undefined);
  assert.equal(thumbOf('data:image/jpeg;base64,' + 'A'.repeat(5000)), undefined, 'a full image passed off as a preview');
});
