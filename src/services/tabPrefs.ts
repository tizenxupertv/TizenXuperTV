import type { TabId } from '../components/layout/TopNavbar';

/** Tabs the user can hide in Perfil › Pestañas (the content stays reachable from Buscar and Explorar) */
export const HIDEABLE_TABS: Array<{ id: TabId; name: string }> = [
  { id: 'kids', name: 'Kids' },
  { id: 'anime', name: 'Anime' }
];

const KEY = 'xuper_hidden_tabs';

class TabPrefs {
  private listeners: Array<() => void> = [];

  hidden(): TabId[] {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(id => HIDEABLE_TABS.some(t => t.id === id)) : [];
    } catch (e) {
      return [];
    }
  }

  isHidden(id: TabId): boolean {
    return this.hidden().indexOf(id) >= 0;
  }

  setHidden(id: TabId, hide: boolean): void {
    const next = this.hidden().filter(t => t !== id);
    if (hide) next.push(id);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) {}
    this.listeners.forEach(cb => {
      try { cb(); } catch (e) {}
    });
  }

  subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }
}

export const tabPrefs = new TabPrefs();
