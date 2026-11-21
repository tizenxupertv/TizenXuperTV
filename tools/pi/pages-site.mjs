#!/usr/bin/env node
/**
 * Publishes the tizenxuper-img Cloudflare Pages site from the Pi: the light image copies (img-cache/*.jpg) and the
 * latest static catalog (site-data/*.json, served at /data/ with CORS), in one deployment so the catalog there never
 * points at an image that is not up yet. tizenxuper-tv.pages.dev/data/ redirects its catalog files here.
 *
 * Free Pages allows 500 deployments a month. A change a TV would show (titles, rows, details) goes out at most every
 * 3 hours; images and the Epic+ fallback snapshots wait up to 12 hours to ride along with one; and no more than MONTH_BUDGET automatic
 * deployments go out in a calendar month.
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
const SEEN = path.join(CACHE, 'image-seen.json');
// Kept this long after no published file points at it: TVs may still hold an older catalog or title page
const KEEP_UNSEEN_MS = 14 * 24 * 3600 * 1000;
const PROJECT = 'tizenxuper-img';
export const PUBLIC_BASE = `https://${PROJECT}.pages.dev`;
// Almost every hourly run has something new (an image, addresses moved to a light copy): with 90 minutes between
// deployments that was ~480 a month, at the free plan's 500. Three hours makes at most 248 (31 days x 8).
const MIN_GAP_MS = 3 * 3600 * 1000;
// Hard stop for automatic deployments in a calendar month, leaving the rest of the 500 for --force by hand
const MONTH_BUDGET = 300;
// New light copies, images to drop and addresses moved to a copy change nothing a TV shows: they wait this long
// for a content change to go out with, and only then go out on their own
const IMAGE_ONLY_GAP_MS = 12 * 3600 * 1000;
const HEADERS = '/data/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300\n';

const log = (msg) => console.log(`[pages-site] ${msg}`);

/** Image keys already live on the site: the catalog may only point at these */
export function publishedKeys() {
  try { return new Set(JSON.parse(fs.readFileSync(STATE, 'utf8'))); } catch { return new Set(); }
}

/**
 * Splits the cached images into the ones still in use and the ones no catalog, See-all page or title page has pointed
 * at for KEEP_UNSEEN_MS. Without this every image ever made stayed in each deployment (free Pages: 20,000 files).
 * A copy not published yet counts as in use: the data still has its original address until it goes up.
 */
function splitStale(keys, dataFiles) {
  const now = Date.now();
  const seen = (() => { try { return JSON.parse(fs.readFileSync(SEEN, 'utf8')); } catch { return {}; } })();
  // One file at a time: the catalog and the details together are several MB
  for (const f of dataFiles) {
    for (const m of fs.readFileSync(path.join(DATA, f), 'utf8').matchAll(/\/([a-f0-9]{20})\.jpg/g)) seen[m[1]] = now;
  }
  const live = [];
  const stale = [];
  const next = {};
  for (const k of keys) {
    next[k] = seen[k] || now;
    (now - next[k] > KEEP_UNSEEN_MS ? stale : live).push(k);
  }
  return { live, stale, seen: next };
}

/**
 * A hash per data file of what a TV would show from it: the image addresses (portal original or light copy), the
 * inline previews and generatedAt are left out, so a file that only moved to light copies counts as unchanged.
 */
const SKIP_KEYS = new Set(['posterThumb', 'backdropThumb', 'generatedAt']);
const IMAGE_URL = /^https?:\/\/.*(?:\/public\/images\/|\.(?:jpe?g|png|webp)(?:\?.*)?$)/i;

export function contentSigs(dataFiles) {
  const sigs = {};
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.has(k)) o[k] = strip(x);
      return o;
    }
    return typeof v === 'string' && IMAGE_URL.test(v) ? 'IMG' : v;
  };
  // One file at a time: the catalog alone is a few MB
  for (const f of dataFiles) {
    let text;
    try { text = JSON.stringify(strip(JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')))); } catch { text = String(Math.random()); }
    sigs[f] = crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
  }
  return sigs;
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
  const allKeys = fs.readdirSync(CACHE).filter((f) => /^[a-f0-9]{20}\.jpg$/.test(f)).map((f) => f.slice(0, -4));
  // The catalog files, the titles' details (generate-details.mjs) and the See-all pages (generate-columns.mjs)
  const listJson = (sub) => {
    const dir = path.join(DATA, sub);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => (sub ? `${sub}/${f}` : f)) : [];
  };
  const dataFiles = [...listJson(''), ...listJson('detail'), ...listJson('column')];
  const { live: keys, stale, seen } = splitStale(allKeys, dataFiles);
  fs.writeFileSync(SEEN, JSON.stringify(seen));
  const published = publishedKeys();
  const newImages = keys.filter((k) => !published.has(k)).length;
  const goneImages = stale.filter((k) => published.has(k)).length;
  const newerFiles = dataFiles.some((f) => fs.statSync(path.join(DATA, f)).mtimeMs > (site.lastDeployAt || 0));
  // What a TV would see differently: titles, rows, details. Compared with what the last deployment carried.
  const sigs = contentSigs(dataFiles);
  const before = site.sigs || {};
  const changed = [...dataFiles.filter((f) => before[f] !== sigs[f]), ...Object.keys(before).filter((f) => !(f in sigs))];
  // The Epic+ snapshots are only the TVs' fallback and the agenda changes all day: they wait like images
  const minor = (f) => /^epic-/.test(f);
  const changedFiles = changed.filter((f) => !minor(f)).length;
  const minorFiles = changed.filter(minor).length;

  if (!changedFiles && !minorFiles && !newImages && !goneImages && !newerFiles) return log('nothing new to publish');
  const what = `${changedFiles} data files changed, ${newImages} new images${goneImages ? `, ${goneImages} to remove` : ''}${minorFiles ? `, Epic+ snapshots changed` : ''}`;
  const gap = changedFiles ? MIN_GAP_MS : IMAGE_ONLY_GAP_MS;
  const wait = (site.lastDeployAt || 0) + gap - Date.now();
  if (wait > 0 && !force) return log(`changes waiting (${what}); next deployment allowed in ${Math.ceil(wait / 60000)} min`);
  const month = new Date().toISOString().slice(0, 7);
  const monthCount = site.month === month ? site.monthCount || 0 : 0;
  if (monthCount >= MONTH_BUDGET && !force) return log(`monthly budget used (${monthCount}/${MONTH_BUDGET} deployments in ${month}); waiting for next month or --force`);

  const entries = [
    ...keys.map((k) => ({ path: `/${k}.jpg`, file: path.join(CACHE, `${k}.jpg`), type: 'image/jpeg' })),
    ...dataFiles.map((f) => ({ path: `/data/${f}`, file: path.join(DATA, f), type: 'application/json' }))
  ];
  const { uploaded, id } = await deploy(loadEnv(), entries);
  fs.writeFileSync(STATE, JSON.stringify(keys));
  fs.writeFileSync(SITE_STATE, JSON.stringify({ lastDeployAt: Date.now(), deployment: id, month, monthCount: monthCount + 1, sigs }));
  // Off the site now: the local copies go too (optimize-images makes a new one if the image comes back)
  for (const k of stale) fs.rmSync(path.join(CACHE, `${k}.jpg`), { force: true });
  log(`deployed ${keys.length} images and ${dataFiles.length} data files (${uploaded} uploaded, ${stale.length} old images removed), ${id}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    // The GitHub copy of the catalog is already published; the site catches up on the next run
    console.error('[pages-site] failed:', err.message);
    process.exit(0);
  });
}
