/**
 * Self-update: is there a newer version, fetch it, make sure we signed it, keep it for the next launch.
 * Whether the next launch runs it is decided by public/js/boot.js, which also stores it (IndexedDB) and holds
 * the public key. Never swaps code while running: playing video under a code swap is a class of bugs we don't need.
 *
 * First check a minute after start, then by updateCore.waitAfter (6 h; 15 min after a failure, doubling), and when
 * the app comes back to the front more than an hour after the last check. Manifest < 1 KB; each version's bundle
 * (~650 KB) downloads once. TVs without WebCrypto or without the boot loader never self-update (manual notice).
 */
import { ACCOUNT_APIS } from './accountService';
import {
  compareVersions, judge, readBundle, readManifest, record, waitAfter, type CheckRecord
} from '../lib/updateCore';

const UPDATE_OVERRIDE = (typeof __UPDATE_API__ !== 'undefined' && __UPDATE_API__) || '';
/** Where the update is asked for, in order (the relay on pages.dev for networks that block workers.dev) */
const UPDATE_APIS: string[] = UPDATE_OVERRIDE ? [UPDATE_OVERRIDE] : ACCOUNT_APIS;
const FIRST_CHECK_MS = 60 * 1000;
/** Back in front: check again, unless the last check is fresher than this (quick back-and-forth with another app) */
const WAKE_GAP_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const LAST_KEY = 'xuper_update_last';
/** Last running update version the "Actualizado" notice was shown for */
const SEEN_RUN_KEY = 'xuper_update_seen_run';

export interface UpdateStatus {
  packaged: string;
  running: string;
  /** Downloaded and verified, runs from the next launch ('' when none) */
  downloaded: string;
  lastCheck: CheckRecord | null;
  canSelfUpdate: boolean;
  /** The newest release needs a new package (shell): only Apps2Samsung can install it */
  needsReinstall: boolean;
}

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function write(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch (e) {}
}

class HttpStatusError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

async function getBytes(url: string): Promise<Uint8Array> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl && ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new HttpStatusError(res.status);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A path from the first address that answers; returns that address too, so the bundle comes from the same one.
 * A 404 is an answer (no update), not a reason to try the next address.
 */
async function getBytesAny(path: string, bases: string[] = UPDATE_APIS): Promise<{ bytes: Uint8Array; base: string }> {
  let lastError: unknown = null;
  for (const base of bases) {
    try {
      return { bytes: await getBytes(`${base}${path}`), base };
    } catch (e) {
      if (e instanceof HttpStatusError && e.status === 404) throw e;
      lastError = e;
    }
  }
  throw lastError || new Error('network_error');
}

class UpdateService {
  private started = false;
  private checking = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private downloaded = '';
  private needsReinstall = false;
  private listeners: Array<() => void> = [];

  private boot(): XuperBootApi | null {
    return typeof window !== 'undefined' && window.XuperBoot ? window.XuperBoot : null;
  }

  canSelfUpdate(): boolean {
    const boot = this.boot();
    try {
      return !!(boot && boot.PUBKEY && window.crypto && window.crypto.subtle &&
        typeof TextEncoder !== 'undefined' && typeof TextDecoder !== 'undefined');
    } catch (e) {
      return false;
    }
  }

  subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private notify(): void {
    this.listeners.forEach(cb => {
      try { cb(); } catch (e) {}
    });
  }

  private lastCheck(): CheckRecord | null {
    try {
      const raw = read(LAST_KEY);
      return raw ? (JSON.parse(raw) as CheckRecord) : null;
    } catch (e) {
      return null;
    }
  }

  status(): UpdateStatus {
    const boot = this.boot();
    return {
      packaged: boot ? boot.info.packaged : '',
      running: boot ? boot.info.running : '',
      downloaded: this.downloaded,
      lastCheck: this.lastCheck(),
      canSelfUpdate: this.canSelfUpdate(),
      needsReinstall: this.needsReinstall
    };
  }

