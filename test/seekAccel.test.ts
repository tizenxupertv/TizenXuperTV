import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeekHold, formatSkip, REPEAT_GAP_MS, stepFor } from '../src/lib/seekAccel.ts';

test('jumps grow the longer the key is held', () => {
  assert.equal(stepFor(0), 10);
  assert.equal(stepFor(999), 10);
  assert.equal(stepFor(1000), 30);
  assert.equal(stepFor(3500), 60);
  assert.equal(stepFor(6000), 120);
  assert.equal(stepFor(60000), 300);
});

test('a hold: first press 10 s, repeats thinned out, jumps grow, direction kept', () => {
  const hold = createSeekHold();
  assert.equal(hold.press(1, false, 0), 10);
  assert.equal(hold.press(1, true, REPEAT_GAP_MS - 1), 0, 'repeat too soon');
  assert.equal(hold.press(1, true, REPEAT_GAP_MS), 10);
  assert.equal(hold.press(1, true, 1200), 30);
  assert.equal(hold.press(1, true, 9000), 300);
  // A new press (not a repeat) starts over
  assert.equal(hold.press(1, false, 9100), 10);
  // Switching direction while "repeating" starts a new hold too
  assert.equal(hold.press(-1, true, 9400), -10);
  hold.release();
  assert.equal(hold.press(-1, true, 9500), -10, 'after release a repeat counts as a new hold');
});

test('seek feedback reads as seconds or minutes', () => {
  assert.equal(formatSkip(10), '+10 s');
  assert.equal(formatSkip(-30), '−30 s');
  assert.equal(formatSkip(90), '+1:30');
  assert.equal(formatSkip(-720), '−12:00');
});
