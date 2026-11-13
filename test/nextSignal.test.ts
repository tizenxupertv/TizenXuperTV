import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSignal } from '../src/lib/nextSignal.ts';

const failed = (...i: number[]) => new Set(i);

test('after a failure the next signal in the list is tried, around to the start', () => {
  assert.equal(nextSignal(4, 0, failed()), 1);
  assert.equal(nextSignal(4, 2, failed()), 3);
  assert.equal(nextSignal(4, 3, failed()), 0);
});

test('signals that already failed are skipped', () => {
  assert.equal(nextSignal(4, 0, failed(1)), 2);
  assert.equal(nextSignal(4, 3, failed(0, 1)), 2);
});

test('when every other signal failed, or there is only one, there is nothing to try', () => {
  assert.equal(nextSignal(3, 1, failed(0, 2)), -1);
  assert.equal(nextSignal(1, 0, failed()), -1);
  assert.equal(nextSignal(0, 0, failed()), -1);
});
