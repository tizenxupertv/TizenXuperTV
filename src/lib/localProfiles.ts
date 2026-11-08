/**
 * Local profiles: several people on one TV, each with their own watch history, Mi lista, live favorites,
 * last channel, settings and hidden tabs. No accounts or passwords: a convenience, not a security boundary.
 *
 * The first profile ("Principal") keeps the original storage keys, so existing data needs no migration;
 * every other profile stores the same keys with an "@<id>" suffix. The active profile is fixed for a whole
 * launch (services read their keys when they load), so switching profile reloads the app.
 * No relative imports, so test/localProfiles.test.ts can load this file in Node.
 */
export interface LocalProfile {
  id: string;
  name: string;
  color: string;
}

interface State {
  profiles: LocalProfile[];
  active: string;
}

interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const PROFILES_KEY = 'xuper_profiles_v1';
/** Set for this launch (and the reload that follows a switch) once someone answered "¿Quién está viendo?" */
const CHOSEN_KEY = 'xuper_profile_chosen';
export const MAIN_PROFILE = 'principal';
export const MAX_PROFILES = 3;
export const MAX_NAME = 16;
export const PROFILE_COLORS = ['#7c3aed', '#0891b2', '#d97706', '#059669', '#2563eb', '#db2777'];

/** Data kept apart for each profile */
export const PER_PROFILE_KEYS = [
  'xuper_local_profile_v1',
  'xuper_live_favs_v1',
  'xuper_last_live_ch',
  'xuper_last_live_cat_idx',
  'xuper_global_playback_v1',
  'xuper_hidden_tabs'
];

export function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
}

/** "ana maría" -> "Ana María" (the on-screen keyboard types lowercase) */
export function displayName(value: string): string {
  return cleanName(value).replace(/(^|\s)(\S)/g, (_, sp: string, ch: string) => sp + ch.toLocaleUpperCase('es'));
}

export function normalize(raw: any): State {
  const profiles: LocalProfile[] = [];
  if (raw && Array.isArray(raw.profiles)) {
    for (const p of raw.profiles) {
      if (profiles.length >= MAX_PROFILES) break;
      if (!p || typeof p.id !== 'string' || !/^(principal|p[a-z0-9]{1,24})$/.test(p.id)) continue;
      const name = cleanName(p.name);
      if (!name || profiles.some(x => x.id === p.id)) continue;
      const color = PROFILE_COLORS.indexOf(p.color) !== -1 ? p.color : PROFILE_COLORS[profiles.length % PROFILE_COLORS.length];
      profiles.push({ id: p.id, name, color });
    }
  }
  // The main profile always exists and comes first: it owns the data saved before profiles existed
  const main = profiles.findIndex(p => p.id === MAIN_PROFILE);
  if (main === -1) profiles.unshift({ id: MAIN_PROFILE, name: 'Principal', color: PROFILE_COLORS[0] });
  else if (main > 0) profiles.unshift(profiles.splice(main, 1)[0]);
  if (profiles.length > MAX_PROFILES) profiles.length = MAX_PROFILES;
  const active = raw && profiles.some(p => p.id === raw.active) ? raw.active : MAIN_PROFILE;
  return { profiles, active };
}

/** Storage key of `key` for a profile */
export function keyFor(key: string, profileId: string): string {
  return profileId === MAIN_PROFILE ? key : `${key}@${profileId}`;
}

export function createProfileStore(store: KeyStore | null, session: KeyStore | null, storedKeys?: () => string[]) {
  let state: State;
  try {
    state = normalize(store ? JSON.parse(store.getItem(PROFILES_KEY) || 'null') : null);
  } catch (e) {
    state = normalize(null);
  }
  // Data of deleted profiles: a deleted profile still in use can save once more before the app reloads
  if (store && storedKeys) {
    try {
      for (const k of storedKeys()) {
        const at = k.lastIndexOf('@');
        if (at === -1 || PER_PROFILE_KEYS.indexOf(k.slice(0, at)) === -1) continue;
        if (!state.profiles.some(p => p.id === k.slice(at + 1))) store.removeItem(k);
      }
    } catch (e) {}
  }

  const save = (): boolean => {
    try {
      if (store) store.setItem(PROFILES_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  };
  const find = (id: string) => state.profiles.find(p => p.id === id) || null;

  return {
    list: (): LocalProfile[] => state.profiles.map(p => ({ ...p })),
    active: (): LocalProfile => ({ ...(find(state.active) || state.profiles[0]) }),
    /** This launch's key for a per-profile setting */
    key: (key: string): string => keyFor(key, state.active),
    /** "¿Quién está viendo?" at startup: only with two or more profiles, once per launch */
    needsPicker: (): boolean => {
      if (state.profiles.length < 2) return false;
      try {
        return !(session && session.getItem(CHOSEN_KEY));
      } catch (e) {
        return true;
      }
    },
    markChosen: (): void => {
      try { if (session) session.setItem(CHOSEN_KEY, '1'); } catch (e) {}
    },
    /** Makes a profile the active one; the caller reloads the app when it changed */
    select: (id: string): boolean => {
      if (!find(id)) return false;
      state.active = id;
      return save();
    },
    create: (name: string): LocalProfile | null => {
      const clean = displayName(name);
      if (!clean || state.profiles.length >= MAX_PROFILES) return null;
      let id = '';
      do id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      while (find(id));
      const used = state.profiles.map(p => p.color);
      const color = PROFILE_COLORS.find(c => used.indexOf(c) === -1) || PROFILE_COLORS[state.profiles.length % PROFILE_COLORS.length];
      const profile = { id, name: clean, color };
      state.profiles.push(profile);
      return save() ? { ...profile } : (state.profiles.pop(), null);
    },
    rename: (id: string, name: string): boolean => {
      const p = find(id);
      const clean = displayName(name);
      if (!p || !clean) return false;
      p.name = clean;
      return save();
    },
    /** Deletes a profile and everything it saved. The main profile cannot be deleted */
    remove: (id: string): boolean => {
      if (id === MAIN_PROFILE || !find(id)) return false;
      state.profiles = state.profiles.filter(p => p.id !== id);
      if (state.active === id) state.active = MAIN_PROFILE;
      if (store) {
        for (const k of PER_PROFILE_KEYS) {
          try { store.removeItem(keyFor(k, id)); } catch (e) {}
        }
      }
      return save();
    }
  };
}

function storageOf(name: 'localStorage' | 'sessionStorage'): KeyStore | null {
  try {
    return typeof window !== 'undefined' && (window as any)[name] ? (window as any)[name] : null;
  } catch (e) {
    return null;
  }
}

export const localProfiles = createProfileStore(storageOf('localStorage'), storageOf('sessionStorage'), () => {
  const ls = storageOf('localStorage') as Storage | null;
  const keys: string[] = [];
  if (ls) for (let i = 0; i < ls.length; i++) keys.push(ls.key(i) || '');
  return keys;
});

/** Storage key of a per-profile setting for the profile of this launch */
export const pk = (key: string): string => localProfiles.key(key);

// The AVPlay bridge (public/js/tizen-bridge.js) reads the playback settings of the active profile through this
if (typeof window !== 'undefined') (window as any).__xuperProfileKey = pk;
