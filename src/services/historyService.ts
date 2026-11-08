import { HistoryItem, EpisodePlaybackRecord } from '../types/history';
import { VodItem, VodEpisode } from '../types/vod';
import { isFinished } from '../lib/vodResume';
import { withoutHistory, withoutHistoryEntry } from '../lib/profileHistory';
import { pk } from '../lib/localProfiles';

const PROFILE_KEY = pk('xuper_local_profile_v1');

class HistoryService {
  private listeners: Array<() => void> = [];

  private getProfile(): any {
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
