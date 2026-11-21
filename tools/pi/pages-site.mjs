#!/usr/bin/env node
/**
 * Publishes the tizenxuper-img Cloudflare Pages site from the Pi: the light image copies (img-cache/*.jpg) and the
 * latest static catalog (site-data/*.json, served at /data/ with CORS), in one deployment so the catalog there never
 * points at an image that is not up yet. tizenxuper-tv.pages.dev/data/ redirects its catalog files here.
 *
 * Free Pages allows 500 deployments a month: at most one every 90 minutes (~480), and only when something changed.
 * Uses the direct-upload API (the calls wrangler makes; wrangler does not run on ARMv6).
 *
 * Usage: node pages-site.mjs [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const CACHE = process.env.IMG_CACHE_DIR || path.join(DIR, 'img-cache');
const DATA = path.join(DIR, 'site-data');
const STATE = path.join(CACHE, 'published.json');
const SITE_STATE = path.join(CACHE, 'site-state.json');
const HASHES = path.join(CACHE, 'site-hashes.json');
const PROJECT = 'tizenxuper-img';
export const PUBLIC_BASE = `https://${PROJECT}.pages.dev`;
const MIN_GAP_MS = 90 * 60 * 1000;
const HEADERS = '/data/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300\n';

const log = (msg) => console.log(`[pages-site] ${msg}`);

/** Image keys already live on the site: the catalog may only point at these */
export function publishedKeys() {
  try { return new Set(JSON.parse(fs.readFileSync(STATE, 'utf8'))); } catch { return new Set(); }
}

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(DIR, '.env.pi'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

async function deploy(env, entries) {
  const api = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT}`;
  const auth = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
  // The upload token is short-lived: a fresh one for each request of a long upload
  const jwt = async () => {
    const t = await (await fetch(`${api}/upload-token`, { headers: auth })).json();
    if (!t.success) throw new Error('upload-token: ' + JSON.stringify(t.errors));
    return { Authorization: `Bearer ${t.result.jwt}`, 'Content-Type': 'application/json' };
  };

  // Only hashes stay in memory: holding every file in base64 (~240 MB for 1,800 images) ran the B+ out of memory.
  // A hash is reused while the file's size and date are the same.
  const known = (() => { try { return JSON.parse(fs.readFileSync(HASHES, 'utf8')); } catch { return {}; } })();
  const hashes = {};
  const manifest = {};
  const fileOf = new Map();
  for (const e of entries) {
    const st = fs.statSync(e.file);
    const sig = `${st.size}:${Math.round(st.mtimeMs)}`;
    let hash = known[e.file] && known[e.file].sig === sig ? known[e.file].hash : null;
    if (!hash) {
      const b64 = fs.readFileSync(e.file).toString('base64');
      hash = crypto.createHash('sha256').update(b64 + path.extname(e.file).slice(1)).digest('hex').slice(0, 32);
    }
    hashes[e.file] = { sig, hash };
    manifest[e.path] = hash;
    fileOf.set(hash, e);
  }
  fs.writeFileSync(HASHES, JSON.stringify(hashes));
  const all = [...fileOf.keys()];
  const missing = await (await fetch('https://api.cloudflare.com/client/v4/pages/assets/check-missing', {
    method: 'POST', headers: await jwt(), body: JSON.stringify({ hashes: all })
  })).json();
  if (!missing.success) throw new Error('check-missing: ' + JSON.stringify(missing.errors));
  const toUpload = missing.result || [];
  log(`${all.length} files, ${toUpload.length} to upload`);
  // Small batches, each file read only when its batch goes up
  for (let i = 0; i < toUpload.length; i += 20) {
    const batch = toUpload.slice(i, i + 20).map((h) => {
      const e = fileOf.get(h);
      return { key: h, value: fs.readFileSync(e.file).toString('base64'), metadata: { contentType: e.type }, base64: true };
    });
    const up = await (await fetch('https://api.cloudflare.com/client/v4/pages/assets/upload', {
      method: 'POST', headers: await jwt(), body: JSON.stringify(batch)
    })).json();
    if (!up.success) throw new Error('upload: ' + JSON.stringify(up.errors));
    if ((i / 20) % 10 === 0) log(`uploaded ${Math.min(i + 20, toUpload.length)}/${toUpload.length} · heap ${Math.round(process.memoryUsage().heapUsed / 1048576)} MB`);
  }
  await fetch('https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes', {
    method: 'POST', headers: await jwt(), body: JSON.stringify({ hashes: all })
  });
  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest));
  form.append('branch', 'main');
  form.append('_headers', new Blob([HEADERS]), '_headers');
  const dep = await (await fetch(`${api}/deployments`, { method: 'POST', headers: auth, body: form })).json();
  if (!dep.success) throw new Error('deployment: ' + JSON.stringify(dep.errors));
  return { uploaded: toUpload.length, id: dep.result.id };
}

async function main() {
  const force = process.argv.includes('--force');
  const site = (() => { try { return JSON.parse(fs.readFileSync(SITE_STATE, 'utf8')); } catch { return { lastDeployAt: 0 }; } })();
  const keys = fs.readdirSync(CACHE).filter((f) => /^[a-f0-9]{20}\.jpg$/.test(f)).map((f) => f.slice(0, -4));
  // The catalog files, the titles' details (generate-details.mjs) and the See-all pages (generate-columns.mjs)
  const listJson = (sub) => {
    const dir = path.join(DATA, sub);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => (sub ? `${sub}/${f}` : f)) : [];
  };
  const dataFiles = [...listJson(''), ...listJson('detail'), ...listJson('column')];
  const published = publishedKeys();
  const newImages = keys.filter((k) => !published.has(k)).length;
  const newData = dataFiles.some((f) => fs.statSync(path.join(DATA, f)).mtimeMs > (site.lastDeployAt || 0));

  if (!newImages && !newData) return log('nothing new to publish');
  const wait = (site.lastDeployAt || 0) + MIN_GAP_MS - Date.now();
  if (wait > 0 && !force) return log(`changes waiting (${newImages} images${newData ? ', catalog' : ''}); next deployment allowed in ${Math.ceil(wait / 60000)} min`);

  const entries = [
    ...keys.map((k) => ({ path: `/${k}.jpg`, file: path.join(CACHE, `${k}.jpg`), type: 'image/jpeg' })),
    ...dataFiles.map((f) => ({ path: `/data/${f}`, file: path.join(DATA, f), type: 'application/json' }))
  ];
  const { uploaded, id } = await deploy(loadEnv(), entries);
  fs.writeFileSync(STATE, JSON.stringify(keys));
  fs.writeFileSync(SITE_STATE, JSON.stringify({ lastDeployAt: Date.now(), deployment: id }));
  log(`deployed ${keys.length} images and ${dataFiles.length} data files (${uploaded} uploaded), ${id}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    // The GitHub copy of the catalog is already published; the site catches up on the next run
    console.error('[pages-site] failed:', err.message);
    process.exit(0);
  });
}
