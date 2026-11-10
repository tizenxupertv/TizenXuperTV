import type { HistoryItem, EpisodePlaybackRecord } from '../types/history';
import type { VodItem, VodEpisode } from '../types/vod';
import { isFinished } from '../lib/vodResume.ts';
import { withoutHistory, withoutHistoryEntry } from '../lib/profileHistory.ts';
import { pk } from '../lib/localProfiles.ts';
import { isAdultItem } from '../lib/catalogOrganizer.ts';
import { readStoredJson } from '../lib/storedJson.ts';

const PROFILE_KEY = pk('xuper_local_profile_v1');
const PRIVATE_IDS_KEY = 'xuper_private_ids_v1';

class HistoryService {
  private listeners: Array<() => void> = [];
  private hasMergedAll = false;
  private privateIds: Set<string> = new Set();
  private privateLoaded = false;

  private ensurePrivateLoaded(): void {
    if (this.privateLoaded) return;
    this.privateLoaded = true;
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(PRIVATE_IDS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (id !== undefined && id !== null && String(id).trim()) {
              this.privateIds.add(String(id).trim());
            }
          }
        }
      }
    } catch (e) {}
  }

  private savePrivateIds(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const arr = Array.from(this.privateIds).slice(-2000);
      localStorage.setItem(PRIVATE_IDS_KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  /** Marks one or more items as private/adult (+18) so they are never stored or shown in Continue Watching */
  public markPrivate(items: Array<{ id?: string | number }> | { id?: string | number } | null | undefined): void {
    if (!items) return;
    this.ensurePrivateLoaded();
    const list = Array.isArray(items) ? items : [items];
    let added = false;
    const idsToPurge = new Set<string>();
    for (const it of list) {
      const id = String(it?.id ?? '').trim();
      if (!id) continue;
      idsToPurge.add(id);
      if (!this.privateIds.has(id)) {
        this.privateIds.add(id);
        added = true;
      }
    }
    if (added) this.savePrivateIds();
    if (idsToPurge.size > 0) {
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(PROFILE_KEY);
          if (raw) {
            const profile = JSON.parse(raw);
            if (profile && Array.isArray(profile.history)) {
              const before = profile.history.length;
              profile.history = profile.history.filter((h: any) => !idsToPurge.has(String(h?.id ?? '')) && !this.isRestricted(h));
              if (profile.history.length !== before) {
                localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
                this.notify();
              }
            }
          }
        }
      } catch (e) {}
    }
  }

  /** Checks whether an item or history entry is adult/restricted (+18) and must be excluded from public history */
  public isRestricted(item: any): boolean {
    if (!item) return false;
    this.ensurePrivateLoaded();
    const id = String(item.id ?? '').trim();
    if (id && this.privateIds.has(id)) return true;
    if (item.restricted === true || item.restricted === '1' || item.privateContent === true || item.category === 'adult') {
      return true;
    }
    return isAdultItem(item as VodItem);
  }

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

  /**
   * The profile for reading only: parsed once per stored text (lib/storedJson.ts), where getProfile() parses a copy of
   * its own for the code that edits and saves it. Never change what this returns
   */
  private readProfile(): any {
    if (!this.hasMergedAll) return this.getProfile();
    return readStoredJson(PROFILE_KEY) || this.getProfile();
  }

  public getHistory(): HistoryItem[] {
    const profile = this.readProfile();
    const list: HistoryItem[] = (profile && Array.isArray(profile.history)) ? profile.history : [];
    return list.filter(h => !this.isRestricted(h));
  }

  /** History entry of an item (the series/movie whose detail was opened) */
  public getEntry(itemId: string): HistoryItem | undefined {
    this.ensurePrivateLoaded();
    if (this.privateIds.has(String(itemId))) return undefined;
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
    if (this.isRestricted(item)) {
      this.markPrivate(item);
      return;
    }
    
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
      // A favorite is `true` or the title's info (favoritesService): keep the info when any copy has it
      const allFavs: Record<string, unknown> = {};

      // 1. Scan storage keys belonging to the active profile or legacy non-profiled backup
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i);
        if (!key) continue;

        if (
          key === PROFILE_KEY ||
          (PROFILE_KEY === 'xuper_local_profile_v1' && (key === 'xuper_local_profile_v1' || key.startsWith('xuper_history')))
        ) {
          try {
            const raw = ls.getItem(key);
            if (!raw) continue;
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object') continue;

            if (Array.isArray(data.history)) {
              for (const item of data.history) {
                if (!item || !item.id || this.isRestricted(item)) continue;
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
                const favVal = data.favs[fid];
                if (favVal && typeof favVal === 'object' && this.isRestricted({ id: fid, ...favVal })) continue;
                if (this.privateIds.has(String(fid))) continue;
                if (favVal && (typeof favVal === 'object' || !allFavs[fid])) allFavs[fid] = favVal;
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
          if (!item || !item.id || this.isRestricted(item)) continue;
          const id = String(item.id);
          const existing = allHistories[id];
          if (!existing || (item.updatedAt || 0) >= (existing.updatedAt || 0)) {
            allHistories[id] = item;
          }
        }
      }
      if (current.favs) {
        for (const fid of Object.keys(current.favs)) {
          const favVal = current.favs[fid];
          if (favVal && typeof favVal === 'object' && this.isRestricted({ id: fid, ...favVal })) continue;
          if (this.privateIds.has(String(fid))) continue;
          if (favVal && (typeof favVal === 'object' || !allFavs[fid])) allFavs[fid] = favVal;
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
