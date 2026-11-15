import { useEffect, useState } from 'react';

export interface TitleMetaEntry {
  quality?: string;
  qualities?: string[];
  hasCC?: boolean;
  year?: string;
  duration?: string;
  actors?: string;
  director?: string;
  updatedAt: number;
}

const STORAGE_KEY = 'xuper_title_meta_cache_v1';
const MAX_ENTRIES = 500;

const memoryCache = new Map<string, TitleMetaEntry>();
const listeners = new Map<string, Set<() => void>>();
let hydrated = false;

function hydrateOnce(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [id, entry] of Object.entries(parsed)) {
        if (entry && typeof entry === 'object') {
          memoryCache.set(id, entry as TitleMetaEntry);
        }
      }
    }
  } catch {
    // Ignore storage read errors
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      if (memoryCache.size > MAX_ENTRIES) {
        const sorted = Array.from(memoryCache.entries()).sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0));
        const toRemove = sorted.length - MAX_ENTRIES;
        for (let i = 0; i < toRemove; i++) {
          memoryCache.delete(sorted[i][0]);
        }
      }
      const obj: Record<string, TitleMetaEntry> = {};
      memoryCache.forEach((v, k) => {
        obj[k] = v;
      });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // Ignore storage quota/write errors
    }
  }, 400);
}

export function getCachedTitleMeta(id?: string): TitleMetaEntry | null {
  if (!id) return null;
  hydrateOnce();
  return memoryCache.get(String(id)) || null;
}

export function setCachedTitleMeta(
  id: string | undefined,
  patch: {
    quality?: string;
    qualities?: string[];
    hasCC?: boolean;
    year?: string;
    duration?: string;
    actors?: string;
    director?: string;
  }
): void {
  if (!id) return;
  hydrateOnce();
  const key = String(id);
  const existing = memoryCache.get(key);

  const nextQualities =
    patch.qualities && patch.qualities.length
      ? Array.from(new Set([...(existing?.qualities || []), ...patch.qualities.map(q => String(q).trim()).filter(Boolean)]))
      : existing?.qualities;

  const nextQuality = patch.quality || existing?.quality || (nextQualities?.length ? nextQualities.join(',') : undefined);
  const nextHasCC = Boolean(patch.hasCC || existing?.hasCC);
  const cleanStr = (v?: string) => (v && v !== '—' ? v : undefined);
  const nextYear = cleanStr(patch.year) || existing?.year;
  const nextDuration = cleanStr(patch.duration) || existing?.duration;
  const nextActors = cleanStr(patch.actors) || existing?.actors;
  const nextDirector = cleanStr(patch.director) || existing?.director;

  if (!nextQuality && (!nextQualities || !nextQualities.length) && !nextHasCC && !nextYear && !nextDuration && !nextActors && !nextDirector) {
    return;
  }

  const changed =
    !existing ||
    existing.quality !== nextQuality ||
    Boolean(existing.hasCC) !== nextHasCC ||
    existing.year !== nextYear ||
    existing.duration !== nextDuration ||
    existing.actors !== nextActors ||
    existing.director !== nextDirector ||
    (nextQualities?.length || 0) !== (existing.qualities?.length || 0);

  if (!changed) return;

  memoryCache.set(key, {
    quality: nextQuality,
    qualities: nextQualities,
    hasCC: nextHasCC || undefined,
    year: nextYear,
    duration: nextDuration,
    actors: nextActors,
    director: nextDirector,
    updatedAt: Date.now()
  });

  schedulePersist();

  const subs = listeners.get(key);
  if (subs) {
    subs.forEach(cb => {
      try {
        cb();
      } catch {
        // Ignore subscriber errors
      }
    });
  }
}

export function subscribeTitleMeta(id: string | undefined, cb: () => void): () => void {
  if (!id) return () => {};
  const key = String(id);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    const s = listeners.get(key);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) listeners.delete(key);
  };
}

/**
 * Reactive hook returning cached quality/subtitle metadata for a title ID.
 */
export function useTitleMeta(id?: string): TitleMetaEntry | null {
  const [entry, setEntry] = useState<TitleMetaEntry | null>(() => getCachedTitleMeta(id));

  useEffect(() => {
    setEntry(getCachedTitleMeta(id));
    if (!id) return;
    return subscribeTitleMeta(id, () => {
      setEntry(getCachedTitleMeta(id));
    });
  }, [id]);

  return entry;
}
