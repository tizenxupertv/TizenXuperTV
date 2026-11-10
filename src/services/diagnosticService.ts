import { getImageCacheStats } from '../lib/imageCache.ts';
import { isUsableArtworkUrl } from '../lib/searchArtwork.ts';

import { isRegionBlocked } from '../lib/portalErrors.ts';

export type DiagVerdict = 'ok' | 'no-internet' | 'doh-blocked' | 'dns-blocked' | 'region-blocked' | 'portal-down' | 'no-cdn';

/**
 * Why the portal check failed: the portal refusing this region (its code 100024), the provider's DNS hiding the portal
 * (secure DNS finds it but the TV cannot reach it, no portal code), or the portal itself not answering
 */
export function portalVerdict(err: any, hosts: Array<{ ok: boolean }>, cdns: number): DiagVerdict {
  if (err) {
    if (isRegionBlocked(err)) return 'region-blocked';
    if (!err.portalCode && hosts.some(h => h.ok)) return 'dns-blocked';
    return 'portal-down';
  }
  return cdns === 0 ? 'no-cdn' : 'ok';
}

export interface DiagHostRow {
  host: string;
  ips: string[];
  ok: boolean;
}

export interface DiagImageProbe {
  label: string;
  host: string;
  ok: boolean;
  detail: string;
}

export interface DiagImagesReport {
  local: DiagImageProbe;
  vertical: DiagImageProbe;
  horizontal: DiagImageProbe;
  cacheLoaded: number;
  cacheFailed: number;
}

export interface DiagReport {
  verdict: DiagVerdict;
  hosts: DiagHostRow[];
  portalMs: number | null;
  cdns: number;
  images?: DiagImagesReport;
}

function extractSafeHost(url: string): string {
  const s = String(url || '').trim();
  if (!s) return 'sin URL';
  if (/^assets\//i.test(s) || !/^https?:\/\//i.test(s)) return 'local (paquete)';
  const m = /^https?:\/\/([^/?#:]+)/i.exec(s);
  return m ? m[1] : 'remoto';
}

export function probeImage(label: string, url: string, timeoutMs = 5500): Promise<DiagImageProbe> {
  const cleanUrl = String(url || '').trim();
  const host = extractSafeHost(cleanUrl);
  if (!cleanUrl) {
    return Promise.resolve({ label, host, ok: false, detail: 'sin URL de muestra' });
  }
  if (typeof Image === 'undefined') {
    return Promise.resolve({ label, host, ok: true, detail: 'entorno sin DOM' });
  }
  return new Promise<DiagImageProbe>(resolve => {
    let settled = false;
    const img = new Image();
    const t0 = Date.now();
    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve({ label, host, ok, detail });
    };
    const timer = setTimeout(() => {
      finish(false, `timeout (${Math.round(timeoutMs / 1000)}s)`);
    }, timeoutMs);
    img.onload = () => {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      const ms = Date.now() - t0;
      finish(w > 0, w > 0 ? `OK ${w}x${h} (${ms} ms)` : '0x0 vacía');
    };
    img.onerror = () => {
      finish(false, `error de carga (${Date.now() - t0} ms)`);
    };
    try {
      img.referrerPolicy = 'no-referrer';
    } catch (e) {}
    img.src = cleanUrl;
  });
}

async function runImageProbes(sample?: { poster?: string; landscape?: string; backdrop?: string }): Promise<DiagImagesReport> {
  let vUrl = sample && isUsableArtworkUrl(sample.poster) ? String(sample.poster) : '';
  let hUrl = sample && isUsableArtworkUrl(sample.landscape || sample.backdrop)
    ? String(sample.landscape || sample.backdrop)
    : '';

  if ((!vUrl || !hUrl) && typeof window !== 'undefined') {
    const pool = (window as any).XUPERTV_PORTAL?.items || (window as any).XUPERTV_CATALOG?.items || [];
    for (let i = 0; i < pool.length && (!vUrl || !hUrl); i++) {
      const it = pool[i];
      if (!it) continue;
      if (!vUrl && isUsableArtworkUrl(it.poster || it.posterUrl)) {
        vUrl = String(it.poster || it.posterUrl);
      }
      if (!hUrl && isUsableArtworkUrl(it.landscape || it.backdrop || it.landscapeUrl || it.backdropUrl)) {
        hUrl = String(it.landscape || it.backdrop || it.landscapeUrl || it.backdropUrl);
      }
    }
  }

  const [local, vertical, horizontal] = await Promise.all([
    probeImage('Local', 'assets/placeholder_vertical.png', 3000),
    probeImage('Póster', vUrl, 5500),
    probeImage('Fondo', hUrl || vUrl, 5500)
  ]);
  const stats = getImageCacheStats();
  return {
    local,
    vertical,
    horizontal,
    cacheLoaded: stats.loaded,
    cacheFailed: stats.failed
  };
}

const DOH = 'https://cloudflare-dns.com/dns-query';

async function dohLookup(host: string): Promise<string[]> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl && ctrl.abort(), 6000);
  try {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(host)}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: ctrl ? ctrl.signal : undefined
    });
    const json = await res.json();
    return (json.Answer || []).filter((a: any) => a.type === 1).map((a: any) => String(a.data));
  } finally {
    clearTimeout(timer);
  }
}

