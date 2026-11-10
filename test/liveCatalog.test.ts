import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveCatalogSave, KEEP_SAVED_MAX_AGE_MS } from '../src/lib/liveCatalog.ts';

const HOUR = 60 * 60 * 1000;

test('a complete download replaces the saved copy, even when a root is really empty', () => {
  assert.equal(liveCatalogSave([[1, 2], [3], []], 2 * HOUR), 'save');
  assert.equal(liveCatalogSave([[1, 2], [3]], null), 'save');
});

test('a download with a failed root does not replace a recent saved copy', () => {
  // One root timed out: the other six still add up to hundreds of titles
  assert.equal(liveCatalogSave([[1, 2], null, [3]], 2 * HOUR), 'keep-saved');
  assert.equal(liveCatalogSave([null, null, null], 10 * 60 * 1000), 'keep-saved');
});

test('without a saved copy, or with an old one, a partial download is saved and tried again soon', () => {
  assert.equal(liveCatalogSave([[1, 2], null], null), 'save-retry-soon');
  assert.equal(liveCatalogSave([[1, 2], null], KEEP_SAVED_MAX_AGE_MS), 'save-retry-soon');
  assert.equal(liveCatalogSave([[1, 2], null], KEEP_SAVED_MAX_AGE_MS - 1), 'keep-saved');
});
