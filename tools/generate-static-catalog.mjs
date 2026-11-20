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
const ROOT_DIR = fs.existsSync(path.join(__dirname, 'public')) ? __dirname : path.resolve(__dirname, '..');
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
      // Allow relay session acquisition (uses pooled session minted from home)
      // Headers (X-Tizen-Sig, X-Tizen-Time, etc.) will pass cleanly to the Relay
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

  console.log('4. Fetching Epic+ Perelman channels...');
  try {
    const epicRes = await fetch('https://epictvparaiphone.top/canales', {
      headers: {
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 13; SM-S918B Build/TP1A.220624.014)',
        'X-Llave': '7hA4oMy1vmGSFJjbrAWx-xneFQEY_PAq',
        'X-Aparato': 'a1b2c3d4',
        'X-Pulsera': '1',
        'Accept': 'application/json'
      }
    });
    if (epicRes.ok) {
      const epicRaw = await epicRes.json();
      const LOGO_BASE = 'https://epictvparaiphone.top';
      const logoById = {
        'epic-espn': `${LOGO_BASE}/logos/canales/ESPN_color.png?v=18`,
        'epic-espn2': `${LOGO_BASE}/logos/canales/ESPN_2_color.png?v=18`,
        'epic-espn3': `${LOGO_BASE}/logos/canales/ESPN_3_color.png?v=18`,
        'epic-espn4': `${LOGO_BASE}/logos/canales/ESPN_4_color.png?v=18`,
        'epic-espn5': `${LOGO_BASE}/logos/canales/ESPN_5_color.png?v=18`,
        'epic-espn6': `${LOGO_BASE}/logos/canales/ESPN_6_color.png?v=18`,
        'epic-espn7': `${LOGO_BASE}/logos/canales/ESPN_7_color.png?v=18`,
        'epic-dsportsperu': `${LOGO_BASE}/logos/canales/dsports_color.png?v=18`,
        'epic-dsports2': `${LOGO_BASE}/logos/canales/dsports_2_color.png?v=18`,
        'epic-dsportsplus': `${LOGO_BASE}/logos/canales/dsports_plus_color.png?v=18`,
        'epic-winsportsplus': `${LOGO_BASE}/logos/canales/win_sports_plus_color.png?v=18`,
        'epic-winsports': `${LOGO_BASE}/logos/canales/win_sports_color.png?v=18`,
        'epic-l1max': `${LOGO_BASE}/logos/canales/L1_max_color.png?v=18`,
        'epic-l1': `${LOGO_BASE}/logos/canales/l1_color.png?v=18`,
        'epic-zappingsports': `${LOGO_BASE}/logos/canales/zapping_sports_color.png?v=18`,
        'epic-zappingsportsplus': `${LOGO_BASE}/logos/canales/zapping_sports_plus_color.png?v=18`,
        'epic-dtvcplus': `${LOGO_BASE}/logos/canales/deportes_tvc_color.png?v=18`,
        'epic-bicolorpremium': `${LOGO_BASE}/logos/canales/Bicolor_plus_premium_color.png?v=18`,
        'epic-bicolorpremium2': `${LOGO_BASE}/logos/canales/Bicolor_plus_premium_2_color.png?v=18`,
        'epic-bicolorplus': `${LOGO_BASE}/logos/canales/Bicolor_plus_color.png?v=18`,
        'epic-entelgol': `${LOGO_BASE}/logos/canales/entel_gol_color.png?v=18`,
        'epic-entelgolplus': `${LOGO_BASE}/logos/canales/entel_gol_plus_color_liviano.png?v=18`,
        'epic-futbolcanal': `${LOGO_BASE}/logos/canales/futbol_canal_color.png?v=18`,
        'epic-unitel': `${LOGO_BASE}/logos/canales/unitel_color.png?v=18`,
        'epic-unitelscz': `${LOGO_BASE}/logos/canales/unitel_color.png?v=18`,
        'epic-reduno': `${LOGO_BASE}/logos/canales/red_uno_color_liviano.png?v=18`,
        'epic-bolivision': `${LOGO_BASE}/logos/canales/bolivision_color.png?v=18`,
        'epic-atb': `${LOGO_BASE}/logos/canales/atb_color.png?v=18`,
        'epic-boliviatv': `${LOGO_BASE}/logos/canales/bolivia_tv_color.png?v=18`,
        'epic-teleamazonas': `${LOGO_BASE}/logos/canales/teleamazonas_color.png?v=18`,
        'epic-antena3': `${LOGO_BASE}/logos/canales/antena_3_color.png?v=18`,
        'epic-cuatro': `${LOGO_BASE}/logos/canales/cuatro_color.png?v=18`,
        'epic-americatv': `${LOGO_BASE}/logos/canales/america_tv_color.png?v=18`,
        'epic-lasexta': `${LOGO_BASE}/logos/canales/lasexta_color.png?v=18`,
        'epic-telecinco': `${LOGO_BASE}/logos/canales/telecinco_color.png?v=18`
      };
      const nameOverrides = {
        'epic-espn': 'ESPN',
        'epic-dsportsperu': 'DSports',
        'epic-dsports2': 'DSports 2',
        'epic-dsportsplus': 'DSports+'
      };
      const normalizeRegion = (c) => {
        const f = String(c.folder || '').trim();
        return (!f || f.includes(',') || f.toLowerCase() === 'otros') ? 'Latinoamérica' : f;
      };
      const regionOrder = (r) => r === 'Latinoamérica' ? '0' : r === 'Colombia' ? '1' : '2' + r.toLowerCase();
      const latamOrder = (n) => {
        const l = n.toLowerCase();
        return l.startsWith('espn') ? '0' + l : l.startsWith('dsports') ? '1' + l : '2' + l;
      };

      const seenEpic = new Set();
      const channels = [];
      for (const c of (Array.isArray(epicRaw) ? epicRaw : [])) {
        if (!c || c.fuente !== 'perelman' || typeof c.url !== 'string') continue;
        const rawId = String(c.id || '').replace(/^pere-/, '');
        const id = `epic-${rawId}`;
        if (!rawId || seenEpic.has(id)) continue;
        seenEpic.add(id);
        const streamUrl = c.url.startsWith('http')
          ? (c.url.endsWith('.m3u8') ? c.url : `${c.url}.m3u8`)
          : `${LOGO_BASE}/perelman/${rawId}.m3u8`;
        const cleanName = String(c.name || c.nombre || rawId).replace(/\s*·\s*[^·]+$/, '').trim();
        channels.push({
          id,
          code: id,
          name: nameOverrides[id] || cleanName,
          categoryName: normalizeRegion(c),
          time: 'EN VIVO',
          url: streamUrl,
          logo: c.logo ? (c.logo.startsWith('http') ? c.logo : `${LOGO_BASE}${c.logo}`) : (logoById[id] || '')
        });
      }
      channels.sort((a, b) => {
        const ra = regionOrder(a.categoryName);
        const rb = regionOrder(b.categoryName);
        if (ra !== rb) return ra.localeCompare(rb, 'es');
        if (a.categoryName === 'Latinoamérica') return latamOrder(a.name).localeCompare(latamOrder(b.name), 'es');
        return a.name.localeCompare(b.name, 'es');
      });

      const epicPath = path.join(OUT_DIR, 'epic-channels.json');
      fs.writeFileSync(epicPath, JSON.stringify({ generatedAt: new Date().toISOString(), channels }));
      console.log(`   Wrote ${epicPath} (${channels.length} channels, ${Math.round(fs.statSync(epicPath).size / 1024)} KB)`);
    }
  } catch (e) {
    console.warn(`   Epic+ channels FAILED: ${e.message}`);
  }

  console.log('5. Fetching Epic+ agenda fallback snapshot...');
  try {
    const agendaRes = await fetch('https://epictvparaiphone.top/menu?all=1&recetas=aparte&agenda=propia&v=800&tz=America%2FBogota&idioma=es', {
      headers: {
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 13; SM-S918B Build/TP1A.220624.014)',
        'X-Llave': '7hA4oMy1vmGSFJjbrAWx-xneFQEY_PAq',
        'X-Aparato': 'a1b2c3d4',
        'X-Pulsera': '1',
        'Accept': 'application/json'
      }
    });
    if (agendaRes.ok) {
      const agendaTxt = await agendaRes.text();
      if (agendaTxt && agendaTxt.trim().startsWith('{')) {
        const agendaPath = path.join(OUT_DIR, 'epic-agenda.json');
        fs.writeFileSync(agendaPath, agendaTxt);
        console.log(`   Wrote ${agendaPath} (${Math.round(fs.statSync(agendaPath).size / 1024)} KB)`);
      }
    }
  } catch (e) {
    console.warn(`   Epic+ agenda FAILED: ${e.message}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
