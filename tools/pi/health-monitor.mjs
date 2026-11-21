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
const hoursAgo = (ms) => { const min = Math.round((Date.now() - ms) / 60000); return min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`; };

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
// Each returns { ok, text }: text is what the log line shows for it, whether it passed or not
async function checkRelay() {
  const t0 = Date.now();
  try {
    // /health and /session/ping never existed: the relay answered 401 to them, a false alarm on every restart
    const res = await fetch(`${RELAY_URL}/time`, { signal: AbortSignal.timeout(10000) });
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, text: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    if (!body || body.ok !== true) return { ok: false, text: 'respuesta inesperada de /time' };
    if (body.relayMode === 'off') return { ok: false, text: 'apagado (relayMode off)' };
    return { ok: true, text: `${ms} ms${body.relayMode && body.relayMode !== 'full' ? ` · modo ${body.relayMode}` : ''}` };
  } catch (e) {
    return { ok: false, text: e.message };
  }
}

async function checkSessionPool() {
  // The relay has no open route for its pool; the Pi's last deployed copy tells its age and size
  try {
    const st = fs.statSync(POOL_FILE);
    const count = (fs.readFileSync(POOL_FILE, 'utf8').match(/"snToken"/g) || []).length;
    const text = `${count} sesiones (${hoursAgo(st.mtimeMs)})`;
    if (!count) return { ok: false, text: 'sin sesiones' };
    return { ok: Date.now() - st.mtimeMs <= MAX_POOL_AGE, text };
  } catch (e) {
    return { ok: false, text: e.message };
  }
}

async function checkCatalog() {
  try {
    const st = fs.statSync(CATALOG_STAMP);
    return { ok: Date.now() - st.mtimeMs <= MAX_CATALOG_AGE, text: hoursAgo(st.mtimeMs) };
  } catch {
    return { ok: false, text: 'ninguna actualización completa todavía' };
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
const NAMES = { relay: 'relay', sessions: 'pool', catalog: 'catálogo' };
const ALERTS = {
  relay:    '🔴 <b>Relay Worker caído</b>',
  sessions: '⚠️ <b>Pool de sesiones vacío o sin renovar</b>',
  catalog:  '📋 <b>Catálogo sin actualizar (>7 h)</b>',
};
const RECOVERIES = {
  relay:    '🟢 Relay Worker recuperado',
  sessions: '🟢 Pool de sesiones OK',
  catalog:  '🟢 Catálogo actualizado',
};
const plain = (html) => html.replace(/<[^>]+>/g, '');
const alertState = { relay: false, sessions: false, catalog: false };

async function runChecks() {
  const token = loadEnv().TELEGRAM_TOKEN;
  const [relay, sessions, catalog] = await Promise.all([checkRelay(), checkSessionPool(), checkCatalog()]);
  const results = { relay, sessions, catalog };

  // One line per round: "✓ relay 180 ms · ✓ pool 200 sesiones (hace 1 h) · ✓ catálogo hace 1 h"
  log(Object.entries(results).map(([k, r]) => `${r.ok ? '✓' : '✗'} ${NAMES[k]} ${r.text}`).join(' · '));

  for (const [key, result] of Object.entries(results)) {
    let msg = null;
    if (!result.ok && !alertState[key]) msg = `${ALERTS[key]}\n\n<code>${result.text}</code>\n\n— Pi Monitor`;
    else if (result.ok && alertState[key]) msg = `${RECOVERIES[key]}\n\n— Pi Monitor`;
    if (!msg) continue;
    alertState[key] = !result.ok;
    const sent = await tgSend(token, msg).catch(() => false);
    log(`📨 Telegram${sent ? '' : ' (no se pudo enviar)'}: ${plain(result.ok ? RECOVERIES[key] : ALERTS[key]).replace(/^\S+\s/, '')}`);
  }
}

log('Monitor de salud iniciado: revisa relay, pool y catálogo cada 15 min');
// Wait out the startup load: on the single-core B+ a check right at boot times out and sends a false alert
setTimeout(runChecks, 60_000);
setInterval(runChecks, CHECK_INTERVAL);
