/**
 * The local profile (localStorage 'xuper_local_profile_v1') holds the watch history, with the progress of movies and
 * episodes inside each entry, the favorites and the profile id. These helpers return a copy without part of it and
 * keep everything else. No relative imports, so test/profileHistory.test.ts can load this file in Node.
 */
type Profile = { history?: Array<{ id: string | number }>; favs?: Record<string, unknown> };

/** Without the whole watch history (titles and progress) */
export function withoutHistory<T extends Profile>(profile: T): T {
  return { ...profile, history: [] };
}

/** Without one title of the history (and its progress) */
export function withoutHistoryEntry<T extends Profile>(profile: T, id: string | number): T {
  return { ...profile, history: (profile.history || []).filter(h => String(h.id) !== String(id)) };
}

/** Without one favorite */
export function withoutFavorite<T extends Profile>(profile: T, id: string | number): T {
  const favs = { ...(profile.favs || {}) };
  delete favs[String(id)];
  return { ...profile, favs };
}
