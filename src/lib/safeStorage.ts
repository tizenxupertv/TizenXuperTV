/**
 * localStorage is one store of about 5 MB shared by caches (the channel lists of live TV) and by what must not be
 * lost: history and progress, favourites, the session, the PIN. A write that did not fit used to fail in silence.
 * saveItem makes room by dropping the caches, then the playback log, and tries again; when it still cannot save it
 * says so to the caller and to the problem report.
 */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Keys that are only caches: what they hold is downloaded again when missing */
export const CACHE_PREFIXES = ['xuper_magis_page_v1_'];
const PLAYBACK_LOG_KEY = 'xuper.playbackLog.v1';

function defaultStorage(): KeyValueStore | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined; // storage blocked
  }
}

/** Removes the cache keys; returns how many */
export function dropCaches(storage: KeyValueStore | undefined = defaultStorage()): number {
  if (!storage) return 0;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && CACHE_PREFIXES.some(p => key.indexOf(p) === 0)) doomed.push(key);
    }
    doomed.forEach(key => storage.removeItem(key));
  } catch {
    // nothing else to try
  }
  return doomed.length;
}

let reported = false;

/** Saves a value; false when it could not be saved even after making room */
export function saveItem(key: string, value: string, storage: KeyValueStore | undefined = defaultStorage()): boolean {
  if (!storage) return false;
  const attempt = (): boolean => {
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };
  if (attempt()) return true;
  if (dropCaches(storage) > 0 && attempt()) return true;
  if (key !== PLAYBACK_LOG_KEY) {
    try { storage.removeItem(PLAYBACK_LOG_KEY); } catch { /* same */ }
    if (attempt()) return true;
  }
  // Once per start: it goes into the problem report (the next save may fit and carry it)
  if (!reported && typeof window !== 'undefined') {
    reported = true;
    const hook = (window as any).__xuperPlaybackEvent;
    if (typeof hook === 'function') {
      try { hook({ kind: 'error', player: 'App', detail: `no se pudo guardar ${key.split('@')[0]} (almacenamiento lleno)` }); } catch { /* no report */ }
    }
  }
  return false;
}
