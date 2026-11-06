import { VodItem } from '../types/vod';

export type PinMode = 'unlock' | 'create' | 'change' | 'disable';

export type BrowseRoot = 'featured' | 'movies' | 'series' | 'kids' | 'anime' | 'explorar';

export type Screen =
  | { id: 'home' }
  | { id: 'browse'; root: BrowseRoot; title: string; tag?: string; year?: string; items?: VodItem[]; category?: string; column?: string }
  | { id: 'profile'; section?: number }
  | { id: 'pin'; mode: PinMode; onSuccess?: () => void; onCancel?: () => void };

export type StackAction =
  | { type: 'push'; screen: Screen }
  | { type: 'pop' }
  | { type: 'replace'; screen: Screen };

export function stackReducer(state: Screen[], action: StackAction): Screen[] {
  switch (action.type) {
    case 'push':
      return [...state, action.screen];
    case 'pop':
      return state.length > 1 ? state.slice(0, -1) : state;
    case 'replace':
      return state.length > 1 ? [...state.slice(0, -1), action.screen] : state;
    default:
      return state;
  }
}
