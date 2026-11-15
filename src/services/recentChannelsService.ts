import { LiveChannel } from '../types/channel';
import { pk } from '../lib/localProfiles';
import { isAdultLabel } from '../lib/catalogOrganizer';
import { readStoredJson } from '../lib/storedJson';
import { saveItem } from '../lib/safeStorage';

const MAX_RECENTS = 20;

class RecentChannelsService {
  private memoryCache: LiveChannel[] | null = null;
  private listeners: Array<() => void> = [];

  private storageKey(): string {
    return pk('xuper_recent_channels_v1');
  }

  public getRecentChannels(): LiveChannel[] {
    if (this.memoryCache) return this.memoryCache;
    const key = this.storageKey();
    const stored = readStoredJson<LiveChannel[]>(key);
    this.memoryCache = Array.isArray(stored) ? stored : [];
    return this.memoryCache;
  }

  public addRecentChannel(channel: LiveChannel | null | undefined): void {
    if (!channel || !channel.id) return;
    // Do not record adult/restricted channels in history
    if (isAdultLabel(channel.name || '') || isAdultLabel(channel.categoryName || '')) return;

    const current = this.getRecentChannels().filter(c => c && c.id !== channel.id && c.code !== channel.code);
    const updated = [channel, ...current].slice(0, MAX_RECENTS);
    this.memoryCache = updated;
    saveItem(this.storageKey(), JSON.stringify(updated));
    this.notify();
  }

  public getPreviousChannel(currentChannelId?: string | number): LiveChannel | null {
    const list = this.getRecentChannels();
    if (!list.length) return null;
    if (!currentChannelId) return list[0] || null;
    const found = list.find(c => c && c.id !== currentChannelId);
    return found || null;
  }

  public clearRecents(): void {
    this.memoryCache = [];
    saveItem(this.storageKey(), JSON.stringify([]));
    this.notify();
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  private notify(): void {
    for (const cb of this.listeners) {
      try { cb(); } catch (e) {}
    }
  }
}

export const recentChannelsService = new RecentChannelsService();