export type LoginDiagStatus = 'ok' | 'warn' | 'error';

export interface LoginDiagCheck {
  id: 'network' | 'clock' | 'doh' | 'relay' | 'workers';
  name: string;
  status: LoginDiagStatus;
  detail: string;
  latencyMs?: number;
}

export type LoginDiagVerdict =
  | 'ok'
  | 'clock-wrong'
  | 'no-internet'
  | 'workers-blocked'
  | 'relay-only'
  | 'all-blocked';

export interface LoginDiagResult {
  verdict: LoginDiagVerdict;
  headline: string;
  recommendation: string;
  checks: LoginDiagCheck[];
  timestamp: number;
}

export interface LoginDiagDeps {
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  isOnline?: () => boolean;
  endpoints?: {
    doh?: string;
    relay?: string;
    workers?: string;
  };
}

export async function runLoginDiagnostic(deps?: LoginDiagDeps): Promise<LoginDiagResult> {
  const fetchFn = deps?.fetchFn || (typeof fetch !== 'undefined' ? fetch : async () => new Response(null, { status: 500 }));
  const now = deps?.now || (() => Date.now());
  const isOnline = deps?.isOnline || (() => {
    if (typeof window !== 'undefined' && window.XuperPlatform && typeof window.XuperPlatform.isNetworkConnected === 'function') {
      try { return window.XuperPlatform.isNetworkConnected(); } catch (e) {}
    }
    return typeof navigator !== 'undefined' ? (navigator.onLine ?? true) : true;
  });

  const dohUrl = deps?.endpoints?.doh || 'https://cloudflare-dns.com/dns-query';
  const relayUrl = deps?.endpoints?.relay || 'https://tizenxuper-tv.pages.dev/api/release';
  const workersUrl = deps?.endpoints?.workers || 'https://tizenxuper-bot.tizenxupertv.workers.dev/tv/login';

  // 1. Local Network Interface
  const online = isOnline();
  const networkCheck: LoginDiagCheck = {
    id: 'network',
    name: 'Interfaz de red',
    status: online ? 'ok' : 'error',
    detail: online ? 'Conexión local activa' : 'Sin enlace de red (Wi-Fi o cable desconectado)'
  };

  // 2. System Clock & Date Integrity (Samsung TV power loss reverts to 2015/1970, breaking SSL)
  const nowMs = now();
  const currentYear = new Date(nowMs).getUTCFullYear();
  const clockOk = currentYear >= 2025;
  const clockCheck: LoginDiagCheck = {
    id: 'clock',
    name: 'Reloj del sistema',
    status: clockOk ? 'ok' : 'error',
    detail: clockOk
      ? `Fecha sincronizada (${new Date(nowMs).toLocaleDateString('es-ES')})`
      : `Desincronizado (año ${currentYear}) · Provoca error SSL/TLS`
  };

  // 3. DNS Lookup via Cloudflare DoH
  let dohOk = false;
  let dohDetail = '';
  let dohLatency: number | undefined;
  if (online && clockOk) {
    try {
      const t0 = now();
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const guard = setTimeout(() => ctrl && ctrl.abort(), 4500);
      const res = await fetchFn(`${dohUrl}?name=tizenxuper-tv.pages.dev&type=A`, {
        headers: { accept: 'application/dns-json' },
        signal: ctrl ? ctrl.signal : undefined
      });
      clearTimeout(guard);
      const json = await res.json();
      dohLatency = now() - t0;
      const ips = (json.Answer || []).filter((a: any) => a.type === 1).map((a: any) => String(a.data));
      if (ips.length > 0) {
        dohOk = true;
        dohDetail = `Resuelve nombres (${ips.slice(0, 2).join(', ')})`;
      } else {
        dohDetail = 'Sin respuesta de direcciones IP';
      }
    } catch (e: any) {
      dohDetail = 'Bloqueado por el proveedor de internet';
    }
  } else {
    dohDetail = !online ? 'Omitido: sin red' : 'Omitido: reloj desincronizado';
  }
  const dohCheck: LoginDiagCheck = {
    id: 'doh',
    name: 'DNS Seguro (Cloudflare DoH)',
    status: dohOk ? 'ok' : 'error',
    detail: dohDetail,
    latencyMs: dohLatency
  };

  // 4. Relay Server (pages.dev)
  let relayOk = false;
  let relayDetail = '';
  let relayLatency: number | undefined;
  if (online && clockOk) {
    try {
      const t0 = now();
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const guard = setTimeout(() => ctrl && ctrl.abort(), 4500);
      const res = await fetchFn(relayUrl, {
        method: 'GET',
        signal: ctrl ? ctrl.signal : undefined
      });
      clearTimeout(guard);
      relayLatency = now() - t0;
      if (res.ok || res.status === 200 || res.status === 204) {
        relayOk = true;
        relayDetail = 'Servidor activo y accesible';
      } else {
        relayDetail = `Respondió con código HTTP ${res.status}`;
      }
    } catch (e: any) {
      relayDetail = 'No responde o tiempo de espera agotado';
    }
  } else {
    relayDetail = !online ? 'Omitido: sin red' : 'Omitido: reloj desincronizado';
  }
  const relayCheck: LoginDiagCheck = {
    id: 'relay',
    name: 'Servidor Relay (pages.dev)',
    status: relayOk ? 'ok' : 'error',
    detail: relayDetail,
    latencyMs: relayLatency
  };

  // 5. Bot Worker API (workers.dev)
  let workersOk = false;
  let workersDetail = '';
  let workersLatency: number | undefined;
  if (online && clockOk) {
    try {
      const t0 = now();
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const guard = setTimeout(() => ctrl && ctrl.abort(), 4500);
      const res = await fetchFn(workersUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ping: true }),
        signal: ctrl ? ctrl.signal : undefined
      });
      clearTimeout(guard);
      workersLatency = now() - t0;
      if (res.status >= 200 && res.status < 500) {
        workersOk = true;
        workersDetail = 'Servidor principal respondiendo';
      } else {
        workersDetail = `Error en servidor (${res.status})`;
      }
    } catch (e: any) {
      workersDetail = 'Bloqueado por el ISP o inaccesible';
    }
  } else {
    workersDetail = !online ? 'Omitido: sin red' : 'Omitido: reloj desincronizado';
  }
  const workersCheck: LoginDiagCheck = {
    id: 'workers',
    name: 'Servidor Bot (workers.dev)',
    status: workersOk ? 'ok' : (relayOk ? 'warn' : 'error'),
    detail: workersDetail,
    latencyMs: workersLatency
  };

  const checks: LoginDiagCheck[] = [networkCheck, clockCheck, dohCheck, relayCheck, workersCheck];

  let verdict: LoginDiagVerdict = 'ok';
  let headline = 'Todos los servicios responden correctamente';
  let recommendation = 'La conexión está lista. Pulsa «Reintentar conexión» para generar tu código QR de acceso.';

  if (!clockOk) {
    verdict = 'clock-wrong';
    headline = 'Reloj del televisor desincronizado';
    recommendation = `El reloj interno de la TV marca el año ${currentYear}. Esto invalida los certificados de seguridad SSL. Ve a Configuración › General › Administrador del sistema › Hora › Reloj y ajusta la fecha actual.`;
  } else if (!online) {
    verdict = 'no-internet';
    headline = 'El televisor no tiene acceso a internet';
    recommendation = 'Verifica la conexión Wi-Fi o que el cable Ethernet esté conectado firmemente en la TV. Reinicia tu router si es necesario.';
  } else if (!workersOk && relayOk) {
    verdict = 'relay-only';
    headline = 'Bloqueo de workers.dev detectado (Relay activo)';
    recommendation = 'Tu proveedor de internet bloquea workers.dev. La app puede conectarse a través del relay de respaldo. Pulsa «Reintentar conexión» para solicitar el código.';
  } else if (!workersOk && !relayOk) {
    verdict = 'all-blocked';
    headline = 'Bloqueo de servidores por tu proveedor de internet';
    recommendation = 'Tu operador bloquea los servidores de Cloudflare o la resolución DNS. Ve a Configuración › General › Red › Estado de la red › Configuración de IP, cambia la DNS a manual y escribe 1.1.1.1 u 8.8.8.8. Otra opción: inicia sesión una vez con los datos del móvil (Zona Wi-Fi personal) y después vuelve a tu Wi-Fi: la sesión queda guardada en la TV.';
  } else if (!dohOk) {
    verdict = 'workers-blocked';
    headline = 'Filtro o bloqueo DNS detectado';
    recommendation = 'El servidor DNS de tu proveedor está filtrando peticiones. Te recomendamos cambiar el DNS de la TV a 1.1.1.1 en Configuración de red. Otra opción: inicia sesión una vez con los datos del móvil (Zona Wi-Fi personal) y después vuelve a tu Wi-Fi: la sesión queda guardada en la TV.';
  }

  return {
    verdict,
    headline,
    recommendation,
    checks,
    timestamp: nowMs
  };
}

