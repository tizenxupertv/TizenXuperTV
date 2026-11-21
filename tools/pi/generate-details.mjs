#!/usr/bin/env node
/**
 * Details of the catalog's titles (the portal's v4/getItemData answer), published by pages-site.mjs at
 * /data/detail/<id>.json. The app reads one before asking the portal (magis-client.js, fetchStaticDetail): a title
 * page then opens with no session and no portal call. Details change little, so each one is refreshed once a day.
 * Only public metadata is kept (names, synopsis, cast, artwork, episode list): no session data is ever in it.
 *
 * Usage: node generate-details.mjs [portal-catalog.json]   (default site-data/portal-catalog.json)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPortalClient } from './portal-client.mjs';
import { PUBLIC_BASE, publishedKeys } from './pages-site.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'site-data', 'detail');
const MAX_AGE_MS = 20 * 3600 * 1000;
const KEEP_UNUSED_MS = 7 * 24 * 3600 * 1000;
const CALL_TIMEOUT_MS = 30_000;

const log = (msg) => console.log(`[details] ${msg}`);
const keyOf = (url) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 20);

/** Each title's id and the getItemData type to ask first, as detail() in magis-client.js: '1' for movies, '0' for the rest */
function catalogIds(catalog) {
  const ids = new Map();
  const visit = (n) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== 'object') return;
    if (typeof n.id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(n.id) && !n.collectionId && (n.poster || n.title)) {
      if (!ids.has(n.id)) ids.set(n.id, n.type === 'movie' || n.kind === 'película' ? '1' : '0');
    }
    Object.values(n).forEach(visit);
  };
  visit(catalog.itemsByRoot || {});
  visit(catalog.recommends || {});
  return ids;
}

/**
 * v4/getItemData for a title, trying the other type once when the portal says it is the wrong one (as detail() does).
 * Always asking type '0' first failed for every movie: 197 of 526 calls on 2026-11-21.
 */
function fetchItem(client, id, type, retried = false) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, CALL_TIMEOUT_MS);
    client.call('v4/getItemData', { contentId: id, type, sortType: '0', language: 'en', macAddr: '' }, (err, res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err && (err.portalCode === 'portal100006' || err.portalCode === 'portal100008') && !retried) {
        return resolve(fetchItem(client, id, type === '0' ? '1' : '0', true));
      }
      resolve(!err && res && res.assetData ? res : null);
    });
  });
}

/** Points the artwork at the Pi's light copies where they are published */
function lightenImages(node, published) {
  if (Array.isArray(node)) return node.forEach((n) => lightenImages(n, published));
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && /^https?:\/\/[^/]+\/public\/images\//.test(v) && published.has(keyOf(v))) node[k] = `${PUBLIC_BASE}/${keyOf(v)}.jpg`;
    else lightenImages(v, published);
  }
}

async function main() {
  const catalogPath = process.argv[2] || path.join(DIR, 'site-data', 'portal-catalog.json');
  const ids = catalogIds(JSON.parse(fs.readFileSync(catalogPath, 'utf8')));
  fs.mkdirSync(OUT, { recursive: true });
  const published = publishedKeys();
  const now = Date.now();
  const due = [...ids.keys()].filter((id) => {
    try { return now - fs.statSync(path.join(OUT, `${id}.json`)).mtimeMs > MAX_AGE_MS; } catch { return true; }
  });
  log(`${ids.size} titles in the catalog, ${due.length} to refresh`);

  const client = due.length ? createPortalClient() : null;
  let written = 0;
  let failed = 0;
  for (const id of due) {
    const res = await fetchItem(client, id, ids.get(id));
    if (!res) { failed++; continue; }
    lightenImages(res, published);
    const file = path.join(OUT, `${id}.json`);
    // Written whole and renamed: a stopped run never leaves half a file to publish
    fs.writeFileSync(file + '.part', JSON.stringify({ assetData: res.assetData }));
    fs.renameSync(file + '.part', file);
    written++;
  }

  // Titles that left the catalog: kept a week for TVs still holding an older catalog
  const keep = new Set(ids.keys());
  let removed = 0;
  for (const f of fs.readdirSync(OUT)) {
    const id = f.replace(/\.json(\.part)?$/, '');
    const p = path.join(OUT, f);
    if (f.endsWith('.part') || (!keep.has(id) && now - fs.statSync(p).mtimeMs > KEEP_UNUSED_MS)) { fs.rmSync(p, { force: true }); removed++; }
  }
  log(`${written} details written, ${failed} failed, ${removed} old ones removed, ${fs.readdirSync(OUT).length} in total`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[details] failed:', err.message);
  process.exit(1);
});
