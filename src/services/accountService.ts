/**
 * Sign-in with Telegram (required to use the app). The TV shows a QR code that opens the
 * TizenXuper bot; the user confirms there and the TV receives a session token.
 * Only the session lives here: history, favorites and settings stay on the TV.
 *
 * Server: the TizenXuper Bot Worker (TizenXuper Bot/src/tvApi.ts).
 * No relative imports, so test/accountService.test.ts can load this file in Node.
 */
import { parseAppStatus, type AppStatus } from '../lib/appStatus.ts';
import { dropCaches } from '../lib/safeStorage.ts';
export const ACCOUNT_API_RELAY = 'https://tizenxuper-tv.pages.dev';
export const ACCOUNT_API = 'https://tizenxuper-bot.tizenxupertv.workers.dev';
export const ACCOUNT_API_FALLBACK = 'https://tizenxuper-bot.juliochemoreno.workers.dev';
/** Addresses of the TV API, tried in this order (pages.dev relay first to avoid *.workers.dev ISP bans) */
export const ACCOUNT_APIS = [ACCOUNT_API_RELAY, ACCOUNT_API, ACCOUNT_API_FALLBACK];

const SESSION_KEY = 'xuper_tg_session_v1';
const DEVICE_KEY = 'xuper_device_id_v1';
/** Last version the "new version" notice was shown for (once per version) */
const UPDATE_SEEN_KEY = 'xuper_update_seen_v1';
const REQUEST_TIMEOUT_MS = 10000;

export interface AccountUser {
  name: string;
  username: string | null;
}

export interface AccountSession extends AccountUser {
  token: string;
}

export interface LoginCode {
  code: string;
  /** Secret that only this TV knows, needed to collect the session */
  key: string;
  /** t.me deep link shown as the QR code */
  url: string;
  expiresAt: number;
  /** Seconds between status checks */
  interval: number;
}

export type PollResult = { status: 'pending' } | { status: 'expired' } | { status: 'linked'; session: AccountSession };

/** ok: session valid · revoked: the TV was unlinked (sign in again) · offline: could not check */
export type VerifyResult = 'ok' | 'revoked' | 'offline';

/** Newest release the server knows of, and the update guide (telegra.ph) */
export interface UpdateInfo {
  version: string;
  guide: string;
}

/** True when `latest` is a newer dotted version than `current` ("1.10.0" > "1.9.3"); "dev" never is */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => (/^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null);
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0;
  }
  return false;
}

interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AccountDeps {
  storage: () => KeyValue;
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  /** App version and TV model sent to the server */
  device: () => { version: string; model: string };
  randomBytes: (n: number) => Uint8Array;
  /** Custom endpoint list; defaults to ACCOUNT_APIS in browsers */
  endpoints?: string[];
}

