/**
 * Internet speed test for Perfil › Diagnóstico: latency and download speed against Cloudflare's public speed
 * endpoint (CORS open, no account). Its response headers carry the viewer's IP and city: they are never read.
 * Downloads grow in size until one takes long enough to measure the line well, within a time budget, and the
 * bytes are counted and dropped as they arrive (nothing is kept in memory).
 * No relative imports, so test/speedTest.test.ts can load this file in Node.
 */
export const SPEED_URL = 'https://speed.cloudflare.com/__down';

export interface SpeedResult {
  mbps: number;
  latencyMs: number | null;
}

export type SpeedProgress = { phase: 'latency' } | { phase: 'download'; mbps: number };

export interface SpeedDeps {
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  onProgress?: (p: SpeedProgress) => void;
  /** Aborts the test (the screen was left) */
  signal?: AbortSignal;
}

const LATENCY_PINGS = 5;
const SIZES = [1e6, 5e6, 10e6, 25e6, 50e6];
/** A download that took this long measured the line well: no need for a bigger one */
const ENOUGH_MS = 4000;
const BUDGET_MS = 15000;

export function toMbps(bytes: number, ms: number): number {
  return ms > 0 ? (bytes * 8) / (ms * 1000) : 0;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function formatSpeed(mbps: number): string {
  return `${mbps < 10 ? mbps.toFixed(1) : Math.round(mbps)} Mbps`;
}

/** What the speed means for watching: HD needs about 5 Mbps, Full HD 10, 4K 25 */
export function streamingVerdict(mbps: number): { cls: 'ok' | 'warn' | 'bad'; text: string } {
  if (mbps < 5) return { cls: 'bad', text: 'Lenta: puede haber cortes incluso en HD.' };
  if (mbps < 10) return { cls: 'warn', text: 'Suficiente para HD; en Full HD puede haber cortes.' };
  if (mbps < 25) return { cls: 'ok', text: 'Suficiente para Full HD.' };
  return { cls: 'ok', text: 'Suficiente para 4K.' };
}

async function download(
  fetchFn: NonNullable<SpeedDeps['fetchFn']>,
  url: string,
  signal: AbortSignal | undefined,
  onBytes: (total: number) => void
): Promise<number> {
  const res = await fetchFn(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`http ${res.status}`);
  let total = 0;
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) {
    total = (await res.arrayBuffer()).byteLength;
    onBytes(total);
    return total;
  }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return total;
    total += value ? value.byteLength : 0;
    onBytes(total);
  }
}

export async function runSpeedTest(deps: SpeedDeps = {}): Promise<SpeedResult> {
  const fetchFn = deps.fetchFn || ((url: string, init?: RequestInit) => fetch(url, init));
  const now = deps.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const progress = deps.onProgress || (() => {});
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const stop = () => ctrl && ctrl.abort();
  if (deps.signal) {
    if (deps.signal.aborted) stop();
    else deps.signal.addEventListener('abort', stop);
  }
  const started = now();
  const budget = setTimeout(stop, BUDGET_MS);
  try {
    // Latency: empty downloads; the first one also opens the connection, so it is left out
    progress({ phase: 'latency' });
    const pings: number[] = [];
    for (let i = 0; i < LATENCY_PINGS; i++) {
      const t0 = now();
      await download(fetchFn, `${SPEED_URL}?bytes=0`, ctrl ? ctrl.signal : undefined, () => {});
      if (i > 0) pings.push(now() - t0);
    }
    const latency = median(pings);

    let mbps = 0;
    for (const size of SIZES) {
      const t0 = now();
      let got = 0;
      try {
        await download(fetchFn, `${SPEED_URL}?bytes=${size}`, ctrl ? ctrl.signal : undefined, total => {
          got = total;
          progress({ phase: 'download', mbps: toMbps(got, now() - t0) });
          if (now() - started >= BUDGET_MS) stop();
        });
      } catch (e) {
        // Out of time in the middle of a download: what arrived so far still measures the line
        if (deps.signal && deps.signal.aborted) throw e;
        if (!(ctrl && ctrl.signal.aborted) || got === 0) throw e;
        mbps = toMbps(got, now() - t0);
        break;
      }
      const ms = now() - t0;
      mbps = toMbps(got, ms);
      if (ms >= ENOUGH_MS || now() - started >= BUDGET_MS) break;
    }
    return { mbps, latencyMs: latency === null ? null : Math.round(latency) };
  } finally {
    clearTimeout(budget);
    if (deps.signal) deps.signal.removeEventListener('abort', stop);
  }
}
