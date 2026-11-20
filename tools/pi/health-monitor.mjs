#!/usr/bin/env node
/**
 * TizenXuper Pi — Health Monitor + Telegram Alerter
 *
 * Checks every 15 minutes:
 *   1. Cloudflare relay worker is responding
 *   2. Session pool has valid (non-expired) sessions
 *   3. Static catalog was updated recently (< 5 hours)
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env.pi');
const LOG_FILE = path.join(__dirname, 'health-monitor.log');

// ── Config ─────────────────────────────────────────────────────────────────
const RELAY_URL        = 'https://tizenxuper-relay.tizenxupertv.workers.dev';
const CATALOG_RAW_URL  = 'https://raw.githubusercontent.com/tizenxupertv/TizenXuperTV/catalog-data/live-channels.json';
const ADMIN_CHAT_ID    = '68683111';
const CHECK_INTERVAL   = 15 * 60 * 1000;   // 15 min
const MAX_CATALOG_AGE  = 5 * 60 * 60 * 1000; // 5 h

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
  const line = `[${new Date().toISOString()}] ${msg}`;
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
    const res = await fetch(`${RELAY_URL}/health`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function checkSessionPool() {
  try {
    // /session/ping returns 200 if at least one valid session exists in the pool
    const res = await fetch(`${RELAY_URL}/session/ping`, { signal: AbortSignal.timeout(10000) });
    if (res.status === 200) return { ok: true };
    if (res.status === 503) return { ok: false, reason: 'Pool vacío o todas las sesiones expiradas' };
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function checkCatalog() {
  try {
    const res = await fetch(CATALOG_RAW_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const lastModified = res.headers.get('last-modified');
    if (lastModified) {
      const age = Date.now() - new Date(lastModified).getTime();
      if (age > MAX_CATALOG_AGE) {
        const horas = Math.round(age / 3600000);
        return { ok: false, reason: `Catálogo no actualizado hace ${horas}h (máx 5h)` };
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
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
    catalog:  '📋 <b>Catálogo sin actualizar (>5h)</b>',
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
    } else {
      log(`OK ${key}`);
    }
  }
}

log('TizenXuper Health Monitor iniciado');
runChecks();
setInterval(runChecks, CHECK_INTERVAL);
