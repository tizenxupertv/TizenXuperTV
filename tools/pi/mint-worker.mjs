/**
 * Lightweight Sequential/Low-Concurrency Session Miner for Raspberry Pi
 * Optimized for ARMv6 512MB RAM single-core CPU.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRYPTO_SRC = fs.readFileSync(path.join(__dirname, 'public/js/crypto-js.min.js'), 'utf8');
const MAGIS_SRC = fs.readFileSync(path.join(__dirname, 'public/js/magis-client.js'), 'utf8');

function mintOne(timeoutMs = 20000) {
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
    const finish = (val) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(val);
      }
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

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
  });
}

async function main() {
  const target = parseInt(process.argv[2] || '10', 10);
  const concurrency = parseInt(process.argv[3] || '2', 10);
  const outPath = process.argv[4] || path.join(__dirname, 'relay-worker/src/sessionPool.js');

  console.log('[mint-worker] Target: ' + target + ' sessions, Concurrency: ' + concurrency);
  const pool = [];
  const seen = new Set();
  const startTime = Date.now();

  // Give up instead of looping forever when the portal stops handing out sessions
  const deadline = startTime + Number(process.env.MINT_MAX_MINUTES || 40) * 60000;
  const minSessions = Math.min(target, Number(process.env.MINT_MIN_SESSIONS || 50));

  async function worker() {
    while (pool.length < target && Date.now() < deadline) {
      const s = await mintOne(22000);
      if (s && !seen.has(s.userId)) {
        seen.add(s.userId);
        pool.push(s);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log('[mint-worker] ' + pool.length + '/' + target + ' sessions (+1 user ' + s.userId + ') [' + elapsed + 's]');
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  if (pool.length < minSessions) {
    console.error('[mint-worker] ERROR: only ' + pool.length + '/' + target + ' sessions (minimum ' + minSessions + '); keeping the current pool');
    process.exit(1);
  }
  if (pool.length < target) {
    console.log('[mint-worker] Time limit reached with ' + pool.length + '/' + target + ' sessions; writing them');
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, 'export const SESSION_POOL = ' + JSON.stringify(pool, null, 2) + ';\n');
  console.log('[mint-worker] Successfully wrote ' + pool.length + ' sessions to ' + outPath);
}

main().catch((err) => {
  console.error('[mint-worker] Fatal:', err);
  process.exit(1);
});
