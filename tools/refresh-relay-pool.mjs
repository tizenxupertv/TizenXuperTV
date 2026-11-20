#!/usr/bin/env node
/**
 * Mints fresh anonymous Magis sessions via direct 43404 (fuxok.nguvmqhpk.com)
 * and writes `sessionPool.js` for tizenxuper-relay.
 *
 * Usage:
 *   node tools/refresh-relay-pool.mjs --count 120 --out ../tizenxuper-relay/src/sessionPool.js
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function argVal(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const TARGET_COUNT = Math.max(10, parseInt(argVal('--count', '120'), 10) || 120);
const OUT_FILE = path.resolve(
  process.cwd(),
  argVal('--out', path.join(ROOT_DIR, '..', 'tizenxuper-relay', 'src', 'sessionPool.js'))
);
const BATCH_SIZE = 10;

const CRYPTO_SRC = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'crypto-js.min.js'), 'utf8');
const MAGIS_SRC = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'magis-client.js'), 'utf8');

function mintOne() {
  return new Promise((resolve) => {
    class MiniXHR {
      open(m, u) { this.method = m; this.url = u; this.headers = {}; }
      setRequestHeader(k, v) { this.headers[k] = v; }
      send(body) {
        fetch(this.url, { method: this.method, headers: this.headers, body })
          .then(async (r) => {
            this.status = r.status;
            this.responseText = await r.text();
            if (this.onload) this.onload();
          })
          .catch((e) => {
            this.status = 0;
            if (this.onerror) this.onerror(e);
          });
      }
    }
    const store = new Map();
    const ctx = vm.createContext({
      console: { log() {}, warn() {}, error() {} },
      setTimeout, clearTimeout, setInterval, clearInterval,
      fetch, XMLHttpRequest: MiniXHR,
      Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Uint8Array, ArrayBuffer,
      encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, isFinite,
      crypto: { getRandomValues: (b) => crypto.randomFillSync(b) },
      localStorage: {
        getItem(k) { return store.get(k) ?? null; },
        setItem(k, v) { store.set(k, String(v)); },
        removeItem(k) { store.delete(k); }
      },
      location: { hostname: 'tizen-tv', protocol: 'file:', href: 'file:///index.html' },
      tizen: {},
      navigator: { userAgent: 'Tizen' }
    });
    ctx.window = ctx;
    vm.runInContext(CRYPTO_SRC, ctx);
    vm.runInContext(MAGIS_SRC, ctx);
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    ctx.MagisClient.resolveLive('cyx_5D7BA85AE3F8A2A0921E_720p', (err) => {
      const raw = store.get('xuper_magis_direct_v1');
      if (!err && raw) {
        try {
          const s = JSON.parse(raw);
          if (s.sn && s.snToken && s.userId && s.userToken) {
            return finish({ sn: s.sn, snToken: s.snToken, userId: s.userId, userToken: s.userToken });
          }
        } catch {}
      }
      finish(null);
    });
    setTimeout(() => finish(null), 25000);
  });
}

async function main() {
  const pool = [];
  const seen = new Set();
  const batches = Math.ceil(TARGET_COUNT / BATCH_SIZE);
  for (let b = 0; b < batches && pool.length < TARGET_COUNT; b++) {
    const res = await Promise.all(Array.from({ length: BATCH_SIZE }, () => mintOne()));
    for (const s of res) {
      if (s && !seen.has(s.userId)) {
        seen.add(s.userId);
        pool.push(s);
      }
    }
    console.log(`[refresh-relay-pool] batch ${b + 1}/${batches}: ${pool.length}/${TARGET_COUNT} sessions`);
  }
  if (pool.length < 20) {
    console.error(`[refresh-relay-pool] Too few sessions minted (${pool.length}), aborting overwrite.`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `export const SESSION_POOL = ${JSON.stringify(pool, null, 2)};\n`);
  console.log(`[refresh-relay-pool] Wrote ${pool.length} fresh sessions to ${OUT_FILE}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[refresh-relay-pool] Fatal:', err);
  process.exit(1);
});
