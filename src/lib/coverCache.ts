/**
 * Card-size copies of the portal artwork, kept on the TV (IndexedDB), for Tizen 6.0 and older.
 *
 * Those TVs downloaded and decoded every poster at its full size on every visit (their HTTP cache is small and is
 * emptied often), which costs memory and CPU while the viewer moves through the home. Here each image is reduced
 * once to the card size, stored as a JPEG of a few KB (at most 400 copies / 48 MB, a week each) and read back
 * at once on later visits and starts. Newer TVs keep the plain image addresses.
 * Anything that fails (no IndexedDB, a download refused, a canvas error) gives the plain address back.
 * No relative imports except tvProfile.ts, so tests can load this file in Node.
 */
import { getTvProfile } from './tvProfile.ts';

/** localStorage switch: 'on' / 'off' force the cache, anything else follows the TV */
export const COVER_CACHE_KEY = 'xuper.coverCache';
export const COVER_FRESH_MS = 7 * 24 * 3600 * 1000;
const MAX_BYTES = 48 * 1024 * 1024;
const MAX_ITEMS = 400;
/** Copies made at the same time: the rest wait, so a scrolled row does not decode many full images at once */
const CONCURRENCY = 2;
const QUALITY = 0.82;
const DB_NAME = 'xuper-covers';
const STORE = 'covers';

/** Whether this TV uses the cache: Tizen 6.0 and older, unless the switch says otherwise */
export function coverCacheWanted(ua: string, flag: string | null): boolean {
  if (flag === 'on') return true;
  if (flag === 'off') return false;
  return getTvProfile(ua).legacyVideo;
}

export function coverKey(url: string, w: number, h: number): string {
  return `${w}x${h}|${url}`;
}

/** Source rectangle that fills a w x h card without stretching (the centre, like object-fit: cover) */
export function coverCrop(srcW: number, srcH: number, w: number, h: number): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(w / srcW, h / srcH);
  const sw = Math.round(w / scale);
  const sh = Math.round(h / scale);
  return { sx: Math.round((srcW - sw) / 2), sy: Math.round((srcH - sh) / 2), sw, sh };
}

export interface CoverEntryInfo {
  key: string;
  at: number;
  bytes: number;
}

/** Keys to delete: copies older than a week, then the oldest ones until both caps hold */
export function evictionPlan(entries: CoverEntryInfo[], maxBytes: number, maxItems: number, now: number): string[] {
  const drop: string[] = [];
  const fresh = entries.filter(e => {
    if (now - e.at > COVER_FRESH_MS) {
      drop.push(e.key);
      return false;
    }
    return true;
  }).sort((a, b) => a.at - b.at);
  let bytes = fresh.reduce((sum, e) => sum + e.bytes, 0);
  let count = fresh.length;
  for (const e of fresh) {
    if (bytes <= maxBytes && count <= maxItems) break;
    drop.push(e.key);
    bytes -= e.bytes;
    count--;
  }
  return drop;
}

// ---------------------------------------------------------------------------
// TV side (browser only)
// ---------------------------------------------------------------------------

interface CoverRecord {
  blob: Blob;
  at: number;
  bytes: number;
}

/** What the cache did this session, for the problem report */
export const coverStats = { memory: 0, disk: 0, made: 0, failed: 0 };

const memory = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const waiting: Array<() => void> = [];
let running = 0;
let writesSinceTrim = 0;
let enabledCache: boolean | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;

export function coverCacheEnabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  let flag: string | null = null;
  try {
    flag = localStorage.getItem(COVER_CACHE_KEY);
  } catch {
    // no storage: follow the TV
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  enabledCache = typeof indexedDB !== 'undefined' && coverCacheWanted(ua, flag);
  return enabledCache;
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function dbGet(key: string): Promise<CoverRecord | null> {
  return openDb().then(db => new Promise<CoverRecord | null>(resolve => {
    if (!db) return resolve(null);
    try {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as CoverRecord) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

function dbPut(key: string, record: CoverRecord): Promise<void> {
  return openDb().then(db => new Promise<void>(resolve => {
    if (!db) return resolve();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  }));
}

/** Deletes stale and surplus copies (every 20 new copies, so a full scan is rare) */
function trim(): void {
  openDb().then(db => {
    if (!db) return;
    try {
      const entries: CoverEntryInfo[] = [];
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const v = cursor.value as CoverRecord;
          entries.push({ key: String(cursor.key), at: v.at || 0, bytes: v.bytes || 0 });
          cursor.continue();
          return;
        }
        evictionPlan(entries, MAX_BYTES, MAX_ITEMS, Date.now()).forEach(k => store.delete(k));
      };
    } catch {
      // the next trim tries again
    }
  });
}

function slot(): Promise<void> {
  if (running < CONCURRENCY) {
    running++;
    return Promise.resolve();
  }
  return new Promise(resolve => waiting.push(() => { running++; resolve(); }));
}

function release(): void {
  running--;
  const next = waiting.shift();
  if (next) next();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth > 0 ? resolve(img) : reject(new Error('empty image')));
    img.onerror = () => reject(new Error('image error'));
    img.src = src;
  });
}

/** Downloads `fetchUrl`, draws the centre of it at w x h and returns it as a JPEG */
async function makeCopy(fetchUrl: string, w: number, h: number): Promise<Blob> {
  const res = await fetch(fetchUrl, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const original = await res.blob();
  // Drawn from a blob: address of this page, so the canvas can be read back
  const objectUrl = URL.createObjectURL(original);
  try {
    const img = await loadImage(objectUrl);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    const c = coverCrop(img.naturalWidth, img.naturalHeight, w, h);
    ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, w, h);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('no copy');
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** The copy already in memory, or null */
export function peekCover(url: string, w: number, h: number): string | null {
  return memory.get(coverKey(url, w, h)) || null;
}

/**
 * Address to show for `url` on a w x h card: the stored copy, a new one, or `fallback` (the plain address) when
 * neither works. `fetchUrl` is where the image is downloaded from (the dev server proxy in development).
 */
export function getCover(url: string, w: number, h: number, fetchUrl: string, fallback: string): Promise<string> {
  const key = coverKey(url, w, h);
  const known = memory.get(key);
  if (known) {
    coverStats.memory++;
    return Promise.resolve(known);
  }
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const job = (async () => {
    try {
      const stored = await dbGet(key);
      if (stored && stored.blob && Date.now() - stored.at <= COVER_FRESH_MS) {
        coverStats.disk++;
        const src = URL.createObjectURL(stored.blob);
        memory.set(key, src);
        return src;
      }
      await slot();
      let blob: Blob;
      try {
        blob = await makeCopy(fetchUrl, w, h);
      } finally {
        release();
      }
      coverStats.made++;
      const src = URL.createObjectURL(blob);
      memory.set(key, src);
      dbPut(key, { blob, at: Date.now(), bytes: blob.size }).then(() => {
        if (++writesSinceTrim >= 20) {
          writesSinceTrim = 0;
          trim();
        }
      });
      return src;
    } catch {
      coverStats.failed++;
      return fallback;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, job);
  return job;
}

/** One line for the problem report */
export function coverStatsLine(): string {
  if (!coverCacheEnabled()) return 'desactivada';
  const s = coverStats;
  return `memoria ${s.memory} · guardadas ${s.disk} · nuevas ${s.made} · fallidas ${s.failed}`;
}
