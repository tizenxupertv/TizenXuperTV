import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// public/js/boot.js is a plain browser script: run it with a minimal window (no document, so it does not start)
const source = readFileSync(new URL('../public/js/boot.js', import.meta.url), 'utf8');
function load() {
  const store: Record<string, string> = {};
  const win: any = {
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; }
    },
    __XUPER_PACKAGED: '1.10.0'
  };
  new Function('window', source)(win);
  return win.XuperBoot;
}

const boot = load();
const { choose, cmp } = boot._test;
const ctx = { packaged: '1.10.0', shell: 1, bad: {}, booting: null };
const meta = { version: '1.10.1', shell: 1 };
const bundle = { version: '1.10.1', shell: 1, scripts: ['assets/index.js'], styles: [], files: { 'assets/index.js': 'x()' } };

test('boot exposes its contract: shell, key slot, version of the package', () => {
  assert.equal(boot.SHELL, 1);
  assert.equal(typeof boot.PUBKEY, 'string');
  assert.equal(boot.info.packaged, '1.10.0');
  assert.equal(typeof boot.ok, 'function');
});

test('cmp compares dotted versions like the update core', () => {
  assert.equal(cmp('1.10.0', '1.9.9'), 1);
  assert.equal(cmp('1.9', '1.9.0'), 0);
  assert.equal(cmp('1.0.0', '1.0.1'), -1);
});

test('a newer stored bundle runs', () => {
  assert.equal(choose(meta, bundle, ctx).bundle, bundle);
});

test('nothing stored: the package runs, nothing dropped', () => {
  assert.deepEqual(choose(null, null, ctx), { bundle: null, drop: false, note: '' });
});

test('stored bundles that must not run are dropped, each with its reason', () => {
  const notNewer = choose({ version: '1.10.0', shell: 1 }, bundle, ctx);
  assert.equal(notNewer.drop, true);
  assert.match(notNewer.note, /not newer/);

  const shell = choose({ version: '1.10.1', shell: 2 }, bundle, ctx);
  assert.equal(shell.drop, true);
  assert.match(shell.note, /shell 2/);

  const bad = choose(meta, bundle, { ...ctx, bad: { '1.10.1': 1 } });
  assert.equal(bad.drop, true);
  assert.match(bad.note, /failed to start/);

  const halfWritten = choose(meta, null, ctx);
  assert.equal(halfWritten.drop, true);
  assert.match(halfWritten.note, /unreadable/);

  const mismatch = choose(meta, { ...bundle, version: '1.10.2' }, ctx);
  assert.equal(mismatch.drop, true);
});

test('one unfinished launch (user left during the splash) runs the bundle again; two mark it bad', () => {
  assert.equal(choose(meta, bundle, { ...ctx, booting: { version: '1.10.1', count: 1 } }).bundle, bundle);
  assert.equal(choose(meta, bundle, { ...ctx, booting: { version: '1.10.0', count: 5 } }).bundle, bundle);
  const r = choose(meta, bundle, { ...ctx, booting: { version: '1.10.1', count: 2 } });
  assert.equal(r.bundle, null);
  assert.equal(r.drop, true);
  assert.equal(r.markBad, '1.10.1');
});
