import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  buildRelease, collectBundle, missingReferences, normalizeShellFile, shellChanges, shellFiles
} from '../tools/update-release.mjs';
import { readBundle, readManifest } from '../src/lib/updateCore.ts';

const BOOT = (pub: string, shell = 1) => `(function(){ var SHELL = ${shell};\n var PUBKEY = "${pub}"; })();`;

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  };
}

/** A built package like dist/: index.html with the lists boot.js reads, our code, shell files and an image */
function fixture(boot: string, overrides: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'xuper-update-'));
  const files: Record<string, string> = {
    'index.html': '<div class="xs-version">v1.10.0</div><script>window.__XUPER_SCRIPTS=["js/hls.min.js","js/magis-client.js","assets/index-AbC123.js"];window.__XUPER_STYLES=["assets/style-XyZ789.css"];window.__XUPER_PACKAGED="1.10.0";</script><script src="js/boot.js"></script>',
    'config.xml': '<widget xmlns="http://www.w3.org/ns/widgets" id="x" version="1.10.0"><name>X</name></widget>',
    'js/boot.js': boot,
    'js/hls.min.js': 'var Hls=1;',
    'js/magis-client.js': "new Worker('js/magis-worker.js');",
    'js/magis-worker.js': 'importScripts();',
    'assets/index-AbC123.js': 'img.src="assets/logo.png";',
    'assets/style-XyZ789.css': '.a{color:red}',
    'assets/logo.png': 'PNG',
    ...overrides
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const OWN = ['js/magis-client.js', 'assets/index-AbC123.js', 'assets/style-XyZ789.css'];

test('the bundle carries our own code in package order; big libraries stay in the package', () => {
  const k = keys();
  const { bundle, own } = collectBundle(fixture(BOOT(k.pub)), '1.10.1', 1);
  assert.deepEqual(own, OWN);
  assert.deepEqual(bundle.scripts, ['js/hls.min.js', 'js/magis-client.js', 'assets/index-AbC123.js']);
  assert.deepEqual(bundle.styles, ['assets/style-XyZ789.css']);
  assert.deepEqual(Object.keys(bundle.files).sort(), [...OWN].sort());
  assert.equal((bundle.files as Record<string, string>)['js/hls.min.js'], undefined);
});

test('index.html and config.xml are compared without hashed names and versions', () => {
  const a = normalizeShellFile('index.html', '<script>window.__XUPER_SCRIPTS=["assets/index-AAA.js"];window.__XUPER_STYLES=["assets/style-BBB.css"];window.__XUPER_PACKAGED="1.10.0";</script><link href="assets/style-BBB.css"><div class="xs-version">v1.10.0</div>');
  const b = normalizeShellFile('index.html', '<script>window.__XUPER_SCRIPTS=["assets/index-CCC.js"];window.__XUPER_STYLES=["assets/style-DDD.css"];window.__XUPER_PACKAGED="1.10.1";</script><link href="assets/style-DDD.css"><div class="xs-version">v1.10.1</div>');
  assert.equal(a, b);
  assert.equal(normalizeShellFile('config.xml', '<widget id="x" version="1.10.0">'), normalizeShellFile('config.xml', '<widget id="x" version="1.10.1">'));
  assert.deepEqual(shellChanges({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' }), ['changed b', 'added c']);
});

test('a release signs a manifest the TV accepts and a bundle that matches it', async () => {
  const k = keys();
  const boot = BOOT(k.pub);
  const dir = fixture(boot);
  const recordedShell = shellFiles(dir, OWN);
  const r = await buildRelease({ distDir: dir, version: '1.10.1', bootSource: boot, recordedShell, privatePem: k.pem });
  assert.equal(r.manifest.version, '1.10.1');
  assert.equal(r.manifest.sha256, createHash('sha256').update(r.bundleText).digest('hex'));

  const subtle = globalThis.crypto.subtle;
  const m = await readManifest(subtle, k.pub, new TextEncoder().encode(JSON.stringify(r.manifestDoc)));
  assert.deepEqual(m.manifest, r.manifest);
  const b = await readBundle(subtle, r.manifest, new TextEncoder().encode(r.bundleText));
  assert.equal(b.bundle?.files['js/magis-client.js'], "new Worker('js/magis-worker.js');");
});

test('a release refuses a changed shell, a missing asset, CSS url(), no key or the wrong key', async () => {
  const k = keys();
  const boot = BOOT(k.pub);
  const recordedShell = shellFiles(fixture(boot), OWN);

  await assert.rejects(
    buildRelease({ distDir: fixture(boot, { 'js/hls.min.js': 'var Hls=2;' }), version: '1.10.1', bootSource: boot, recordedShell, privatePem: k.pem }),
    /shell 1 changed \(changed js\/hls\.min\.js\)/
  );
  await assert.rejects(
    buildRelease({ distDir: fixture(boot, { 'assets/index-AbC123.js': 'img.src="assets/new.png";' }), version: '1.10.1', bootSource: boot, recordedShell, privatePem: k.pem }),
    /assets\/new\.png/
  );
  await assert.rejects(
    buildRelease({ distDir: fixture(boot, { 'assets/style-XyZ789.css': '.a{background:url(./x.png)}' }), version: '1.10.1', bootSource: boot, recordedShell, privatePem: k.pem }),
    /url\(\)/
  );
  const noKey = BOOT('');
  await assert.rejects(
    buildRelease({ distDir: fixture(noKey), version: '1.10.1', bootSource: noKey, recordedShell, privatePem: k.pem }),
    /no public key/
  );
  await assert.rejects(
    buildRelease({ distDir: fixture(boot), version: '1.10.1', bootSource: boot, recordedShell, privatePem: keys().pem }),
    /does not verify/
  );
  await assert.rejects(
    buildRelease({ distDir: fixture(boot), version: '1.10.1', bootSource: boot, recordedShell: undefined, privatePem: k.pem }),
    /--init-shell/
  );
});

test('references: template paths and folders are not counted as files', () => {
  const available = new Set(['assets/logo.png']);
  assert.deepEqual(missingReferences({ a: 'x("assets/logo.png"); y(`assets/catalog/${n}.jpg`); z("assets/")' }, available), []);
  assert.deepEqual(missingReferences({ a: "x('images/gone.png')" }, available), ['images/gone.png']);
});

test('a file loaded on demand travels in the bundle without being run at start, and is not a shell file', () => {
  const k = keys();
  const dir = fixture(BOOT(k.pub), { 'js/shaka-player.compiled.js': 'var shaka={Player:1};' });
  const { bundle, own } = collectBundle(dir, '1.16.1', 1);
  assert.equal(bundle.files['js/shaka-player.compiled.js'], 'var shaka={Player:1};');
  assert.ok(!bundle.scripts.includes('js/shaka-player.compiled.js'), 'boot.js must not run it at start');
  assert.ok(own.includes('js/shaka-player.compiled.js'));
  assert.ok(!('js/shaka-player.compiled.js' in shellFiles(dir, own)), 'carried by the bundle, so not compared as shell');
});

test('a package without the on-demand file builds the same bundle as before', () => {
  const k = keys();
  const { bundle, own } = collectBundle(fixture(BOOT(k.pub)), '1.16.1', 1);
  assert.deepEqual(own, OWN);
  assert.ok(!('js/shaka-player.compiled.js' in bundle.files));
});
