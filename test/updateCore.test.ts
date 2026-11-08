import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  CHECK_EVERY_MS, compareVersions, judge, readBundle, readManifest, record, RETRY_MS, waitAfter, type UpdateManifest
} from '../src/lib/updateCore.ts';

const subtle = globalThis.crypto.subtle;
const enc = (s: string) => new TextEncoder().encode(s);

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
}

function signed(manifest: object, privateKey: ReturnType<typeof keys>['privateKey'], encoding: 'ieee-p1363' | 'der' = 'ieee-p1363') {
  const text = JSON.stringify(manifest);
  const sig = sign('sha256', Buffer.from(text), { key: privateKey, dsaEncoding: encoding }).toString('base64');
  return enc(JSON.stringify({ manifest: text, sig }));
}

function bundleFor(version: string) {
  const text = JSON.stringify({ version, shell: 1, scripts: ['assets/index.js'], styles: [], files: { 'assets/index.js': 'x()' } });
  const bytes = enc(text);
  const m: UpdateManifest = { version, shell: 1, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.byteLength };
  return { bytes, m };
}

test('versions compare part by part; "dev" is never newer', () => {
  assert.equal(compareVersions('1.10.0', '1.9.5'), 1);
  assert.equal(compareVersions('1.9.5', '1.9.5'), 0);
  assert.equal(compareVersions('1.9', '1.9.0'), 0);
  assert.equal(compareVersions('dev', '1.0.0'), -1);
});

test('a manifest signed with our key (P1363) is accepted; tampered, wrong key or DER signatures are not', async () => {
  const k = keys();
  const m = { version: '1.10.1', shell: 1, sha256: 'ab', size: 10 };
  assert.deepEqual((await readManifest(subtle, k.pub, signed(m, k.privateKey))).manifest, m);

  const tampered = JSON.parse(new TextDecoder().decode(signed(m, k.privateKey)));
  tampered.manifest = tampered.manifest.replace('1.10.1', '9.9.9');
  assert.equal((await readManifest(subtle, k.pub, enc(JSON.stringify(tampered)))).why, 'manifest signature');

  assert.equal((await readManifest(subtle, keys().pub, signed(m, k.privateKey))).why, 'manifest signature');
  assert.equal((await readManifest(subtle, k.pub, signed(m, k.privateKey, 'der'))).why, 'manifest signature');
  assert.equal((await readManifest(subtle, k.pub, enc('not json'))).why, 'manifest format');
  assert.equal((await readManifest(subtle, k.pub, signed({ version: '1.0.0' }, k.privateKey))).why, 'manifest fields');
});

test('the bundle must match the size and sha256 the manifest names', async () => {
  const { bytes, m } = bundleFor('1.10.1');
  const ok = await readBundle(subtle, m, bytes);
  assert.equal(ok.bundle?.version, '1.10.1');
  assert.deepEqual(ok.bundle?.styles, []);
  assert.match((await readBundle(subtle, { ...m, size: m.size + 1 }, bytes)).why || '', /size/);
  assert.equal((await readBundle(subtle, { ...m, sha256: '00' }, bytes)).why, 'bundle sha256');
  const other = bundleFor('1.10.2');
  assert.equal((await readBundle(subtle, { ...other.m, version: '1.10.1' }, other.bytes)).why, 'bundle does not match its manifest');
});

test('judge gives one reason per case, or downloads', () => {
  const m: UpdateManifest = { version: '1.10.1', shell: 1, sha256: 'ab', size: 1 };
  const ctx = { running: '1.10.0', shell: 1, bad: {}, downloaded: '' };
  assert.equal(judge(m, ctx), '');
  assert.match(judge(m, { ...ctx, running: '1.10.1' }), /^up to date/);
  assert.match(judge({ ...m, shell: 2 }, ctx), /needs a reinstall/);
  assert.match(judge(m, { ...ctx, bad: { '1.10.1': 1 } }), /failed to start/);
  assert.match(judge(m, { ...ctx, downloaded: '1.10.1' }), /already downloaded/);
});

test('checks wait 1 h after success, 15 → 30 → 60 min after failures, capped, never more than one gap', () => {
  const t = 1_000_000_000;
  assert.equal(CHECK_EVERY_MS, 3600 * 1000);
  assert.equal(waitAfter(null, t), 0);
  assert.equal(waitAfter(record(null, 'ok', false, t), t), CHECK_EVERY_MS);
  let r = record(null, 'net', true, t);
  assert.equal(waitAfter(r, t), RETRY_MS);
  r = record(r, 'net', true, t);
  assert.equal(waitAfter(r, t), 2 * RETRY_MS);
  r = record(r, 'net', true, t);
  assert.equal(waitAfter(r, t), CHECK_EVERY_MS, '4 × 15 min reaches the 1 h cap');
  for (let i = 0; i < 10; i++) r = record(r, 'net', true, t);
  assert.equal(waitAfter(r, t), CHECK_EVERY_MS);
  assert.equal(record(r, 'ok', false, t).fails, 0);
  // A record from the future (clock went back) waits at most one gap
  assert.equal(waitAfter(record(null, 'ok', false, t + 10 * CHECK_EVERY_MS), t), CHECK_EVERY_MS);
  assert.equal(waitAfter(record(null, 'ok', false, t), t + CHECK_EVERY_MS + 1), 0);
});
