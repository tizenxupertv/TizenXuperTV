#!/usr/bin/env node
/**
 * Light copies of the catalog's large artwork, served from the tizenxuper-img Pages project.
 *
 * The portal's backdrops and landscapes are 1920x1080 images of 1.8-4 MB with no smaller variant, and the TV's hero
 * and wide rows load them as they are. Each one is downloaded once, reduced with vipsthumbnail to 1280x720 at JPEG
 * quality 72 (~150 KB), kept in img-cache/, and uploaded to Cloudflare Pages through its direct-upload API (no
 * wrangler on ARMv6). The catalog then points at the copy, only once that copy is published: an image that failed
 * keeps its original address, so a TV never loses a picture.
 *
 * Usage: node optimize-images.mjs <portal-catalog.json>   (rewrites the file in place)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE = process.env.IMG_CACHE_DIR || path.join(DIR, 'img-cache');
const STATE = path.join(CACHE, 'published.json');
const PROJECT = 'tizenxuper-img';
const PUBLIC_BASE = `https://${PROJECT}.pages.dev`;
const FIELDS = ['backdrop', 'landscape'];
const MAX_NEW_PER_RUN = Number(process.env.IMG_MAX_NEW || 120);

const log = (msg) => console.log(`[optimize-images] ${msg}`);

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(DIR, '.env.pi'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const keyOf = (url) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 20);

// AbortSignal.timeout's timer does not keep Node alive: with a download stalled and nothing else pending, the process
// left in the middle of the work with exit code 0 and no message. This timer is a normal one.
async function download(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`no answer in ${ms / 1000} s`)), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120_000 }, (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()));
  });
}

async function makeCopy(url, key) {
  const out = path.join(CACHE, `${key}.jpg`);
  if (fs.existsSync(out)) return out;
  const tmp = path.join(CACHE, `${key}.src`);
  fs.writeFileSync(tmp, await download(url, 60_000));
  try {
    await run('vipsthumbnail', [tmp, '--size', '1280x720', '-o', `${out}[Q=72,strip,optimize_coding]`]);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return out;
}

// Cloudflare Pages direct upload: the same calls wrangler makes
async function publish(env, files) {
  const api = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT}`;
  const auth = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
  const tokenRes = await (await fetch(`${api}/upload-token`, { headers: auth })).json();
  if (!tokenRes.success) throw new Error('upload-token: ' + JSON.stringify(tokenRes.errors));
  const jwt = { Authorization: `Bearer ${tokenRes.result.jwt}`, 'Content-Type': 'application/json' };

  const manifest = {};
  const byHash = new Map();
  for (const file of files) {
    const b64 = fs.readFileSync(file).toString('base64');
    const hash = crypto.createHash('sha256').update(b64 + 'jpg').digest('hex').slice(0, 32);
    manifest['/' + path.basename(file)] = hash;
    byHash.set(hash, b64);
  }
  const hashes = [...byHash.keys()];
  const missing = await (await fetch('https://api.cloudflare.com/client/v4/pages/assets/check-missing', {
    method: 'POST', headers: jwt, body: JSON.stringify({ hashes })
  })).json();
  if (!missing.success) throw new Error('check-missing: ' + JSON.stringify(missing.errors));
  const toUpload = missing.result || [];
  for (let i = 0; i < toUpload.length; i += 40) {
    const batch = toUpload.slice(i, i + 40).map((h) => ({ key: h, value: byHash.get(h), metadata: { contentType: 'image/jpeg' }, base64: true }));
    const up = await (await fetch('https://api.cloudflare.com/client/v4/pages/assets/upload', {
      method: 'POST', headers: jwt, body: JSON.stringify(batch)
    })).json();
    if (!up.success) throw new Error('upload: ' + JSON.stringify(up.errors));
  }
  await fetch('https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes', {
    method: 'POST', headers: jwt, body: JSON.stringify({ hashes })
  });
  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest));
  form.append('branch', 'main');
  const dep = await (await fetch(`${api}/deployments`, { method: 'POST', headers: auth, body: form })).json();
  if (!dep.success) throw new Error('deployment: ' + JSON.stringify(dep.errors));
  log(`published ${files.length} images (${toUpload.length} new), deployment ${dep.result.id}`);
}

// Tiny previews inlined in the catalog: the card or hero shows one at once, blurred by its own upscaling, while the
// real image downloads. 8x12 for posters (from the poster itself), 16x9 for backdrops (from the light copy).
const THUMBS = path.join(CACHE, 'thumbs');
const MAX_NEW_THUMBS = Number(process.env.THUMB_MAX_NEW || 400);

async function thumbFrom(source, key, size) {
  const out = path.join(THUMBS, `${key}.b64`);
  if (fs.existsSync(out)) return fs.readFileSync(out, 'utf8');
  const tmpJpg = path.join(THUMBS, `${key}.jpg`);
  // optimize_coding drops the default Huffman tables, most of a tiny JPEG (624 -> 284 bytes); WebP would be smaller
  // still, but libwebp crashes on the B+ (ARMv6, illegal instruction)
  await run('vipsthumbnail', [source, '--size', size, '-o', `${tmpJpg}[Q=30,strip,optimize_coding]`]);
  const b64 = 'data:image/jpeg;base64,' + fs.readFileSync(tmpJpg).toString('base64');
  fs.rmSync(tmpJpg, { force: true });
  fs.writeFileSync(out, b64);
  return b64;
}

async function addThumbs(catalog) {
  fs.mkdirSync(THUMBS, { recursive: true });
  const nodes = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (typeof node.poster === 'string' && /^https?:\/\//.test(node.poster)) nodes.push(node);
    Object.values(node).forEach(visit);
  };
  visit(catalog);

  let made = 0;
  let added = 0;
  for (const node of nodes) {
    const pKey = 'p' + keyOf(node.poster);
    const pCached = fs.existsSync(path.join(THUMBS, `${pKey}.b64`));
    if (pCached || made < MAX_NEW_THUMBS) {
      try {
        if (!pCached) {
          const tmp = path.join(THUMBS, `${pKey}.src`);
          fs.writeFileSync(tmp, await download(node.poster, 30_000));
          try { await thumbFrom(tmp, pKey, '8x12'); } finally { fs.rmSync(tmp, { force: true }); }
          made++;
        }
        node.posterThumb = await thumbFrom(null, pKey, '8x12');
        added++;
      } catch (e) {
        log(`no poster preview for ${pKey}: ${e.message.slice(0, 100)}`);
      }
    }
    // The backdrop preview comes from the light copy already on disk: no download
    const bd = node.backdrop;
    const m = typeof bd === 'string' && bd.match(/\/([a-f0-9]{20})\.jpg$/);
    const light = m && path.join(CACHE, `${m[1]}.jpg`);
    if (light && fs.existsSync(light)) {
      try { node.backdropThumb = await thumbFrom(light, 'b' + m[1], '16x9'); } catch {}
    }
  }
  log(`${added} poster previews in the catalog (${made} new)`);
}

async function main() {
  const catalogPath = process.argv[2];
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  fs.mkdirSync(CACHE, { recursive: true });
  const published = new Set(fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : []);

  const urls = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    for (const f of FIELDS) if (typeof node[f] === 'string' && /^https?:\/\//.test(node[f]) && node[f] !== node.poster) urls.add(node[f]);
    Object.values(node).forEach(visit);
  };
  visit(catalog);

  let made = 0;
  let failed = 0;
  for (const url of urls) {
    const key = keyOf(url);
    if (fs.existsSync(path.join(CACHE, `${key}.jpg`))) continue;
    if (made >= MAX_NEW_PER_RUN) break;
    try {
      await makeCopy(url, key);
      made++;
    } catch (e) {
      failed++;
      log(`skip ${key}: ${e.message.slice(0, 120)}`);
    }
  }
  log(`${urls.size} large images in the catalog, ${made} new copies, ${failed} failed`);

  // A deployment replaces the whole site, so it carries every copy made so far: a TV still holding an older catalog
  // keeps finding its images
  const all = fs.readdirSync(CACHE).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4));
  if (all.some((k) => !published.has(k))) {
    await publish(loadEnv(), all.map((k) => path.join(CACHE, `${k}.jpg`)));
    fs.writeFileSync(STATE, JSON.stringify(all));
    all.forEach((k) => published.add(k));
  }

  let rewritten = 0;
  const rewrite = (node) => {
    if (Array.isArray(node)) return node.forEach(rewrite);
    if (!node || typeof node !== 'object') return;
    for (const f of FIELDS) {
      const v = node[f];
      if (typeof v === 'string' && /^https?:\/\//.test(v) && v !== node.poster && published.has(keyOf(v))) {
        node[f] = `${PUBLIC_BASE}/${keyOf(v)}.jpg`;
        rewritten++;
      }
    }
    Object.values(node).forEach(rewrite);
  };
  rewrite(catalog);
  log(`${rewritten} addresses now point at ${PUBLIC_BASE}`);
  try {
    await addThumbs(catalog);
  } catch (e) {
    log(`previews skipped: ${e.message}`);
  }
  fs.writeFileSync(catalogPath, JSON.stringify(catalog));
}

main().catch((err) => {
  // The catalog keeps its original addresses: publishing goes on without the light copies
  console.error('[optimize-images] failed, catalog left with the original images:', err.message);
  process.exit(0);
});
