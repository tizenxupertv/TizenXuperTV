import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paneDisplay, supportsDisplayContents } from '../src/lib/paneDisplay.ts';

test('paneDisplay: contents where the engine has it, block where it does not, none when hidden', () => {
  assert.equal(paneDisplay(true, true), 'contents');
  assert.equal(paneDisplay(true, false), 'block');
  assert.equal(paneDisplay(false, true), 'none');
  assert.equal(paneDisplay(false, false), 'none');
});

test('supportsDisplayContents: asks CSS.supports, false without it', () => {
  // Tizen 4.0 / 5.0 (Chromium 56 / 63): no display: contents
  assert.equal(supportsDisplayContents({ supports: () => false }), false);
  // Tizen 5.5 and newer (Chromium 69+)
  assert.equal(supportsDisplayContents({ supports: (p: string, v: string) => p === 'display' && v === 'contents' }), true);
  assert.equal(supportsDisplayContents(undefined), false);
  assert.equal(supportsDisplayContents({ supports: () => { throw new Error('x'); } }), false);
});
