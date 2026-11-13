#!/usr/bin/env node
/**
 * Builds the self-update files of a release from dist/ (run `npm run build` first):
 *
 *   node tools/update-release.mjs [--version x.y.z] [--dist dist] [--out build/update]
 *   node tools/update-release.mjs --init-shell     records the current shell in update/shell.json
 *
 * Writes build/update/update-bundle-<version>.json (our own code) and build/update/update-manifest.json
 * ({ manifest, sig }: version, shell, sha256 and size of the bundle, signed with ~/.tizenxuper-update-key.pem,
 * ECDSA P-256 / SHA-256 in IEEE P1363 form, which is what WebCrypto verifies). Attach both to the GitHub release:
 * the bot Worker serves them to the TVs (/tv/update). See public/js/boot.js for how a TV runs them.
 *
 * Refuses, with the reason, when:
 *  - a shell file (anything the bundle does not carry: boot.js, config.xml, hls, crypto-js, portal.js, the magis
 *    worker, images, the proxy service, index.html) differs from update/shell.json for the current SHELL — bump SHELL
 *    in public/js/boot.js and run --init-shell (TVs on the older shell then reinstall with Apps2Samsung);
 *  - bundle code names a file under assets/, images/, js/ or data/ that the shell does not have;
 *  - the bundle's CSS uses url() (it loads from a blob: URL, where relative urls break);
 *  - boot.js has no public key, or the signature does not verify with it.
 */
import { createHash, createPrivateKey, sign, webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyPath } from './update-key.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL_JSON = join(ROOT, 'update/shell.json');

/** Scripts that stay in the package: big libraries and the portal snapshot */
export const SHELL_SCRIPTS = ['js/hls.min.js', 'js/crypto-js.min.js', 'data/portal.js'];
/**
 * Files the bundle carries but boot.js does not run at start: the app loads them when it needs them
 * (src/lib/lazyScript.ts). Shaka Player is one: only the DASH signals of Deportes use it. It stays in the bundle
 * because a TV whose package predates it (installed at 1.10.x, updated by itself since) has no copy on disk.
 */
export const LAZY_FILES = ['js/shaka-player.compiled.js'];
/** Package files never compared as shell: signatures written when signing */
const IGNORED = new Set(['author-signature.xml', 'signature1.xml']);

const sha256 = data => createHash('sha256').update(data).digest('hex');

/** SHELL and PUBKEY from boot.js source */
export function bootConstants(bootSource) {
  const shell = Number((bootSource.match(/var SHELL = (\d+);/) || [])[1]);
  const pubkey = (bootSource.match(/var PUBKEY = "([^"]*)";/) || [])[1];
  if (!shell || pubkey === undefined) throw new Error('public/js/boot.js has no SHELL / PUBKEY lines');
  return { shell, pubkey };
}

/** The package's script and style lists, from the globals the build writes into index.html */
export function packageLists(indexHtml) {
  const scripts = (indexHtml.match(/window\.__XUPER_SCRIPTS=(\[[^\]]*\])/) || [])[1];
  const styles = (indexHtml.match(/window\.__XUPER_STYLES=(\[[^\]]*\])/) || [])[1];
  if (!scripts || !styles) throw new Error('dist/index.html has no __XUPER_SCRIPTS / __XUPER_STYLES: build first');
  return { scripts: JSON.parse(scripts), styles: JSON.parse(styles) };
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

/** index.html and config.xml without what changes every release (hashed names, version) */
export function normalizeShellFile(path, text) {
  if (path === 'index.html') {
    return text
      .replace(/window\.__XUPER_SCRIPTS=\[[^\]]*\];window\.__XUPER_STYLES=\[[^\]]*\];window\.__XUPER_PACKAGED="[^"]*";/, '')
      .replace(/assets\/(index|style)-[A-Za-z0-9_-]+\.(js|css)/g, 'assets/$1.$2')
      .replace(/(class="xs-version">v)[^<]*/, '$1');
  }
  if (path === 'config.xml') return text.replace(/(<widget\b[^>]*?\s)version="[^"]*"/, '$1version=""');
  return text;
}

/** Every file of the package that is not carried by the bundle, with its sha256 */
export function shellFiles(distDir, bundlePaths) {
  const files = {};
  for (const path of walk(distDir).sort()) {
    if (IGNORED.has(path) || bundlePaths.includes(path)) continue;
    const buf = readFileSync(join(distDir, path));
    files[path] = path === 'index.html' || path === 'config.xml' ? sha256(normalizeShellFile(path, buf.toString('utf8'))) : sha256(buf);
  }
  return files;
}

/** Differences between a recorded shell and the current one, as readable lines */
export function shellChanges(recorded, current) {
  const out = [];
  for (const path of Object.keys(recorded)) {
    if (!(path in current)) out.push(`removed ${path}`);
    else if (recorded[path] !== current[path]) out.push(`changed ${path}`);
  }
  for (const path of Object.keys(current)) if (!(path in recorded)) out.push(`added ${path}`);
  return out;
}

