import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbOf } from '../src/services/catalogService.ts';

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
