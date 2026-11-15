import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogRetryDelayMs } from '../src/lib/catalogRetry.ts';

test('catalogRetryDelayMs: backs off and then keeps trying every 30 s', () => {
  assert.deepEqual([1, 2, 3, 4, 9].map(catalogRetryDelayMs), [5000, 10000, 20000, 30000, 30000]);
  assert.equal(catalogRetryDelayMs(0), 5000);
});
