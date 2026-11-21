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
import { checkRelay, checkSessionPool, checkCatalog } from './health-checks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env.pi');
const LOG_FILE = path.join(__dirname, 'health-monitor.log');

// ── Config ─────────────────────────────────────────────────────────────────
const ADMIN_CHAT_ID    = '68683111';
const CHECK_INTERVAL   = 15 * 60 * 1000;   // 15 min

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
