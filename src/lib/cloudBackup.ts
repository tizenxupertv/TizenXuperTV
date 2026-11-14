/**
 * The copy of a user's TV app data kept in their Telegram account (the bot's /tv/data), so an uninstall, a
 * reinstall or another TV does not lose it: the profiles and, for each one, Mi lista and history, live favourites,
 * last channel, playback settings and hidden tabs. Nothing else (no session, no caches, no PIN).
 * No relative imports except localProfiles.ts, so tests can load this file in Node.
 */
import { PER_PROFILE_KEYS, PROFILES_KEY, keyFor, normalize } from './localProfiles.ts';

export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface UserDataCopy {
  v: 1;
  /** The profiles list as stored (PROFILES_KEY), null when the TV has only the main profile */
  profiles: string | null;
  /** Stored value of each per-profile key ("key" or "key@profile") */
  keys: Record<string, string>;
}

/** The per-profile keys that go to the account (the history backup copy is the same data again) */
const COPIED_KEYS = PER_PROFILE_KEYS.filter(k => k !== 'xuper_history_master_backup');
/** Keys whose presence means the TV holds someone's data (lists, history, live favourites) */
const DATA_KEYS = ['xuper_local_profile_v1', 'xuper_live_favs_v1'];

function profileIds(profilesRaw: string | null): string[] {
  let raw: unknown = null;
  try { raw = profilesRaw ? JSON.parse(profilesRaw) : null; } catch { raw = null; }
  return normalize(raw).profiles.map(p => p.id);
}

/** This TV's data as one copy */
export function buildCopy(store: KeyStore): UserDataCopy {
  const profiles = store.getItem(PROFILES_KEY);
  const keys: Record<string, string> = {};
  for (const id of profileIds(profiles)) {
    for (const k of COPIED_KEYS) {
      const key = keyFor(k, id);
      const value = store.getItem(key);
      if (value !== null) keys[key] = value;
    }
  }
  return { v: 1, profiles, keys };
}

/** Whether the TV holds any list, history or live favourites (a fresh install holds none) */
export function hasUserData(store: KeyStore): boolean {
  const copy = buildCopy(store);
  return Object.keys(copy.keys).some(key => DATA_KEYS.indexOf(key.split('@')[0]) !== -1 && isFilled(copy.keys[key]));
}

function isFilled(value: string): boolean {
  try {
    const v = JSON.parse(value);
    if (Array.isArray(v)) return v.length > 0;
    if (v && typeof v === 'object') return Object.keys(v).some(k => (Array.isArray(v[k]) ? v[k].length > 0 : !!v[k]));
    return !!v;
  } catch {
    return !!value;
  }
}

/** A copy from the account, checked: only known keys of known profiles, string values */
export function readCopy(data: unknown): UserDataCopy | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.v !== 1 || !d.keys || typeof d.keys !== 'object') return null;
  const profiles = typeof d.profiles === 'string' ? d.profiles : null;
  const allowed = new Set<string>();
  for (const id of profileIds(profiles)) for (const k of COPIED_KEYS) allowed.add(keyFor(k, id));
  const keys: Record<string, string> = {};
  for (const [key, value] of Object.entries(d.keys as Record<string, unknown>)) {
    if (allowed.has(key) && typeof value === 'string') keys[key] = value;
  }
  return { v: 1, profiles, keys };
}

/** Puts a copy on this TV without overwriting anything the TV already has; returns how many keys were written */
export function applyCopy(store: KeyStore, copy: UserDataCopy): number {
  let written = 0;
  if (copy.profiles && store.getItem(PROFILES_KEY) === null) {
    store.setItem(PROFILES_KEY, copy.profiles);
    written++;
  }
  for (const [key, value] of Object.entries(copy.keys)) {
    if (store.getItem(key) === null) {
      store.setItem(key, value);
      written++;
    }
  }
  return written;
}

/** Copies go to the account at most this often, unless a new version is about to run */
export const SAVE_EVERY_MS = 24 * 3600 * 1000;

/** Short fingerprint of a copy, kept on the TV to know whether it changed since the last save */
export function copyFingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/**
 * Whether to send the copy now: only when it changed since the last save, and then once a day at most, or at once
 * when a new version is ready (`newVersion`), so the copy is up to date before the app restarts or is reinstalled
 */
export function shouldSave(o: { changed: boolean; savedAt: number; now: number; newVersion: boolean }): boolean {
  if (!o.changed) return false;
  return o.newVersion || o.now - o.savedAt >= SAVE_EVERY_MS;
}
