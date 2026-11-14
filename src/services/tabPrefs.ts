import type { TabId } from '../components/layout/TopNavbar';
import { pk } from '../lib/localProfiles';

/** Tabs the user can show or hide in Perfil › Pestañas */
export const HIDEABLE_TABS: Array<{ id: TabId; name: string }> = [
  { id: 'deportes', name: 'Deportes' },
  { id: 'deportes-epic', name: 'EPIC+ (prueba)' },
  { id: 'kids', name: 'Kids' },
  { id: 'anime', name: 'Anime' }
];

/** Until the user chooses: Deportes shown, Kids and Anime hidden (their titles stay in Buscar and Explorar) */
const DEFAULT_HIDDEN: TabId[] = ['kids', 'anime'];

const KEY = pk('xuper_hidden_tabs');

class TabPrefs {
  private listeners: Array<() => void> = [];

  hidden(): TabId[] {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : DEFAULT_HIDDEN;
      return Array.isArray(list) ? list.filter(id => HIDEABLE_TABS.some(t => t.id === id)) : [];
    } catch (e) {
      return DEFAULT_HIDDEN.slice();
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