class DiagnosticService {
  public async run(sampleItem?: { poster?: string; landscape?: string; backdrop?: string }): Promise<DiagReport> {
    const hostNames: string[] = (window.MagisClient && window.MagisClient.hosts) || [];
    const imagesPromise = runImageProbes(sampleItem);

    // 1. Secure DNS (also proves general internet access)
    const hosts: DiagHostRow[] = [];
    let dohAnswered = 0;
    let dohErrors = 0;
    for (const host of hostNames) {
      try {
        const ips = await dohLookup(host);
        dohAnswered++;
        hosts.push({ host, ips, ok: ips.length > 0 });
      } catch (e) {
        dohErrors++;
        hosts.push({ host, ips: [], ok: false });
      }
    }

    if (hostNames.length > 0 && dohAnswered === 0) {
      const online = typeof window !== 'undefined' && window.XuperPlatform && window.XuperPlatform.isNetworkConnected
        ? window.XuperPlatform.isNetworkConnected()
        : (typeof navigator !== 'undefined' ? navigator.onLine : true);
      const images = await imagesPromise;
      return { verdict: online ? 'doh-blocked' : 'no-internet', hosts, portalMs: null, cdns: 0, images };
    }

    // 2. Portal session + 3. VOD CDN
    if (!window.MagisClient || typeof window.MagisClient.diag !== 'function') {
      const images = await imagesPromise;
      return { verdict: 'portal-down', hosts, portalMs: null, cdns: 0, images };
    }
    const started = Date.now();
    const portal: { err: any; cdns: number } = await new Promise(resolve => {
      const guard = setTimeout(() => resolve({ err: new Error('timeout'), cdns: 0 }), 20000);
      window.MagisClient.diag((err: any, info: any) => {
        clearTimeout(guard);
        resolve({ err, cdns: info && info.cdns ? info.cdns : 0 });
      });
    });
    const portalMs = Date.now() - started;
    const images = await imagesPromise;

    const verdict = portalVerdict(portal.err, hosts, portal.cdns);
    if (portal.err) return { verdict, hosts, portalMs: null, cdns: 0, images };
    return { verdict, hosts, portalMs, cdns: portal.cdns, images };
  }

  public runLoginDiag(deps?: LoginDiagDeps): Promise<LoginDiagResult> {
    return runLoginDiagnostic(deps);
  }
}

export const diagnosticService = new DiagnosticService();
