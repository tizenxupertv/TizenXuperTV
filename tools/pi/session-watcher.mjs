#!/usr/bin/env node
/**
 * TizenXuper Pi — Session Lifetime Monitor (permanente)
 * Fixed for MagisClient SEC + ARMv6 single-concurrency
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE  = path.join(__dirname, '.env.pi');
const LOG_FILE  = path.join(__dirname, 'session-watcher.log');

const CRYPTO_SRC = fs.readFileSync(path.join(__dirname, 'public/js/crypto-js.min.js'), 'utf8');
const MAGIS_SRC  = fs.readFileSync(path.join(__dirname, 'public/js/magis-client.js'), 'utf8');

const ADMIN_ID   = '68683111';
const PROBES = [
  { name: 'A', intervalMin: 10 },
  { name: 'B', intervalMin: 60 },
  { name: 'C', intervalMin: 180 },
];

function loadEnv() {
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function tgSend(token, text) {
  if (!token) return;
  await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: ADMIN_ID, text, parse_mode: 'HTML' }),
  }).catch(() => {});
}

function mintOne(timeoutMs = 25000) {
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
        removeItem(k) { store.delete(k); },
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

async function probeSession(session) {
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
    store.set('xuper_magis_direct_v1', JSON.stringify(session));
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
        removeItem(k) { store.delete(k); },
      },
      location: { hostname: 'tizen-tv', protocol: 'file:', href: 'file:///index.html' },
      tizen: {},
      navigator: { userAgent: 'Tizen' }
    });
    ctx.window = ctx;

    vm.runInContext(CRYPTO_SRC, ctx);
    vm.runInContext(MAGIS_SRC, ctx);

    let done = false;
    const finish = (res) => { if (!done) { done = true; clearTimeout(timer); resolve(res); } };
    const timer = setTimeout(() => finish('timeout'), 20000);

    ctx.MagisClient.resolveLive('cyx_5D7BA85AE3F8A2A0921E_720p', (err, res) => {
      if (err) {
        const msg = String(err.message || err.error || err);
        finish(msg);
      } else {
        finish('OK');
      }
    });
  });
}

async function runCycle(token) {
  log('=== Nuevo ciclo: minando 3 sesiones ===');
  const sessions = [];
  for (const probe of PROBES) {
    const s = await mintOne(25000);
    if (s) {
      sessions.push({ ...probe, session: s, mintedAt: Date.now(), expired: false });
      log('minted ' + probe.name + ' (user ' + s.userId + ', sondeo cada ' + probe.intervalMin + ' min)');
    } else {
      log('WARN: no se pudo minar sesión ' + probe.name);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (sessions.length === 0) {
    await tgSend(token, '⚠️ <b>Session Watcher</b>: No se pudo minar ninguna sesión de prueba.');
    setTimeout(() => runCycle(token), 30 * 60000);
    return;
  }

  let activeCount = sessions.length;

  for (const item of sessions) {
    const intervalMs = item.intervalMin * 60000;
    const timer = setInterval(async () => {
      const elapsed = Math.round((Date.now() - item.mintedAt) / 60000);
      const code = await probeSession(item.session);
      const isExpired = code.includes('100027') || code.includes('100003') || code.includes('100024');
      log(item.name + ' t=' + elapsed + 'min -> ' + code + (isExpired ? ' EXPIRADA' : ' OK'));

      if (isExpired && !item.expired) {
        item.expired = true;
        clearInterval(timer);
        activeCount--;
        await tgSend(token,
          '🔑 <b>Sesión ' + item.name + ' expiró a los ' + elapsed + ' minutos</b>\n' +
          'Código: <code>' + code + '</code>\n— Pi Session Watcher'
        );
        if (activeCount === 0) {
          log('=== Todas las sesiones expiraron, nuevo ciclo en 2 min ===');
          setTimeout(() => runCycle(token), 2 * 60000);
        }
      }
    }, intervalMs);
  }
}

async function main() {
  log('TizenXuper Session Watcher iniciado');
  const env = loadEnv();
  await runCycle(env.TELEGRAM_TOKEN);
}

main().catch((err) => {
  log('Fatal error: ' + err.message);
});