/** ABCD2345 → ABCD-2345 */
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export function createAccountService(deps: AccountDeps) {
  let listeners: Array<() => void> = [];
  // From the last session check: the newest release, if the server sent it
  let latest: UpdateInfo | null = null;
  const notify = () => listeners.forEach(cb => {
    try { cb(); } catch (e) {}
  });

  const endpoints = deps.endpoints || (typeof window !== 'undefined' ? ACCOUNT_APIS : [ACCOUNT_API_RELAY]);

  function read(key: string): string | null {
    try { return deps.storage().getItem(key); } catch (e) { return null; }
  }
  function write(key: string, value: string | null): void {
    try {
      if (value === null) deps.storage().removeItem(key);
      else deps.storage().setItem(key, value);
    } catch (e) {
      // Store full: the channel caches make room for the session, once (a session that is not saved signs the TV out)
      if (value !== null && dropCaches() > 0) {
        try { deps.storage().setItem(key, value); } catch (e2) {}
      }
    }
  }

  /** Random id of this installation (not the TV's hardware id) */
  function deviceId(): string {
    const saved = read(DEVICE_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
    const id = Array.from(deps.randomBytes(16), b => b.toString(16).padStart(2, '0')).join('');
    write(DEVICE_KEY, id);
    return id;
  }

  async function post(path: string, body: unknown, token?: string): Promise<Response> {
    let lastError: Error | null = null;
    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i];
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctrl && ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await deps.fetchFn(`${endpoint}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: ctrl ? ctrl.signal : undefined
        });
        // A transient 5xx: try the next address, when there is one
        if (i < endpoints.length - 1 && (res.status === 502 || res.status === 503 || res.status === 504)) {
          console.warn(`[account] ${endpoint}${path} returned ${res.status}, trying fallback...`);
          continue;
        }
        return res;
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[account] ${endpoint}${path} network error:`, lastError.message);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new Error('network_error');
  }

  function session(): AccountSession | null {
    const raw = read(SESSION_KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      return s && typeof s.token === 'string' && s.token ? { token: s.token, name: String(s.name || ''), username: s.username || null } : null;
    } catch (e) {
      return null;
    }
  }

  function save(s: AccountSession | null): void {
    write(SESSION_KEY, s ? JSON.stringify(s) : null);
    notify();
  }

  return {
    session,

    isSignedIn(): boolean {
      return session() !== null;
    },

    /** New one-time code for the QR screen; throws when the server cannot be reached */
    async startLogin(): Promise<LoginCode> {
      const { version, model } = deps.device();
      const res = await post('/tv/login', { deviceId: deviceId(), version, model });
      if (!res.ok) throw new Error(`login ${res.status}`);
      const data = await res.json();
      return {
        code: String(data.code),
        key: String(data.key),
        url: String(data.url),
        expiresAt: deps.now() + Number(data.expiresIn || 300) * 1000,
        interval: Math.max(2, Number(data.interval || 4))
      };
    },

    /** Checks whether the user confirmed the code; saves the session when linked */
    async poll(login: LoginCode): Promise<PollResult> {
      if (deps.now() >= login.expiresAt) return { status: 'expired' };
      const res = await post('/tv/login/status', { code: login.code, key: login.key });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      if (data.status === 'linked' && typeof data.token === 'string') {
        const s: AccountSession = {
          token: data.token,
          name: String((data.user && data.user.name) || ''),
          username: (data.user && data.user.username) || null
        };
        save(s);
        return { status: 'linked', session: s };
      }
      return data.status === 'expired' ? { status: 'expired' } : { status: 'pending' };
    },

    /** Confirms the saved session with the server; only an explicit 401 signs the TV out */
    async verify(): Promise<VerifyResult> {
      const s = session();
      if (!s) return 'revoked';
      try {
        const { version, model } = deps.device();
        const res = await post('/tv/session', { version, model }, s.token);
        if (res.status === 401) {
          save(null);
          return 'revoked';
        }
        if (!res.ok) return 'offline';
        const data = await res.json();
        const l = data.latest;
        latest = l && typeof l.version === 'string' && typeof l.guide === 'string' && /^https:\/\//.test(l.guide)
          ? { version: l.version, guide: l.guide }
          : null;
        if (data.user && (data.user.name !== s.name || (data.user.username || null) !== s.username)) {
          save({ token: s.token, name: String(data.user.name || ''), username: data.user.username || null });
        }
        return 'ok';
      } catch (e) {
        return 'offline';
      }
    },

    /** A newer version this TV has not been told about yet (shown once per version), after verify() */
    /** The status the team set for every TV (lib/appStatus), or null. A failed request is "no status": the app stays usable */
    async appStatus(): Promise<AppStatus | null> {
      try {
        const res = await post('/tv/maintenance/status', {});
        if (!res.ok) return null;
        return parseAppStatus(await res.json());
      } catch {
        return null;
      }
    },

    pendingUpdate(): UpdateInfo | null {
      if (!latest || !isNewerVersion(latest.version, deps.device().version)) return null;
      return read(UPDATE_SEEN_KEY) === latest.version ? null : latest;
    },

    /** The notice for this version was shown */
    markUpdateSeen(version: string): void {
      write(UPDATE_SEEN_KEY, version);
    },

    /** App version and TV model, for the problem report */
    deviceInfo(): { version: string; model: string } {
      return deps.device();
    },

    /** Sends a problem report to support; the bot delivers it and answers the user in Telegram */
    async sendReport(report: object): Promise<'ok' | 'too_many' | 'signed_out' | 'error'> {
      const s = session();
      if (!s) return 'signed_out';
      try {
        const res = await post('/tv/report', { report }, s.token);
        if (res.ok) return 'ok';
        if (res.status === 429) return 'too_many';
        if (res.status === 401) return 'signed_out';
        return 'error';
      } catch (e) {
        return 'error';
      }
    },

    /** Forgets the session on this TV and asks the server to unlink it */
    async logout(): Promise<void> {
      const s = session();
      save(null);
      if (!s) return;
      try { await post('/tv/logout', {}, s.token); } catch (e) {}
    },

    subscribe(cb: () => void): () => void {
      listeners.push(cb);
      return () => { listeners = listeners.filter(l => l !== cb); };
    }
  };
}

export type AccountService = ReturnType<typeof createAccountService>;

declare const __APP_VERSION__: string;

/**
 * Firmware and model code for the support report, e.g. "Firmware T-KSU2EFUABC-0090-1300.9 · modelo 24_PONTUSM_UHD (2024)":
 * playback problems often depend on the firmware. Needs the productinfo privilege (already in config.xml); '' in a browser.
 */
export function tvBuildInfo(
  productinfo: any = typeof window !== 'undefined' && (window as any).webapis ? (window as any).webapis.productinfo : null
): string {
  if (!productinfo) return '';
  const read = (fn: string): string => {
    try {
      return typeof productinfo[fn] === 'function' ? String(productinfo[fn]() || '').trim() : '';
    } catch (e) {
      return '';
    }
  };
  const firmware = read('getFirmware');
  const code = read('getModelCode');
  const year = /^(\d{2})_/.exec(code);
  return [firmware && `Firmware ${firmware}`, code && `modelo ${code}${year ? ` (20${year[1]})` : ''}`]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 120);
}

/** TV model and Tizen version for support, e.g. "UN50U8000FKXZL · Tizen 9.0" (empty in a browser) */
function tvModel(): string {
  const w = window as any;
  let model = '';
  try {
    // Needs the productinfo privilege in config.xml
    if (w.webapis && w.webapis.productinfo) model = String(w.webapis.productinfo.getRealModel() || w.webapis.productinfo.getModel() || '');
  } catch (e) {}
  try {
    if (!model && w.tizen && w.tizen.systeminfo) model = String(w.tizen.systeminfo.getCapability('http://tizen.org/system/model_name') || '');
  } catch (e) {}
  let tizen = '';
  try {
    if (w.tizen && w.tizen.systeminfo) tizen = String(w.tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version') || '');
  } catch (e) {}
  return [model, tizen && `Tizen ${tizen}`].filter(Boolean).join(' · ');
}

export const accountService = createAccountService({
  storage: () => window.localStorage,
  fetchFn: (url, init) => fetch(url, init),
  now: () => Date.now(),
  device: () => ({ version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev', model: tvModel() }),
  randomBytes: n => {
    try {
      const c = typeof window !== 'undefined' ? (window.crypto || (window as any).msCrypto) : null;
      if (c && typeof c.getRandomValues === 'function') {
        return c.getRandomValues(new Uint8Array(n));
      }
    } catch (e) {}
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
  }
});
