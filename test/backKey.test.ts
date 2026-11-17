import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACK_MIN_GAP_MS, dropBack } from '../src/lib/backKey.ts';
import { mapKeyCode } from '../src/hooks/useTvRemote.ts';

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

test('mapKeyCode maps Back keys across physical and synthetic codes and key strings', () => {
  // Samsung Tizen physical Return key (10009)
  assert.equal(mapKeyCode(10009), 'back');
  assert.equal(mapKeyCode(10009, 'Return'), 'back');
  // webOS and synthetic TV bridge code (461)
  assert.equal(mapKeyCode(461), 'back');
  assert.equal(mapKeyCode(461, 'Back'), 'back');
  // Keyboard Backspace (8) and Escape (27)
  assert.equal(mapKeyCode(8), 'back');
  assert.equal(mapKeyCode(27), 'back');
  assert.equal(mapKeyCode(27, 'Escape'), 'back');
  // Synthetic event where keyCode was omitted or 0, but key string is 'Back' or 'Return'
  assert.equal(mapKeyCode(0, 'Back'), 'back');
  assert.equal(mapKeyCode(0, 'Return'), 'back');
  assert.equal(mapKeyCode(0, 'Escape'), 'back');
});
