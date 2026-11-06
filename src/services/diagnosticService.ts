export type DiagVerdict = 'ok' | 'no-internet' | 'doh-blocked' | 'portal-down' | 'no-cdn';

export interface DiagHostRow {
  host: string;
  ips: string[];
  ok: boolean;
}

export interface DiagReport {
  verdict: DiagVerdict;
  hosts: DiagHostRow[];
  portalMs: number | null;
  cdns: number;
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

class DiagnosticService {
  public async run(): Promise<DiagReport> {
    const hostNames: string[] = (window.MagisClient && window.MagisClient.hosts) || [];

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
      return { verdict: online ? 'doh-blocked' : 'no-internet', hosts, portalMs: null, cdns: 0 };
    }

    // 2. Portal session + 3. VOD CDN
    if (!window.MagisClient || typeof window.MagisClient.diag !== 'function') {
      return { verdict: 'portal-down', hosts, portalMs: null, cdns: 0 };
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

    if (portal.err) return { verdict: 'portal-down', hosts, portalMs: null, cdns: 0 };
    if (portal.cdns === 0) return { verdict: 'no-cdn', hosts, portalMs, cdns: 0 };
    return { verdict: 'ok', hosts, portalMs, cdns: portal.cdns };
  }
}

export const diagnosticService = new DiagnosticService();
