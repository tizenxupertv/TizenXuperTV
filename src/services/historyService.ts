import type { HistoryItem, EpisodePlaybackRecord } from '../types/history';
import type { VodItem, VodEpisode } from '../types/vod';
import { isFinished } from '../lib/vodResume.ts';
import { withoutHistory, withoutHistoryEntry } from '../lib/profileHistory.ts';
import { pk } from '../lib/localProfiles.ts';
import { isAdultItem } from '../lib/catalogOrganizer.ts';
import { readStoredJson } from '../lib/storedJson.ts';
import { saveItem } from '../lib/safeStorage.ts';

const PROFILE_KEY = pk('xuper_local_profile_v1');
/**
 * A second copy of this profile, in case its key is lost: written at start and after every deletion, and merged back
 * at start. One per profile: it used to be a single key for all of them, so another profile's history ended up in
 * Principal, and a title removed from the history came back at the next start
 */
const BACKUP_KEY = pk('xuper_history_master_backup');
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
      saveItem(PRIVATE_IDS_KEY, JSON.stringify(arr));
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
                saveItem(PROFILE_KEY, JSON.stringify(profile));
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
      saveItem(PROFILE_KEY, JSON.stringify(fresh));
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
    // Makes room (channel caches first) when the store is full, and reports it when it still cannot save
    saveItem(PROFILE_KEY, JSON.stringify(profile));

    this.notify();
  }

  /** Forgets what was watched on this TV (titles and their progress); favorites and settings stay. False if it could not be saved. */
  public clearHistory(): boolean {
    try {
      if (!saveItem(PROFILE_KEY, JSON.stringify(withoutHistory(this.getProfile())))) return false;
    } catch (e) {
      return false;
    }
    this.syncBackup();
    this.notify();
    return true;
  }

  /** Forgets one title (and its progress). False if it could not be saved. */
  public removeEntry(itemId: string | number): boolean {
    try {
      if (!saveItem(PROFILE_KEY, JSON.stringify(withoutHistoryEntry(this.getProfile(), itemId)))) return false;
    } catch (e) {
      return false;
    }
    this.syncBackup();
    this.notify();
    return true;
  }

  /**
   * Copies the stored profile over its backup copy. Called after something is deleted on purpose (a title of the
   * history, the whole history, a favourite), so the start-up merge does not bring it back
   */
  public syncBackup(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) localStorage.setItem(BACKUP_KEY, raw);
    } catch (e) {}
  }

  /**
   * Merges this profile with its backup copy (history by newest entry, favourites as a union) and saves both, so a
   * profile whose key was lost gets its history back. Nothing is written when nothing changed.
   */
  public mergeAllHistories(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const ls = window.localStorage;
      const parse = (raw: string | null): any => {
        try {
          const data = raw ? JSON.parse(raw) : null;
          return data && typeof data === 'object' ? data : null;
        } catch (e) {
          return null;
        }
      };
      const curRaw = ls.getItem(PROFILE_KEY);
      const stored = parse(curRaw);
      const current: any = stored || {
        id: 'TV-' + String(Date.now()).slice(-8),
        createdAt: Date.now(),
        history: [],
        favs: {}
      };
      const backupRaw = ls.getItem(BACKUP_KEY);
      const backup = parse(backupRaw);
      // A copy left by another profile (older versions shared one key) is not this profile's history. With the
      // profile itself gone there is nothing to compare: the copy is all there is
      const backupIsOurs = !!backup && (!stored || !backup.id || !stored.id || backup.id === stored.id);

      const allHistories: Record<string, HistoryItem> = {};
      // A favorite is `true` or the title's info (favoritesService): keep the info when any copy has it
      const allFavs: Record<string, unknown> = {};
      const addFavs = (favs: any) => {
        if (!favs || typeof favs !== 'object') return;
        for (const fid of Object.keys(favs)) {
          const favVal = favs[fid];
          if (favVal && typeof favVal === 'object' && this.isRestricted({ id: fid, ...favVal })) continue;
          if (this.privateIds.has(String(fid))) continue;
          if (favVal && (typeof favVal === 'object' || !allFavs[fid])) allFavs[fid] = favVal;
        }
      };

      if (backupIsOurs) {
        if (Array.isArray(backup.history)) {
          for (const item of backup.history) {
            if (!item || !item.id || this.isRestricted(item)) continue;
            allHistories[String(item.id)] = item;
          }
        }
        addFavs(backup.favs);
      }

      // The profile's own entry wins unless the copy's is newer
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
      addFavs(current.favs);

      const mergedList = Object.values(allHistories).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      if (mergedList.length > 0) {
        current.history = mergedList.slice(0, 50);
        current.favs = allFavs;
        const next = JSON.stringify(current);
        if (next !== curRaw) saveItem(PROFILE_KEY, next, ls);
        if (next !== backupRaw) ls.setItem(BACKUP_KEY, next);
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

  private held = 0;
  private heldDirty = false;

  /**
   * Keeps the screens from redrawing on every save until the returned function is called. The player saves the
   * position every 15 seconds; each save made the whole app under it (rows, the title page) render again for
   * nothing the viewer can see. The data is saved as always; only the redraw waits, and happens once on release
   */
  public holdNotifications(): () => void {
    this.held++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held--;
      if (this.held === 0 && this.heldDirty) {
        this.heldDirty = false;
        this.notify();
      }
    };
  }

  private notify() {
    if (this.held > 0) {
      this.heldDirty = true;
      return;
    }
    this.listeners.forEach(cb => {
      try { cb(); } catch (e) {}
    });
  }
}

export const historyService = new HistoryService();
