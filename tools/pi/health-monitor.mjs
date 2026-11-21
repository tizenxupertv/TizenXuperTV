#!/usr/bin/env node
/**
 * TizenXuper Pi — Health Monitor + Telegram Alerter
 *
 * Checks every 15 minutes:
 *   1. Cloudflare relay worker is responding (its open /time route: every other route needs a TV's signature)
 *   2. The session pool the Pi last deployed is recent and not empty (relay-worker/src/sessionPool.js)
 *   3. The catalog update ran recently (update-catalog.sh touches .catalog-ok when it finishes)
 *
 * Sends a Telegram message to the admin (SUPPORT_CHAT_ID) on failure.
 * Sends a recovery message when the service is back up.
 *
 * Usage: node health-monitor.mjs
 * Logs: health-monitor.log (same dir)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logTime } from './log-time.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env.pi');
const LOG_FILE = path.join(__dirname, 'health-monitor.log');

// ── Config ─────────────────────────────────────────────────────────────────
const RELAY_URL        = 'https://tizenxuper-relay.tizenxupertv.workers.dev';
const POOL_FILE        = path.join(__dirname, 'relay-worker', 'src', 'sessionPool.js');
const CATALOG_STAMP    = path.join(__dirname, '.catalog-ok');
const ADMIN_CHAT_ID    = '68683111';
const CHECK_INTERVAL   = 15 * 60 * 1000;   // 15 min
// The pool is renewed every 6 h and the catalog every 3 h: one missed run is tolerated before alerting
const MAX_POOL_AGE     = 13 * 60 * 60 * 1000;
const MAX_CATALOG_AGE  = 7 * 60 * 60 * 1000;
const hoursAgo = (ms) => `hace ${Math.round((Date.now() - ms) / 3600000)} h`;

// ── Load secrets ────────────────────────────────────────────────────────────
function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) throw new Error(`Missing ${ENV_FILE}`);
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${logTime()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function tgSend(token, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: 'HTML' }),
  });
  return res.ok;
}

// ── Checks ───────────────────────────────────────────────────────────────────
async function checkRelay() {
  try {
    // /health and /session/ping never existed: the relay answered 401 to them, a false alarm on every restart
    const res = await fetch(`${RELAY_URL}/time`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    if (!body || body.ok !== true) return { ok: false, reason: 'respuesta inesperada de /time' };
    if (body.relayMode === 'off') return { ok: false, reason: 'relay apagado (relayMode off)' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function checkSessionPool() {
  // The relay has no open route for its pool; the Pi's last deployed copy tells its age and size
  try {
    const st = fs.statSync(POOL_FILE);
    const count = (fs.readFileSync(POOL_FILE, 'utf8').match(/"snToken"/g) || []).length;
    if (!count) return { ok: false, reason: 'El pool desplegado no tiene sesiones' };
    if (Date.now() - st.mtimeMs > MAX_POOL_AGE) return { ok: false, reason: `Pool sin renovar desde ${hoursAgo(st.mtimeMs)} (${count} sesiones)` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function checkCatalog() {
  try {
    const st = fs.statSync(CATALOG_STAMP);
    if (Date.now() - st.mtimeMs > MAX_CATALOG_AGE) return { ok: false, reason: `Última actualización completa ${hoursAgo(st.mtimeMs)}` };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Ninguna actualización completa registrada todavía' };
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
const alertState = { relay: false, sessions: false, catalog: false };

async function runChecks() {
  const env = loadEnv();
  const token = env.TELEGRAM_TOKEN;

  const [relay, sessions, catalog] = await Promise.all([
    checkRelay(),
    checkSessionPool(),
    checkCatalog(),
  ]);

  const results = { relay, sessions, catalog };
  const labels  = {
    relay:    '🔴 <b>Relay Worker caído</b>',
    sessions: '⚠️ <b>Pool de sesiones vacío o expirado</b>',
    catalog:  '📋 <b>Catálogo sin actualizar (>7 h)</b>',
  };
  const recovLabels = {
    relay:    '🟢 Relay Worker recuperado',
    sessions: '🟢 Pool de sesiones OK',
    catalog:  '🟢 Catálogo actualizado',
  };

  for (const [key, result] of Object.entries(results)) {
    if (!result.ok && !alertState[key]) {
      // Nueva falla — alertar
      alertState[key] = true;
      log(`ALERT ${key}: ${result.reason}`);
      await tgSend(token, `${labels[key]}\n\n<code>${result.reason}</code>\n\n— Pi Monitor`);
    } else if (result.ok && alertState[key]) {
      // Recuperado — notificar
      alertState[key] = false;
      log(`RECOVERED ${key}`);
      await tgSend(token, `${recovLabels[key]}\n\n— Pi Monitor`);
    } else if (!result.ok) {
      // Already alerted: no new message, but the log must not say OK
      log(`STILL FAILING ${key}: ${result.reason}`);
    } else {
      log(`OK ${key}`);
    }
  }
}

log('TizenXuper Health Monitor iniciado');
// Wait out the startup load: on the single-core B+ a check right at boot times out and sends a false alert
setTimeout(runChecks, 60_000);
setInterval(runChecks, CHECK_INTERVAL);