  /** The running update version on its first launch (for the "Actualizado a x.y.z" notice), else null */
  updatedNotice(): string | null {
    const boot = this.boot();
    if (!boot || !boot.info.running || boot.info.running === boot.info.packaged) return null;
    return read(SEEN_RUN_KEY) === boot.info.running ? null : boot.info.running;
  }

  markUpdatedSeen(version: string): void {
    write(SEEN_RUN_KEY, version);
  }

  /** Starts the background checks (once). A no-op where the app cannot update itself */
  start(): void {
    if (this.started || !this.canSelfUpdate()) return;
    this.started = true;
    const boot = this.boot() as XuperBootApi;
    if (boot.info.note) console.log(`[update] boot: ${boot.info.note}`);
    boot.store.readMeta(meta => {
      if (meta && meta.version && compareVersions(meta.version, boot.info.running) > 0) {
        this.downloaded = String(meta.version);
        this.notify();
      }
    });
    this.schedule(FIRST_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const last = this.lastCheck();
      if (!last || Date.now() - last.at > WAKE_GAP_MS) this.schedule(0);
    });
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.check(); }, ms);
  }

  private finish(result: string, isError: boolean): string {
    const rec = record(this.lastCheck(), result, isError, Date.now());
    write(LAST_KEY, JSON.stringify(rec));
    const wait = waitAfter(rec, rec.at);
    console.log(`[update] ${result}${isError ? ` · retry in ${Math.round(wait / 60000)} min (${rec.fails} in a row)` : ''}`);
    this.schedule(wait);
    this.notify();
    return result;
  }

  /** One check; resolves with what happened (also kept in xuper_update_last) */
  async check(): Promise<string> {
    if (this.checking) return 'already checking';
    const boot = this.boot();
    if (!boot || !this.canSelfUpdate()) return 'cannot self-update on this TV';
    this.checking = true;
    try {
      const subtle = window.crypto.subtle;
      let manifestBytes: Uint8Array;
      let base = UPDATE_APIS[0];
      try {
        // The running version rides along so the server can count versions; the answer is the same for everyone
        const got = await getBytesAny(`/tv/update?v=${encodeURIComponent(boot.info.running)}`);
        manifestBytes = got.bytes;
        base = got.base;
      } catch (e) {
        if (e instanceof HttpStatusError && e.status === 404) return this.finish('no update published', false);
        throw e;
      }
      const m = await readManifest(subtle, boot.PUBKEY, manifestBytes);
      if (!m.manifest) return this.finish(`not taken: ${m.why}`, true);
      const manifest = m.manifest;
      this.needsReinstall = manifest.shell > boot.SHELL && compareVersions(manifest.version, boot.info.running) > 0;
      const why = judge(manifest, { running: boot.info.running, shell: boot.SHELL, bad: boot.badList(), downloaded: this.downloaded });
      if (why) return this.finish(why, false);

      // From the address that answered first; the signed manifest's sha256 checks the bundle whatever the address
      const bundlePath = `/tv/update/bundle/${encodeURIComponent(manifest.version)}`;
      const bundleBytes = (await getBytesAny(bundlePath, [base, ...UPDATE_APIS.filter(u => u !== base)])).bytes;
      const b = await readBundle(subtle, manifest, bundleBytes);
      if (!b.bundle) return this.finish(`not taken: ${b.why}`, true);
      const meta = { version: manifest.version, shell: manifest.shell, sha256: manifest.sha256, size: manifest.size, at: Date.now() };
      const stored = await new Promise<boolean>(resolve => boot.store.write(meta, b.bundle as object, resolve));
      if (!stored) return this.finish(`could not store ${manifest.version}`, true);
      this.downloaded = manifest.version;
      return this.finish(`downloaded ${manifest.version}, runs from the next launch`, false);
    } catch (e: any) {
      return this.finish(`check failed: ${(e && (e.message || e.name)) || 'unknown'}`, true);
    } finally {
      this.checking = false;
    }
  }
}

export const updateService = new UpdateService();
