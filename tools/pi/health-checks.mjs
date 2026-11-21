/**
 * The Pi's health checks, shared by health-monitor.mjs (every 15 min, alerts on Telegram) and tg-listener.mjs (/status).
 * Each returns { ok, text }: text is what a log line or a message shows for it, whether it passed or not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAY_URL        = 'https://tizenxuper-relay.tizenxupertv.workers.dev';
const POOL_FILE        = path.join(__dirname, 'relay-worker', 'src', 'sessionPool.js');
const CATALOG_STAMP    = path.join(__dirname, '.catalog-ok');
// The pool is renewed every 6 h and the catalog every 3 h: one missed run is tolerated before alerting
const MAX_POOL_AGE     = 13 * 60 * 60 * 1000;
const MAX_CATALOG_AGE  = 7 * 60 * 60 * 1000;
const hoursAgo = (ms) => { const min = Math.round((Date.now() - ms) / 60000); return min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`; };

// ── Checks ───────────────────────────────────────────────────────────────────
export async function checkRelay() {
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

export async function checkSessionPool() {
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

export async function checkCatalog() {
  try {
    const st = fs.statSync(CATALOG_STAMP);
    return { ok: Date.now() - st.mtimeMs <= MAX_CATALOG_AGE, text: hoursAgo(st.mtimeMs) };
  } catch {
    return { ok: false, text: 'ninguna actualización completa todavía' };
  }
}
