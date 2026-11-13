import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStaleLinkStatus } from '../src/lib/liveLink.ts';

test('isStaleLinkStatus: refused, conflicting or gone links get a fresh one', () => {
  for (const code of [401, 403, 409, 410]) assert.equal(isStaleLinkStatus(code), true, String(code));
  // A channel that is not there or a server error is not fixed by a new link
  for (const code of [0, 200, 404, 500, 502, 504]) assert.equal(isStaleLinkStatus(code), false, String(code));
});
