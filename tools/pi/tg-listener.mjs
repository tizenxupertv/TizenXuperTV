#!/usr/bin/env node
/**
 * TizenXuper Pi — Telegram Command Listener (long polling)
 *
 * Escucha comandos del admin (SUPPORT_CHAT_ID = 68683111) vía long polling.
 * No necesita webhook ni IP pública.
 *
 * Comandos disponibles:
 *   /refresh   — Renueva el pool de sesiones y despliega el Worker
 *   /status    — Estado actual del relay y el catálogo
 *   /ping      — Verifica que la Pi está viva
 *
 * Usage: node tg-listener.mjs
 * Logs:  tg-listener.log
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { logTime } from './log-time.mjs';
import { checkRelay, checkSessionPool, checkCatalog } from './health-checks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFRESH_LOG = path.join(__dirname, 'relay-refresh.log');
const ENV_FILE  = path.join(__dirname, '.env.pi');
const LOG_FILE  = path.join(__dirname, 'tg-listener.log');
const ADMIN_ID  = '68683111';

// ── Helpers ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function log(msg) {
  const line = `[${logTime()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function tgSend(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

async function getUpdates(token, offset) {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?timeout=30&offset=${offset}`,
    { signal: AbortSignal.timeout(40000) }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.result ?? [];
}

// ── Command handlers ─────────────────────────────────────────────────────────
async function handleRefresh(token, chatId) {
  await tgSend(token, chatId, '⏳ Iniciando renovación del pool de sesiones (unos 15 min en la Pi)...');
  log('/refresh: renovando el pool');
  try {
    const script = path.join(__dirname, 'refresh-and-deploy.sh');
    let out = '';
    const fd = fs.openSync(REFRESH_LOG, 'a');
    fs.writeSync(fd, `────────────────────────────────────────────────────────────\n[${logTime()}] ▶ Ejecutado desde Telegram (/refresh)\n`);
    const code = await new Promise((resolve, reject) => {
      const child = spawn('bash', [script], { cwd: __dirname });
      const onData = (b) => {
        fs.writeSync(fd, b);
        out = (out + b.toString()).slice(-2000);
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', reject);
      child.on('close', resolve);
    }).finally(() => fs.closeSync(fd));
    const tail = out.slice(-800); // últimas 800 chars para no exceder límite de TG
    log(`/refresh: terminó ${code === 0 ? 'bien' : `con código ${code}`}`);
    if (code !== 0) {
      await tgSend(token, chatId, `❌ <b>La renovación falló</b> (código ${code})\n\n<code>${esc(tail)}</code>`);
    } else if (/Omitido/.test(out)) {
      await tgSend(token, chatId, 'ℹ️ Ya había una renovación en curso; no se lanzó otra.');
    } else {
      await tgSend(token, chatId, `✅ <b>Pool renovado</b>\n\n<code>${esc(tail)}</code>`);
    }
  } catch (e) {
    log(`/refresh: error — ${e.message}`);
    await tgSend(token, chatId, `❌ Error en /refresh:\n<code>${esc(e.message.slice(0, 500))}</code>`);
  }
}

async function handleStatus(token, chatId) {
  const [relay, pool, catalog] = await Promise.all([checkRelay(), checkSessionPool(), checkCatalog()]);
  const show = (r) => `${r.ok ? '✅' : '❌'} ${esc(r.text)}`;
  const uptime  = process.uptime();
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  await tgSend(token, chatId,
    `📊 <b>Estado TizenXuper Pi</b>\n\n` +
    `Relay: ${show(relay)}\n` +
    `Pool de sesiones: ${show(pool)}\n` +
    `Catálogo: ${show(catalog)}\n` +
    `Pi uptime: ${h}h ${m}m\n\n` +
    `— Pi Monitor`
  );
}

async function handlePing(token, chatId) {
  await tgSend(token, chatId, `🟢 Pi viva — ${logTime()}`);
}

// ── Main polling loop ─────────────────────────────────────────────────────────
async function main() {
  const env   = loadEnv();
  const token = env.TELEGRAM_TOKEN;
  let offset  = 0;
  let pollErrors = 0;

  log('Bot de Telegram iniciado: /status, /ping y /refresh');

  while (true) {
    try {
      const updates = await getUpdates(token, offset);
      if (pollErrors >= 3) log(`Conexión con Telegram recuperada tras ${pollErrors} intentos fallidos`);
      pollErrors = 0;
      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg || !msg.text) continue;

        // Solo el admin puede enviar comandos
        const fromId = String(msg.from?.id ?? '');
        if (fromId !== ADMIN_ID) continue;

        const cmd  = msg.text.split('@')[0].trim().toLowerCase();
        const chatId = msg.chat.id;
        log(`Comando recibido: ${cmd}`);

        // Not awaited: a refresh takes ~15 min and /status or /ping must keep answering meanwhile
        if (cmd === '/refresh') handleRefresh(token, chatId);
        else if (cmd === '/status') await handleStatus(token, chatId);
        else if (cmd === '/ping') await handlePing(token, chatId);
      }
    } catch (e) {
      if (!e.message?.includes('AbortError')) {
        // A short network drop fails one or two polls: only a run of failures is worth a line
        pollErrors++;
        if (pollErrors === 3) log(`Sin conexión con Telegram (${e.message}): reintentando cada 10 s`);
        await new Promise(r => setTimeout(r, 10000));
      }
    }
  }
}

main();
