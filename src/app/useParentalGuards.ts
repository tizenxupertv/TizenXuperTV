import { useCallback, MutableRefObject } from 'react';
import { TabId } from '../components/layout/TopNavbar';
import { LiveTvFocus, DEFAULT_LIVE_CATEGORIES } from '../views/LiveTvView';
import { LiveCategory } from '../types/channel';
import { PinMode, Screen } from '../lib/screenStack';
import { parentalService } from '../services/parentalService';

/** PIN checks before opening adult content (the adult live category; the +18 tab is handled in App) */
export function useParentalGuards(
  push: (screen: Screen) => void,
  liveCategoriesRef: MutableRefObject<LiveCategory[]>,
  liveTvFocus: LiveTvFocus
) {
  const requestPin = useCallback((mode: PinMode, onSuccess?: () => void, onCancel?: () => void) => {
    push({ id: 'pin', mode, onSuccess, onCancel });
  }, [push]);

  const isLiveCatLockedAt = useCallback((idx: number): boolean => {
    const cats = liveCategoriesRef.current.length ? liveCategoriesRef.current : DEFAULT_LIVE_CATEGORIES;
    const cat = cats[idx];
    return !!cat && !cat.isFav && parentalService.isAdultCategory(cat.name);
  }, []);

  const guardLiveCat = useCallback((idx: number, apply: () => void) => {
    if (isLiveCatLockedAt(idx)) requestPin('unlock', apply);
    else apply();
  }, [isLiveCatLockedAt, requestPin]);

  const guardTab = useCallback((tab: TabId, apply: () => void) => {
    const currentCat = liveTvFocus.selectedCatIndex ?? liveTvFocus.catIndex;
    const locked = tab === 'tv' && isLiveCatLockedAt(currentCat);
    if (locked) requestPin('unlock', apply);
    else apply();
  }, [liveTvFocus.selectedCatIndex, liveTvFocus.catIndex, isLiveCatLockedAt, requestPin]);

  return { requestPin, guardLiveCat, guardTab };
}
