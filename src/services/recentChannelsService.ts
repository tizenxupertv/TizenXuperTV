import type { LiveChannel } from '../types/channel.ts';
import { pk } from '../lib/localProfiles.ts';
import { isAdultLabel } from '../lib/catalogOrganizer.ts';
import { readStoredJson } from '../lib/storedJson.ts';
import { saveItem } from '../lib/safeStorage.ts';
import { isSameChannel } from '../lib/channelKey.ts';

const MAX_RECENTS = 20;

export class RecentChannelsService {
  private memoryCache: LiveChannel[] | null = null;
  private listeners: Array<() => void> = [];

  private storageKey(): string {
    return pk('xuper_recent_channels_v1');
  }

  public getRecentChannels(): LiveChannel[] {
    if (this.memoryCache) return this.memoryCache;
    const key = this.storageKey();
    const stored = readStoredJson<LiveChannel[]>(key);
    this.memoryCache = Array.isArray(stored) ? stored.filter(Boolean) : [];
    return this.memoryCache;
  }

  public addRecentChannel(channel: LiveChannel | null | undefined): void {
    if (!channel || (!channel.id && !channel.code)) return;
    // Do not record adult/restricted channels in history
    if (isAdultLabel(channel.name || '') || isAdultLabel(channel.categoryName || '')) return;

    const current = this.getRecentChannels().filter(c => c && !isSameChannel(c, channel));
    const updated = [channel, ...current].slice(0, MAX_RECENTS);
    this.memoryCache = updated;
    saveItem(this.storageKey(), JSON.stringify(updated));
    this.notify();
  }

  public getPreviousChannel(currentChannel?: Partial<LiveChannel> | string | number | null): LiveChannel | null {
    const list = this.getRecentChannels();
    if (!list.length) return null;
    if (!currentChannel) return list[0] || null;
    const isTarget = typeof currentChannel === 'object'
      ? (c: LiveChannel) => isSameChannel(c, currentChannel)
      : (c: LiveChannel) => String(c.id) === String(currentChannel) || String(c.code) === String(currentChannel);
    const found = list.find(c => c && !isTarget(c));
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
