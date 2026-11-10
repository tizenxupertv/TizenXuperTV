/**
 * Parsed value of a localStorage key, parsed again only when the stored text changed.
 *
 * The profile (history, favourites) and the settings were parsed from scratch on every read, and screens read them on
 * every render: several times a second under a playing video. The text is still read on every call, so a write made
 * by any other code (another service, the TV bridge) is seen at once.
 *
 * The value is shared between callers: read it, never change it. Code that edits and saves parses its own copy.
 */
const cache = new Map<string, { raw: string; value: unknown }>();

function defaultStorage(): Pick<Storage, 'getItem'> | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined; // storage blocked
  }
}

/** The parsed value, or null when the key is missing or is not valid JSON */
export function readStoredJson<T = any>(key: string, storage: Pick<Storage, 'getItem'> | undefined = defaultStorage()): T | null {
  let raw: string | null = null;
  try {
    raw = storage ? storage.getItem(key) : null;
  } catch {
    raw = null;
  }
  if (raw === null || raw === undefined) {
    cache.delete(key);
    return null;
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  try {
    const value = JSON.parse(raw);
    cache.set(key, { raw, value });
    return value as T;
  } catch {
    cache.delete(key);
    return null;
  }
}
