import { useState, useEffect, useCallback, useRef } from 'react';
import { LiveTvFocus, DEFAULT_LIVE_CATEGORIES } from '../views/LiveTvView';
import { LiveChannel, LiveCategory } from '../types/channel';
import { KbState, KB_INITIAL } from '../components/live/OnScreenKeyboard';
import { DrawerArea, LiveLocation } from './types';
import { getChannelEntry } from '../lib/channelCache';
import { channelKey, cleanFavMap, isSameChannel, normalizeChannel, normalizeChannels } from '../lib/channelKey';
import { pk } from '../lib/localProfiles';

/** Live TV state: categories, channels, tuned channel, favorites and the fullscreen player/drawer */
export function useLiveTv() {
  // Focus & State within Live TV (Restores last viewed category & channel!)
  const [liveTvFocus, setLiveTvFocus] = useState<LiveTvFocus>(() => {
    try {
      const savedIdx = localStorage.getItem(pk('xuper_last_live_cat_idx'));
      const parsedIdx = savedIdx !== null ? parseInt(savedIdx, 10) : 4;
      const initialIdx = isNaN(parsedIdx) ? 4 : parsedIdx;
      return {
        area: 'channels',
        catIndex: initialIdx,
        selectedCatIndex: initialIdx,
        channelIndex: 0,
        btnIndex: 0
      };
    } catch {
      return {
        area: 'channels',
        catIndex: 4,
        selectedCatIndex: 4,
        channelIndex: 0,
        btnIndex: 0
      };
    }
  });
  const [liveCategories, setLiveCategories] = useState<LiveCategory[]>(DEFAULT_LIVE_CATEGORIES);
  const liveCategoriesRef = useRef<LiveCategory[]>(DEFAULT_LIVE_CATEGORIES);
  useEffect(() => {
    liveCategoriesRef.current = liveCategories;
  }, [liveCategories]);

  const [liveChannels, setLiveChannels] = useState<LiveChannel[]>([]);
  const liveChannelsRef = useRef<LiveChannel[]>([]);
  useEffect(() => {
    liveChannelsRef.current = liveChannels;
  }, [liveChannels]);

  const [tunedLiveChannel, setTunedLiveChannel] = useState<LiveChannel | null>(() => {
    try {
      const raw = localStorage.getItem(pk('xuper_last_live_ch'));
      return raw ? normalizeChannel<LiveChannel>(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  });

  const [catchupChannel, setCatchupChannel] = useState<LiveChannel | null>(null);
  // Remember the selected category too, so the next start opens the category of the last channel
  useEffect(() => {
    const idx = liveTvFocus.selectedCatIndex;
    if (idx === undefined) return;
    try { localStorage.setItem(pk('xuper_last_live_cat_idx'), String(idx)); } catch {}
  }, [liveTvFocus.selectedCatIndex]);

  // Remember the last tuned channel whatever changed it (list, fullscreen up/down, drawer, search)
  useEffect(() => {
    if (!tunedLiveChannel) return;
    try { localStorage.setItem(pk('xuper_last_live_ch'), JSON.stringify(tunedLiveChannel)); } catch {}
  }, [tunedLiveChannel]);

  const [liveFavMap, setLiveFavMap] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(pk('xuper_live_favs_v1'));
      return raw ? cleanFavMap(JSON.parse(raw)) : {};
    } catch {
      return {};
    }
  });

  // Fullscreen Live Player Mode
  const [isFullscreenLive, setIsFullscreenLive] = useState<boolean>(() => {
    return new URLSearchParams(window.location.search).get('fullscreen') === '1';
  });
  const [showFullscreenGuide, setShowFullscreenGuide] = useState<boolean>(() => {
    return new URLSearchParams(window.location.search).get('drawer') === '1';
  });
  const [fullscreenGuideIndex, setFullscreenGuideIndex] = useState<number>(0);
  // Fullscreen drawer is two columns: categories (left) and channels (right)
  const [fullscreenGuideArea, setFullscreenGuideArea] = useState<DrawerArea>('channels');
  const [fullscreenQuery, setFullscreenQuery] = useState<string>('');
  const [fullscreenKb, setFullscreenKb] = useState<KbState>(KB_INITIAL);
  const drawerResultsRef = useRef<LiveChannel[]>([]);
  const [fullscreenCatCursor, setFullscreenCatCursor] = useState<number>(0);
  const [fullscreenFocusBtn, setFullscreenFocusBtn] = useState<'none' | 'channels' | 'fav' | 'screen'>('none');
  // "Pantalla negra" in fullscreen (radio and music): a black layer over the picture, the sound goes on
  const [screenOff, setScreenOff] = useState(false);
  const [showFullscreenOsd, setShowFullscreenOsd] = useState<boolean>(true);
  const osdTimerRef = useRef<any>(null);

  const triggerOsd = useCallback(() => {
    setShowFullscreenOsd(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      setShowFullscreenOsd(false);
      setFullscreenFocusBtn('none');
    }, 4500);
  }, []);

  // When entering fullscreen, show OSD banner automatically for 4.5s
  useEffect(() => {
    if (isFullscreenLive) {
      triggerOsd();
      setFullscreenFocusBtn('none');
      setFullscreenGuideIndex(liveTvFocus.channelIndex);
    } else {
      setShowFullscreenGuide(false);
      setFullscreenFocusBtn('none');
      setScreenOff(false);
      if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    }
  }, [isFullscreenLive, triggerOsd, liveTvFocus.channelIndex]);

  // Toggle Live Favorite
  const toggleLiveFavorite = useCallback((channel: LiveChannel) => {
    const key = channelKey(channel);
    if (!key) return; // a channel without id/code/name cannot be a favorite
    setLiveFavMap(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(pk('xuper_live_favs_v1'), JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  }, []);

  // Finds the live category (index in liveCategories) and position that contain a channel,
  // so a search result or the remembered channel opens its own category with the channel selected.
  // `preferIndex` wins when it contains the channel; otherwise the first specific category does.
  const locateLiveChannel = useCallback((ch: LiveChannel, cats: LiveCategory[] = liveCategories, preferIndex?: number): LiveLocation | null => {
    const listFor = (catId: string | number): LiveChannel[] => {
      const entry = getChannelEntry(catId);
      if (entry && Array.isArray(entry.channels)) return normalizeChannels<LiveChannel>(entry.channels);
      return [];
    };
    const posIn = (i: number): number => {
      const cat = cats[i];
      if (!cat || cat.isFav || String(cat.id) === 'favs') return -1;
      return listFor(cat.id).findIndex(c => isSameChannel(c, ch));
    };

    if (preferIndex !== undefined) {
      const pos = posIn(preferIndex);
      if (pos !== -1) return { catIndex: preferIndex, channelIndex: pos };
    }
    let fallback: LiveLocation | null = null;
    for (let i = 0; i < cats.length; i++) {
      const pos = posIn(i);
      if (pos === -1) continue;
      // Prefer a specific category over an aggregate one ("Todos los canales")
      if (/todos/i.test(cats[i].name)) {
        if (!fallback) fallback = { catIndex: i, channelIndex: pos };
        continue;
      }
      return { catIndex: i, channelIndex: pos };
    }
    return fallback;
  }, [liveCategories]);

  // Physical keyboard / remote digits typed while the drawer search is active
  useEffect(() => {
    if (!(isFullscreenLive && showFullscreenGuide && fullscreenGuideArea === 'search')) return;
    const onType = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[A-Za-z0-9\u00C0-\u024F ._\-'&@+]$/.test(e.key)) {
        e.preventDefault();
        setFullscreenQuery(q => (q + e.key).slice(0, 30));
        setFullscreenGuideIndex(0);
      }
    };
    window.addEventListener('keydown', onType);
    return () => window.removeEventListener('keydown', onType);
  }, [isFullscreenLive, showFullscreenGuide, fullscreenGuideArea]);

  // Direct channel number tuning (remote 0-9 keys)
  const [numericBuffer, setNumericBuffer] = useState<string>('');
  const numericTimerRef = useRef<any>(null);

  const commitNumericTune = useCallback((targetStr?: string) => {
    const raw = (targetStr !== undefined ? targetStr : numericBuffer).trim();
    if (numericTimerRef.current) {
      clearTimeout(numericTimerRef.current);
      numericTimerRef.current = null;
    }
    setNumericBuffer('');
    if (!raw) return;

    const num = parseInt(raw, 10);
    if (isNaN(num) || num <= 0) return;

    const chs = liveChannelsRef.current;
    let foundIdx = chs.findIndex(c => String(c.code).trim() === raw || String(c.id).trim() === raw);
    if (foundIdx === -1 && num <= chs.length) {
      foundIdx = num - 1; // 1-based channel number
    }

    if (foundIdx !== -1 && chs[foundIdx]) {
      setLiveTvFocus(prev => ({ ...prev, channelIndex: foundIdx }));
      setTunedLiveChannel(chs[foundIdx]);
      try { localStorage.setItem(pk('xuper_last_live_ch'), JSON.stringify(chs[foundIdx])); } catch {}
      triggerOsd();
    }
  }, [numericBuffer, triggerOsd]);

  const pushNumericDigit = useCallback((digit: string) => {
    if (numericTimerRef.current) clearTimeout(numericTimerRef.current);
    setNumericBuffer(prev => {
      const next = (prev + digit).slice(-3);
      numericTimerRef.current = setTimeout(() => {
        commitNumericTune(next);
      }, 1300);
      return next;
    });
  }, [commitNumericTune]);

  const cancelNumericTune = useCallback(() => {
    if (numericTimerRef.current) {
      clearTimeout(numericTimerRef.current);
      numericTimerRef.current = null;
    }
    setNumericBuffer('');
  }, []);

  return {
    liveTvFocus,
    setLiveTvFocus,
    liveCategories,
    setLiveCategories,
    liveCategoriesRef,
    liveChannels,
    setLiveChannels,
    liveChannelsRef,
    tunedLiveChannel,
    setTunedLiveChannel,
    liveFavMap,
    isFullscreenLive,
    setIsFullscreenLive,
    showFullscreenGuide,
    setShowFullscreenGuide,
    fullscreenGuideIndex,
    setFullscreenGuideIndex,
    fullscreenGuideArea,
    setFullscreenGuideArea,
    fullscreenQuery,
    setFullscreenQuery,
    fullscreenKb,
    setFullscreenKb,
    drawerResultsRef,
    fullscreenCatCursor,
    setFullscreenCatCursor,
    fullscreenFocusBtn,
    setFullscreenFocusBtn,
    screenOff,
    setScreenOff,
    showFullscreenOsd,
    setShowFullscreenOsd,
    triggerOsd,
    toggleLiveFavorite,
    catchupChannel,
    setCatchupChannel,
    locateLiveChannel,
    numericBuffer,
    pushNumericDigit,
    commitNumericTune,
    cancelNumericTune
  };
}

export type LiveTvState = ReturnType<typeof useLiveTv>;
