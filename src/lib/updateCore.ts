/**
 * Self-update checks that need no network or storage: the signed manifest, the bundle against it, whether to download,
 * and when to check next. Trust comes from one place only: the manifest signed with our private key (ECDSA P-256,
 * SHA-256, IEEE P1363 signature) whose public key is in public/js/boot.js. The manifest names the bundle's sha256 and
 * size, so neither host has to be trusted: bytes either check out or are thrown away.
 * No relative imports, so test/updateCore.test.ts can load this file in Node.
 * Modeled on titlog/telegram-tizen app/js/update.js (MIT).
 */
export interface UpdateManifest {
  version: string;
  shell: number;
  sha256: string;
  size: number;
}

export interface UpdateBundle {
  version: string;
  shell: number;
  /** Load order; a path missing from `files` loads from the installed package */
  scripts: string[];
  styles: string[];
  files: Record<string, string>;
}

export interface CheckRecord {
  at: number;
  result: string;
  error: boolean;
  /** Failed checks in a row */
  fails: number;
}

/** A successful check waits this long; a failed one retries sooner, doubling, up to the same cap */
export const CHECK_EVERY_MS = 3600 * 1000;
export const RETRY_MS = 15 * 60 * 1000;

/** Dotted numbers compared part by part, like XuperBoot.cmp; a non-numeric part counts as 0 */
export function compareVersions(a: string, b: string): number {
  const x = String(a || '').split('.');
  const y = String(b || '').split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = parseInt(x[i] || '0', 10) || 0;
    const q = parseInt(y[i] || '0', 10) || 0;
    if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}

function parse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function verifySignature(subtle: SubtleCrypto, pubB64: string, payload: string, sigB64: string): Promise<boolean> {
  const key = await subtle.importKey('spki', fromBase64(pubB64) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  let sig: Uint8Array;
  try {
    sig = fromBase64(sigB64);
  } catch {
    return false;
  }
  return subtle.verify({ name: 'ECDSA', hash: { name: 'SHA-256' } }, key, sig as BufferSource, new TextEncoder().encode(payload) as BufferSource);
}

/** The file served at /tv/update: `{ manifest: "<json>", sig: "<base64>" }`. The signature is checked before parsing */
export async function readManifest(subtle: SubtleCrypto, pubB64: string, bytes: Uint8Array): Promise<{ manifest?: UpdateManifest; why?: string }> {
  const doc = parse<{ manifest?: unknown; sig?: unknown }>(new TextDecoder().decode(bytes));
  if (!doc || typeof doc.manifest !== 'string' || typeof doc.sig !== 'string') return { why: 'manifest format' };
  if (!(await verifySignature(subtle, pubB64, doc.manifest, doc.sig))) return { why: 'manifest signature' };
  const m = parse<UpdateManifest>(doc.manifest);
  if (!m || typeof m.version !== 'string' || typeof m.sha256 !== 'string' || typeof m.size !== 'number') {
    return { why: 'manifest fields' };
  }
  return { manifest: { version: m.version, shell: Number(m.shell) || 1, sha256: m.sha256, size: m.size } };
}

/** The bundle's bytes against the signed manifest */
export async function readBundle(subtle: SubtleCrypto, m: UpdateManifest, bytes: Uint8Array): Promise<{ bundle?: UpdateBundle; why?: string }> {
  if (bytes.byteLength !== m.size) return { why: `bundle size ${bytes.byteLength} B, manifest says ${m.size} B` };
  const h = hex(await subtle.digest('SHA-256', bytes as BufferSource));
  if (h !== m.sha256) return { why: 'bundle sha256' };
  const b = parse<UpdateBundle>(new TextDecoder().decode(bytes));
  if (!b || b.version !== m.version || !b.files || !Array.isArray(b.scripts) || !b.scripts.length) {
    return { why: 'bundle does not match its manifest' };
  }
  return { bundle: { ...b, shell: Number(b.shell) || 1, styles: Array.isArray(b.styles) ? b.styles : [] } };
}

/** Why this manifest is not downloaded, or '' to download it. Each reason is distinct: they call for different reactions */
export function judge(
  m: UpdateManifest,
  ctx: { running: string; shell: number; bad: Record<string, number>; downloaded: string }
): string {
  if (compareVersions(m.version, ctx.running) <= 0) return `up to date (latest ${m.version}, running ${ctx.running})`;
  if (m.shell > ctx.shell) return `${m.version} needs a reinstall (shell ${m.shell}, this TV ${ctx.shell})`;
  if (ctx.bad[m.version]) return `${m.version} failed to start on this TV before`;
  if (ctx.downloaded === m.version) return `${m.version} already downloaded, runs next launch`;
  return '';
}

/** The record a check leaves behind */
export function record(prev: CheckRecord | null, result: string, isError: boolean, now: number): CheckRecord {
  const fails = isError ? (prev && prev.error ? (prev.fails || 1) + 1 : 1) : 0;
  return { at: now, result, error: isError, fails };
}

/**
 * How long until the next check: 6 h after a good one; 15 min after a failure, doubling with each failure in a row,
 * capped at 6 h. Never longer than one gap (a record in the future means the clock went back).
 */
export function waitAfter(last: CheckRecord | null, now: number): number {
  if (!last || !last.at) return 0;
  const gap = last.error ? Math.min(CHECK_EVERY_MS, RETRY_MS * Math.pow(2, Math.max(0, (last.fails || 1) - 1))) : CHECK_EVERY_MS;
  return Math.max(0, Math.min(gap, last.at + gap - now));
}