/** Package paths named in bundle code that neither the shell nor the bundle has */
export function missingReferences(files, available) {
  const missing = new Set();
  const re = /["'`]((?:assets|images|js|data)\/[^"'`\s?#()]+)["'`]/g;
  for (const text of Object.values(files)) {
    let m;
    while ((m = re.exec(text))) {
      const ref = m[1];
      if (ref.includes('${') || ref.endsWith('/')) continue;
      if (!available.has(ref)) missing.add(ref);
    }
  }
  return [...missing].sort();
}

/** The bundle object for `version` from a built dist/ */
export function collectBundle(distDir, version, shell) {
  const lists = packageLists(readFileSync(join(distDir, 'index.html'), 'utf8'));
  const lazy = LAZY_FILES.filter(p => !lists.scripts.includes(p) && existsSync(join(distDir, p)));
  const own = [...lists.scripts.filter(p => !SHELL_SCRIPTS.includes(p)), ...lists.styles, ...lazy];
  const files = {};
  for (const path of own) {
    const full = join(distDir, path);
    if (!existsSync(full)) throw new Error(`${path} is in index.html but not in ${distDir}`);
    files[path] = readFileSync(full, 'utf8');
  }
  for (const path of lists.styles) {
    if (/url\(\s*(?!["']?data:)/.test(files[path])) throw new Error(`${path} uses url(): it would break when loaded from a blob: URL`);
  }
  return { bundle: { version, shell, scripts: lists.scripts, styles: lists.styles, files }, own };
}

function fromBase64(s) {
  return Uint8Array.from(Buffer.from(s, 'base64'));
}

/** Signs the manifest text (IEEE P1363, as WebCrypto expects) and checks it with the public key of boot.js */
export async function signManifest(manifestText, privatePem, pubkeyB64) {
  const sig = sign('sha256', Buffer.from(manifestText), { key: createPrivateKey(privatePem), dsaEncoding: 'ieee-p1363' }).toString('base64');
  const key = await webcrypto.subtle.importKey('spki', fromBase64(pubkeyB64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromBase64(sig), new TextEncoder().encode(manifestText));
  if (!ok) throw new Error('the signature does not verify with the public key in boot.js: wrong private key?');
  return { manifest: manifestText, sig };
}

/** Everything the release needs, without touching the disk: { bundleText, manifestDoc, manifest } */
export async function buildRelease({ distDir, version, bootSource, recordedShell, privatePem }) {
  const { shell, pubkey } = bootConstants(bootSource);
  if (!pubkey) throw new Error('boot.js has no public key: run tools/update-key.mjs first');
  if (readFileSync(join(distDir, 'js/boot.js'), 'utf8') !== bootSource) throw new Error('dist/js/boot.js differs from public/js/boot.js: build again');
  const { bundle, own } = collectBundle(distDir, version, shell);
  const current = shellFiles(distDir, own);
  if (!recordedShell) throw new Error(`update/shell.json has no shell ${shell}: run with --init-shell once for this shell`);
  const changes = shellChanges(recordedShell, current);
  if (changes.length) {
    throw new Error(`shell ${shell} changed (${changes.join(', ')}): bump SHELL in public/js/boot.js and run --init-shell; TVs on the old shell will reinstall`);
  }
  const missing = missingReferences(bundle.files, new Set([...Object.keys(current), ...own]));
  if (missing.length) throw new Error(`bundle code names files the shell does not have: ${missing.join(', ')}`);
  const bundleText = JSON.stringify(bundle);
  const bytes = Buffer.from(bundleText, 'utf8');
  const manifest = { version, shell, sha256: sha256(bytes), size: bytes.byteLength };
  const manifestDoc = await signManifest(JSON.stringify(manifest), privatePem, pubkey);
  return { bundleText, manifestDoc, manifest };
}

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(args) {
  const distDir = resolve(ROOT, arg(args, '--dist') || 'dist');
  const outDir = resolve(ROOT, arg(args, '--out') || 'build/update');
  const bootSource = readFileSync(join(ROOT, 'public/js/boot.js'), 'utf8');
  const { shell } = bootConstants(bootSource);
  const shells = existsSync(SHELL_JSON) ? JSON.parse(readFileSync(SHELL_JSON, 'utf8')) : {};

  if (args.includes('--init-shell')) {
    const { own } = collectBundle(distDir, '0.0.0', shell);
    shells[shell] = { files: shellFiles(distDir, own) };
    mkdirSync(dirname(SHELL_JSON), { recursive: true });
    writeFileSync(SHELL_JSON, JSON.stringify(shells, null, 2) + '\n');
    console.log(`update/shell.json: shell ${shell} recorded (${Object.keys(shells[shell].files).length} files)`);
    return;
  }

  const config = readFileSync(join(distDir, 'config.xml'), 'utf8');
  const version = arg(args, '--version') || (config.match(/<widget\b[^>]*\sversion="([^"]+)"/) || [])[1];
  if (!version || !/^\d+(\.\d+){1,3}$/.test(version)) throw new Error(`bad version ${version}`);
  const path = keyPath();
  if (!existsSync(path)) throw new Error(`no private key at ${path}`);
  const { bundleText, manifestDoc, manifest } = await buildRelease({
    distDir, version, bootSource, recordedShell: shells[shell] && shells[shell].files, privatePem: readFileSync(path, 'utf8')
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `update-bundle-${version}.json`), bundleText);
  writeFileSync(join(outDir, 'update-manifest.json'), JSON.stringify(manifestDoc));
  console.log(`update ${version} (shell ${shell}): bundle ${Math.round(manifest.size / 1024)} KB, sha256 ${manifest.sha256.slice(0, 12)}…, signature verified`);
  console.log(`  ${relative(ROOT, join(outDir, 'update-manifest.json'))}`);
  console.log(`  ${relative(ROOT, join(outDir, `update-bundle-${version}.json`))}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => {
    console.error(`update-release: ${e.message}`);
    process.exit(1);
  });
}
