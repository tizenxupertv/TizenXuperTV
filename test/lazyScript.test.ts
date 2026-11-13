import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runsFromBundle, SHAKA_PATH } from '../src/lib/lazyScript.ts';
import { LAZY_FILES } from '../tools/update-release.mjs';

test('the app knows whether it runs the installed package or a self-update bundle', () => {
  assert.equal(runsFromBundle({ running: '1.16.1', packaged: '1.15.1' }), true);
  assert.equal(runsFromBundle({ running: '1.16.1', packaged: '1.16.1' }), false);
  assert.equal(runsFromBundle({ running: '', packaged: '1.16.1' }), false);
  assert.equal(runsFromBundle(null), false);
  assert.equal(runsFromBundle(undefined), false);
});

test('the file the app asks for on demand is one the update bundle carries', () => {
  assert.ok(LAZY_FILES.includes(SHAKA_PATH));
});
