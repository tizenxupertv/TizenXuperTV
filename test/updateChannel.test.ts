import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateQuery } from '../src/lib/updateChannel.ts';

test('the update check asks the beta channel only when the TV chose it', () => {
  assert.equal(updateQuery('1.12.7', 'stable'), '?v=1.12.7');
  assert.equal(updateQuery('1.12.7', 'beta'), '?v=1.12.7&channel=beta');
  assert.equal(updateQuery('1.12 7', 'stable'), '?v=1.12%207');
});
