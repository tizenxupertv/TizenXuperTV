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
  log('CMD /refresh — ejecutando refresh-and-deploy.sh');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  try {
    const script = path.join(__dirname, 'refresh-and-deploy.sh');
    let out = '';
    const fd = fs.openSync(REFRESH_LOG, 'a');
    fs.writeSync(fd, `\n[${logTime()}] ▶ Ejecutado desde Telegram (/refresh)\n`);
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
    log(`CMD /refresh — terminó con código ${code}`);
    if (code !== 0) {
      await tgSend(token, chatId, `❌ <b>La renovación falló</b> (código ${code})\n\n<code>${esc(tail)}</code>`);
    } else if (/Omitido/.test(out)) {
      await tgSend(token, chatId, 'ℹ️ Ya había una renovación en curso; no se lanzó otra.');
    } else {
      await tgSend(token, chatId, `✅ <b>Pool renovado</b>\n\n<code>${esc(tail)}</code>`);
    }
  } catch (e) {
    log(`CMD /refresh — ERROR: ${e.message}`);
    await tgSend(token, chatId, `❌ Error en /refresh:\n<code>${esc(e.message.slice(0, 500))}</code>`);
  }
}

async function handleStatus(token, chatId) {
  log('CMD /status');
  const relay   = await fetch('https://tizenxuper-relay.tizenxupertv.workers.dev/health', { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? '✅ OK' : `❌ HTTP ${r.status}`).catch(e => `❌ ${e.message}`);
  const pool    = await fetch('https://tizenxuper-relay.tizenxupertv.workers.dev/session/ping', { signal: AbortSignal.timeout(8000) }).then(r => r.status === 200 ? '✅ Sesiones vivas' : '⚠️ Pool vacío o expirado').catch(e => `❌ ${e.message}`);
  const uptime  = process.uptime();
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  await tgSend(token, chatId,
    `📊 <b>Estado TizenXuper Pi</b>\n\n` +
    `Worker relay: ${relay}\n` +
    `Pool sesiones: ${pool}\n` +
    `Pi uptime: ${h}h ${m}m\n\n` +
    `— Pi Monitor`
  );
}

async function handlePing(token, chatId) {
  log('CMD /ping');
  await tgSend(token, chatId, `🟢 Pi viva — ${new Date().toUTCString()}`);
}

// ── Main polling loop ─────────────────────────────────────────────────────────
async function main() {
  const env   = loadEnv();
  const token = env.TELEGRAM_TOKEN;
  let offset  = 0;

  log('TizenXuper Telegram Listener iniciado (long polling)');

  while (true) {
    try {
      const updates = await getUpdates(token, offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg || !msg.text) continue;

        // Solo el admin puede enviar comandos
        const fromId = String(msg.from?.id ?? '');
        if (fromId !== ADMIN_ID) continue;

        const cmd  = msg.text.split('@')[0].trim().toLowerCase();
        const chatId = msg.chat.id;
        log(`CMD recibido: ${cmd} de ${fromId}`);

        // Not awaited: a refresh takes ~15 min and /status or /ping must keep answering meanwhile
        if (cmd === '/refresh') handleRefresh(token, chatId);
        else if (cmd === '/status') await handleStatus(token, chatId);
        else if (cmd === '/ping') await handlePing(token, chatId);
      }
    } catch (e) {
      if (!e.message?.includes('AbortError')) {
        log(`Poll error: ${e.message} — reintentando en 10s`);
        await new Promise(r => setTimeout(r, 10000));
      }
    }
  }
}

main();
