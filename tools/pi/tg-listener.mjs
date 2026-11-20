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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  const line = `[${new Date().toISOString()}] ${msg}`;
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
  await tgSend(token, chatId, '⏳ Iniciando renovación del pool de sesiones...');
  log('CMD /refresh — ejecutando refresh-and-deploy.sh');
  try {
    const script = path.join(__dirname, 'refresh-and-deploy.sh');
    const { stdout, stderr } = await execFileAsync('bash', [script], { timeout: 300_000 });
    const out = (stdout + stderr).slice(-800); // últimas 800 chars para no exceder límite de TG
    log('CMD /refresh — completado');
    await tgSend(token, chatId, `✅ <b>Pool renovado</b>\n\n<code>${out}</code>`);
  } catch (e) {
    log(`CMD /refresh — ERROR: ${e.message}`);
    await tgSend(token, chatId, `❌ Error en /refresh:\n<code>${e.message.slice(0, 500)}</code>`);
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

        if (cmd === '/refresh') await handleRefresh(token, chatId);
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
