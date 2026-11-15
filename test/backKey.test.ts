import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACK_MIN_GAP_MS, dropBack } from '../src/lib/backKey.ts';

test('a first Back, or one after a pause, goes through', () => {
  assert.equal(dropBack({ repeat: false, sinceLastMs: Infinity }), false);
  assert.equal(dropBack({ repeat: false, sinceLastMs: BACK_MIN_GAP_MS }), false);
  assert.equal(dropBack({ repeat: false, sinceLastMs: 900 }), false);
});

test('a held Back counts once: its repeats are dropped', () => {
  assert.equal(dropBack({ repeat: true, sinceLastMs: 500 }), true);
  assert.equal(dropBack({ repeat: true, sinceLastMs: Infinity }), true);
});

test('a Back right after another is the same press', () => {
  assert.equal(dropBack({ repeat: false, sinceLastMs: 0 }), true);
  assert.equal(dropBack({ repeat: false, sinceLastMs: BACK_MIN_GAP_MS - 1 }), true);
});
