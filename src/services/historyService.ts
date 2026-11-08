import { HistoryItem, EpisodePlaybackRecord } from '../types/history';
import { VodItem, VodEpisode } from '../types/vod';
import { isFinished } from '../lib/vodResume';
import { withoutHistory, withoutHistoryEntry } from '../lib/profileHistory';
import { pk } from '../lib/localProfiles';

const PROFILE_KEY = pk('xuper_local_profile_v1');

class HistoryService {
  private listeners: Array<() => void> = [];
  private hasMergedAll = false;

  private getProfile(): any {
    if (!this.hasMergedAll) {
      this.hasMergedAll = true;
      this.mergeAllHistories();
    }

    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    const fresh = {
      id: 'TV-' + String(Date.now()).slice(-8),
      createdAt: Date.now(),
      history: [],
      favs: {}
    };
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(fresh));
    } catch (e) {}
    return fresh;
  }

  public getHistory(): HistoryItem[] {
    const profile = this.getProfile();
    return (profile && profile.history) ? profile.history : [];
  }

  /** History entry of an item (the series/movie whose detail was opened) */
  public getEntry(itemId: string): HistoryItem | undefined {
    return this.getHistory().find(h => String(h.id) === String(itemId));
  }

  public savePlayback(
    item: VodItem,
    position: number,
    duration: number,
    episode?: VodEpisode,
    force: boolean = false,
    season?: { id?: string; number?: number }
  ): void {
    if (!item || !item.id) return;
    
    // Ensure valid position (even for 0 or newly opened)
    const validPos = Math.max(0, Math.floor(position));
    const validDur = Math.max(0, Math.floor(duration));

    const profile = this.getProfile();
    const list: HistoryItem[] = profile.history || [];
    const now = Date.now();
    const itemId = String(item.id);

    const existingEntry = list.find(h => String(h.id) === itemId);
    const watchedEpisodes: Record<string, EpisodePlaybackRecord> = {
      ...(existingEntry?.watchedEpisodes || {})
    };

    if (episode) {
      const epNum = episode.number || episode.seriesNumber;
      const finished = isFinished(validPos, validDur);
      const record: EpisodePlaybackRecord = {
        episodeId: episode.id ? String(episode.id) : undefined,
        episodeNumber: epNum,
        seasonNumber: season?.number,
        seasonId: season?.id ? String(season.id) : undefined,
        position: validPos,
        duration: validDur,
        finished,
        updatedAt: now
      };
      if (episode.id) {
        watchedEpisodes[String(episode.id)] = record;
      }
      if (epNum !== undefined) {
        watchedEpisodes[`num_${epNum}`] = record;
      }
    }

    const entry: HistoryItem = {
      id: itemId,
      title: item.title || 'Contenido',
      poster: item.landscape || item.poster || item.backdrop || 'assets/placeholder_landscape.png',
      series: !!(item.isSeries || (item.episodes && item.episodes.length > 0) || item.kind === 'serie'),
      episodeId: episode && episode.id ? String(episode.id) : undefined,
      episodeNumber: episode ? (episode.number || episode.seriesNumber) : undefined,
      seasonId: season && season.id ? String(season.id) : undefined,
      seasonNumber: season && season.number ? season.number : undefined,
      position: validPos,
      duration: validDur,
      updatedAt: now,
      watchedEpisodes: Object.keys(watchedEpisodes).length > 0 ? watchedEpisodes : undefined
    };

    // Filter out existing entry for this item
    const nextList: HistoryItem[] = [entry];
    for (let i = 0; i < list.length && nextList.length < 30; i++) {
      if (String(list[i].id) !== itemId) {
        nextList.push(list[i]);
      }
    }

    profile.history = nextList;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (e) {}

    this.notify();
  }

  /** Forgets what was watched on this TV (titles and their progress); favorites and settings stay. False if it could not be saved. */
  public clearHistory(): boolean {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(withoutHistory(this.getProfile())));
    } catch (e) {
      return false;
    }
    this.notify();
    return true;
  }

  /** Forgets one title (and its progress). False if it could not be saved. */
  public removeEntry(itemId: string | number): boolean {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(withoutHistoryEntry(this.getProfile(), itemId)));
    } catch (e) {
      return false;
    }
    this.notify();
    return true;
  }

  /**
   * Scans all profiles and history backups in localStorage and merges them into the active profile.
   * Ensures new history and previous history are preserved together without duplicate entries.
   */
  public mergeAllHistories(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const ls = window.localStorage;
      const allHistories: Record<string, HistoryItem> = {};
      const allFavs: Record<string, boolean> = {};

      // 1. Scan all storage keys containing profile or history data
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i);
        if (!key) continue;

        if (
          key === 'xuper_local_profile_v1' ||
          key.startsWith('xuper_local_profile_v1@') ||
          key.startsWith('xuper_history')
        ) {
          try {
            const raw = ls.getItem(key);
            if (!raw) continue;
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object') continue;

            if (Array.isArray(data.history)) {
              for (const item of data.history) {
                if (!item || !item.id) continue;
                const id = String(item.id);
                const existing = allHistories[id];
                if (!existing) {
                  allHistories[id] = item;
                } else {
                  const itemTime = item.updatedAt || 0;
                  const existTime = existing.updatedAt || 0;
                  if (itemTime > existTime || (itemTime === existTime && (item.position || 0) > (existing.position || 0))) {
                    allHistories[id] = { ...existing, ...item };
                  }
                }
              }
            }

            if (data.favs && typeof data.favs === 'object') {
              for (const fid of Object.keys(data.favs)) {
                if (data.favs[fid]) allFavs[fid] = true;
              }
            }
          } catch (e) {}
        }
      }

      // 2. Read active profile
      let current: any = null;
      try {
        const curRaw = ls.getItem(PROFILE_KEY);
        if (curRaw) current = JSON.parse(curRaw);
      } catch (e) {}
      if (!current || typeof current !== 'object') {
        current = {
          id: 'TV-' + String(Date.now()).slice(-8),
          createdAt: Date.now(),
          history: [],
          favs: {}
        };
      }

      if (Array.isArray(current.history)) {
        for (const item of current.history) {
          if (!item || !item.id) continue;
          const id = String(item.id);
          const existing = allHistories[id];
          if (!existing || (item.updatedAt || 0) >= (existing.updatedAt || 0)) {
            allHistories[id] = item;
          }
        }
      }
      if (current.favs) {
        for (const fid of Object.keys(current.favs)) {
          if (current.favs[fid]) allFavs[fid] = true;
        }
      }

      const mergedList = Object.values(allHistories).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      if (mergedList.length > 0) {
        current.history = mergedList.slice(0, 50);
        current.favs = allFavs;
        ls.setItem(PROFILE_KEY, JSON.stringify(current));
        ls.setItem('xuper_history_master_backup', JSON.stringify(current));
      }
    } catch (e) {}
  }

  /** Restores or merges history from all sources into the active profile */
  public restoreFromMainProfile(): boolean {
    this.mergeAllHistories();
    this.notify();
    return true;
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  private notify() {
    this.listeners.forEach(cb => {
      try { cb(); } catch (e) {}
    });
  }
}

export const historyService = new HistoryService();
