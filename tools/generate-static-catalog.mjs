#!/usr/bin/env node
/**
 * Generates fresh static JSON snapshots (`live-channels.json` and `portal-catalog.json`)
 * directly from the Magis portal (bypassing the Cloudflare relay) so TVs can load the
 * Home catalog and all 38 Live TV categories with 0 Worker requests.
 *
 * Usage:
 *   node tools/generate-static-catalog.mjs --out build/static-data
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_ARG_IDX = process.argv.indexOf('--out');
const OUT_DIR = OUT_ARG_IDX !== -1 && process.argv[OUT_ARG_IDX + 1]
  ? path.resolve(process.cwd(), process.argv[OUT_ARG_IDX + 1])
  : path.join(ROOT_DIR, 'build', 'static-data');

const PORTAL_HOSTS = [
  'neqpsx.6dqtl974.com',
  'lvmcmb.6dqtl974.com',
  'dqbvvb.wg5h6vjz.com',
  'eajmnp.hcgv1dt8.com'
];

function createDirectMagisClient() {
  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Promise,
    Uint8Array,
    ArrayBuffer,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    crypto: { getRandomValues: (b) => crypto.randomFillSync(b) },
    localStorage: {
      _d: {},
      getItem(k) { return this._d[k] || null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; }
    },
    sessionStorage: {
      _d: {},
      getItem(k) { return this._d[k] || null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; }
    },
    location: { hostname: 'tizen.tv', protocol: 'file:' },
    navigator: { userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 9.0) AppleWebKit/537.36' }
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.__XUPER_SKIP_STATIC_CATALOG__ = true;

  let hostIdx = 0;
  function XMLHttpRequest() {
    this._headers = {};
  }
  XMLHttpRequest.prototype.open = function (m, u) {
    this._m = m;
    this._u = u;
    this.readyState = 1;
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    this._headers[k] = v;
  };
  XMLHttpRequest.prototype.send = function (body) {
    let u = this._u;
    const h = Object.assign({}, this._headers);
    if (u.includes('/api/portalCore/')) {
      const targetHost = h['X-Target-Host'] || PORTAL_HOSTS[hostIdx++ % PORTAL_HOSTS.length];
      u = u.replace('https://tizenxuper-relay.tizenxupertv.workers.dev', 'https://' + targetHost);
      if (h['X-Cookie']) {
        h['Cookie'] = h['X-Cookie'];
        delete h['X-Cookie'];
      }
      delete h['X-Target-Host'];
      delete h['X-Tizen-Time'];
      delete h['X-Tizen-Duid'];
      delete h['X-Tizen-Sig'];
    } else if (u.includes('/session/fallback')) {
      this.status = 404;
      this.readyState = 4;
      if (this.onload) this.onload();
      return;
    }
    fetch(u, { method: this._m, headers: h, body: body || undefined })
      .then(async (r) => {
        this.status = r.status;
        this.responseURL = r.url;
        this.responseText = await r.text();
        this._resHeaders = r.headers;
        this.readyState = 4;
        if (this.onload) this.onload();
        if (this.onreadystatechange) this.onreadystatechange();
      })
      .catch((e) => {
        this.status = 0;
        this.readyState = 4;
        if (this.onerror) this.onerror(e);
        if (this.onreadystatechange) this.onreadystatechange();
      });
  };
  XMLHttpRequest.prototype.getResponseHeader = function (k) {
    return this._resHeaders ? this._resHeaders.get(k) : null;
  };
  ctx.XMLHttpRequest = XMLHttpRequest;

  const jsDir = path.join(ROOT_DIR, 'public', 'js');
  vm.runInContext(fs.readFileSync(path.join(jsDir, 'crypto-js.min.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(jsDir, 'magis-client.js'), 'utf8'), ctx);
  return ctx.MagisClient;
}

function pCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = createDirectMagisClient();

  console.log('1. Establishing direct Magis session...');
  await pCall(client.ensureSession);

  console.log('2. Fetching dynamic live categories...');
  const rawCats = await pCall(client.getLiveCategories);
  const categories = rawCats.filter((c) => c && !c.isAddon);
  console.log(`   Found ${categories.length} live categories.`);

  const channelsByCategory = {};
  for (const cat of categories) {
    try {
      const chs = await pCall(client.getAllLiveChannels, cat.id);
      channelsByCategory[String(cat.id)] = Array.isArray(chs) ? chs : [];
      console.log(`   [${cat.id}] ${cat.name}: ${channelsByCategory[String(cat.id)].length} channels`);
    } catch (e) {
      console.warn(`   [${cat.id}] ${cat.name}: FAILED (${e.message})`);
      channelsByCategory[String(cat.id)] = [];
    }
  }

  const liveOut = {
    generatedAt: new Date().toISOString(),
    categories,
    channelsByCategory
  };
  const livePath = path.join(OUT_DIR, 'live-channels.json');
  fs.writeFileSync(livePath, JSON.stringify(liveOut));
  console.log(`   Wrote ${livePath} (${Math.round(fs.statSync(livePath).size / 1024)} KB)`);

  console.log('3. Fetching VOD/Home roots...');
  const roots = ['featured', 'movies', 'series', 'kids', 'anime', 'explorar'];
  const itemsByRoot = {};
  const recommends = {};
  const allItems = [];
  const seenKey = new Set();

  for (const root of roots) {
    try {
      const res = await pCall(client.home, root, 1);
      const list = (res && res.items) || [];
      itemsByRoot[root] = list;
      for (const it of list) {
        const k = `${it.id}::${it.row || ''}::${it.category || ''}`;
        if (!seenKey.has(k)) {
          seenKey.add(k);
          allItems.push(it);
        }
      }
      console.log(`   home(${root}): ${list.length} items`);
    } catch (e) {
      console.warn(`   home(${root}): FAILED (${e.message})`);
      itemsByRoot[root] = [];
    }

    try {
      const rec = await pCall(client.getTabRecommends, root);
      if (Array.isArray(rec) && rec.length) {
        recommends[root] = rec;
        console.log(`   recommends(${root}): ${rec.length} items`);
      }
    } catch {}
  }

  const portalOut = {
    generatedAt: new Date().toISOString(),
    source: 'Magis portal (auto-updated static snapshot)',
    itemsByRoot,
    recommends,
    items: allItems
  };
  const portalPath = path.join(OUT_DIR, 'portal-catalog.json');
  fs.writeFileSync(portalPath, JSON.stringify(portalOut));
  console.log(`   Wrote ${portalPath} (${Math.round(fs.statSync(portalPath).size / 1024)} KB)`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
