import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { LiveChannel, LiveCategory } from '../types/channel';
import { playerService, LiveStatus } from '../services/playerService';
import { iptvService, IPTV_CATEGORY_PREFIX, IPTV_CATEGORY_LABEL } from '../services/iptvService';
import { parentalService } from '../services/parentalService';
import { useRenderCount } from '../debug/renderCount';
import { useViewProfiler } from '../lib/perfMonitor';
import { channelKey, isSameChannel, normalizeChannels, realText } from '../lib/channelKey';
import { ChannelRow, CategoryRow } from '../components/live/LiveRows';
import { OnScreenKeyboard, KbState, KB_INITIAL } from '../components/live/OnScreenKeyboard';
import { normalizeText } from '../utils/normalizeText';
import { getChannelEntry, setChannelEntry } from '../lib/channelCache';

declare global {
  interface Window {
    MagisClient?: any;
    XuperAVPlay?: any;
    webapis?: any;
  }
}

export const DEFAULT_LIVE_CATEGORIES: LiveCategory[] = [
  { id: 'favs', name: '★ Favoritos', isFav: true },
  { id: 76182, name: 'Todos los canales' },
  { id: 76206, name: 'Deportes en Vivo' },
  { id: 76205, name: 'Cine & Series 24/7' },
  { id: 76188, name: 'Colombia' },
  { id: 76191, name: 'España' },
  { id: 76197, name: 'México' },
  { id: 76190, name: 'Argentina' },
  { id: 76195, name: 'Chile & Perú' },
  { id: 76189, name: 'Venezuela' },
  { id: 76192, name: 'Ecuador' },
  { id: 76193, name: 'Bolivia' },
  { id: 76194, name: 'Uruguay' },
  { id: 76196, name: 'Paraguay' },
  { id: 76198, name: 'Panamá' },
  { id: 76199, name: 'Puerto Rico' },
  { id: 76200, name: 'Costa Rica' },
  { id: 76201, name: 'Estados Unidos' },
  { id: 76202, name: 'República Dominicana' },
  { id: 76203, name: 'Guatemala' },
  { id: 76204, name: 'Honduras' },
  { id: 76207, name: 'El Salvador' },
  { id: 76208, name: 'Nicaragua' },
  { id: 76209, name: 'Brasil' },
  { id: 76210, name: 'Infantiles' },
  { id: 76211, name: 'Noticias' },
  { id: 76212, name: 'Música' },
  { id: 76213, name: 'Documentales' },
  { id: 76214, name: 'Religiosos' },
  { id: 76215, name: 'Canales Premium' },
  { id: 76216, name: 'Variedades' },
  { id: 76217, name: 'Cultura y Ciencia' },
  { id: 76218, name: 'Anime 24/7' },
  { id: 76219, name: 'Retro TV' },
  { id: 76220, name: 'Series Retro' },
  { id: 76221, name: 'Cine Acción' },
  { id: 76222, name: 'Cine Comedia' },
  { id: 76223, name: 'Cine Terror' },
  { id: 76224, name: 'Eventos PPV' },
  { id: 'addons', name: '➕ Addons M3U', isM3u: true }
];

export interface LiveTvFocus {
  area: 'cats' | 'channels' | 'preview_btns';
  catIndex: number;
  selectedCatIndex?: number;
  channelIndex: number;
  btnIndex: number; // 0 = Fullscreen (inside the preview), 1 = Favorite (below the preview)
}

interface LiveTvViewProps {
  focus: LiveTvFocus;
  isActiveTab?: boolean;
  isFocusActive?: boolean;
  isFullscreen: boolean;
  tunedChannel: LiveChannel | null;
  favMap: Record<string, boolean>;
  showOsd?: boolean;
  showChannelsDrawer?: boolean;
  drawerFocusIndex?: number;
  drawerArea?: 'cats' | 'channels' | 'search' | 'searchbtn';
  drawerQuery?: string;
  drawerKb?: KbState;
  onDrawerResults?: (channels: LiveChannel[]) => void;
  drawerCatIndex?: number;
  fullscreenFocusBtn?: 'none' | 'channels' | 'fav';
  onTuneChannel: (channel: LiveChannel) => void;
  onEnterFullscreen: (channel: LiveChannel) => void;
  onExitFullscreen: () => void;
  onToggleFavorite: (channel: LiveChannel) => void;
  onToggleChannelsDrawer: () => void;
  onToggleOsd: () => void;
  onChannelsLoaded?: (channels: LiveChannel[]) => void;
  onCategoriesLoaded?: (categories: LiveCategory[]) => void;
  onSelectCategory?: (catIndex: number) => void;
  onOpenDrawerSearch?: () => void;
  numericBuffer?: string;
}

// Global in-memory cache for ultra-fast instant category switching
const categoryChannelsCache = new Map<string, LiveChannel[]>();

// True only for real schedules like "20:00 - 21:30"; labels such as "EN VIVO" are not times.
const hasClockTime = (t?: string): boolean => !!t && /\d/.test(t);


// Hides channels that belong to a PIN-locked category (so they cannot leak through
// "Favoritos" or aggregate categories such as "Todos los canales").
function filterLockedChannels(list: LiveChannel[], cats: LiveCategory[], activeId: string): LiveChannel[] {
  const lockedCats = cats.filter(c => !c.isFav && String(c.id) !== activeId && parentalService.isAdultCategory(c.name));
  if (lockedCats.length === 0) return list;
  const blocked = new Set<string>();
  lockedCats.forEach(c => {
    (categoryChannelsCache.get(String(c.id)) || []).forEach(ch => {
      blocked.add(String(ch.id));
      if (ch.code) blocked.add(String(ch.code));
    });
  });
  if (blocked.size === 0) return list;
  return list.filter(ch => !blocked.has(String(ch.id)) && !(ch.code && blocked.has(String(ch.code))));
}
const globalChannelMasterCache: Record<string, LiveChannel> = {};

/** Categories plus one per enabled free IPTV list, at the end (existing indexes do not move) */
function withIptvCategories(cats: LiveCategory[]): LiveCategory[] {
  const base = cats.filter(c => !c.iptvListId);
  return base.concat(iptvService.enabledLists().map(l => ({
    id: IPTV_CATEGORY_PREFIX + l.id,
    name: IPTV_CATEGORY_LABEL + l.name,
    iptvListId: l.id
  })));
}

// Long lists (free IPTV: up to ~2400 channels) only keep the rows around the cursor in the DOM.
// Row pitch = row height + list gap (.live-channel-card 65px, .pc-row 84px, gap 8px).
const CHANNEL_PITCH = 73;
const DRAWER_PITCH = 92;
const LIST_GAP = 8;
const WINDOW_FROM = 80;
const WINDOW_BEFORE = 20;
const WINDOW_AFTER = 30;
function listWindow(total: number, cursor: number): [number, number] {
  if (total <= WINDOW_FROM) return [0, total];
  const start = Math.max(0, Math.min(cursor - WINDOW_BEFORE, total - WINDOW_BEFORE - WINDOW_AFTER));
  return [start, Math.min(total, start + WINDOW_BEFORE + WINDOW_AFTER)];
}
/** Empty block standing for `rows` rows that are not rendered */
function rowsSpacer(rows: number, pitch: number) {
  return rows > 0 ? <div className="live-list-spacer" style={{ height: rows * pitch - LIST_GAP }} /> : null;
}

// Fast, zero-reflow nearest scroll for TV list containers: replaces scrollIntoView / offsetTop reflows
function fastScrollList(container: HTMLElement, targetIndex: number, itemPitch: number, pad = 12) {
  const targetTop = targetIndex * itemPitch;
  const cTop = container.scrollTop;
  const cHeight = container.clientHeight || 700;
  if (targetTop < cTop + pad) {
    container.scrollTop = Math.max(0, targetTop - pad);
  } else if (targetTop + itemPitch > cTop + cHeight - pad) {
    container.scrollTop = targetTop + itemPitch - cHeight + pad;
  }
}

const LiveTvViewInner: React.FC<LiveTvViewProps> = ({
  focus,
  isActiveTab = true,
  isFocusActive = true,
  isFullscreen,
  tunedChannel,
  favMap,
  showOsd = false,
  showChannelsDrawer = false,
  drawerFocusIndex = 0,
  drawerArea = 'channels',
  drawerQuery = '',
  drawerKb = KB_INITIAL,
  onDrawerResults,
  drawerCatIndex = 0,
  fullscreenFocusBtn = 'none',
  onTuneChannel,
  onEnterFullscreen,
  onExitFullscreen,
  onToggleFavorite,
  onToggleChannelsDrawer,
  onToggleOsd,
  onChannelsLoaded,
  onCategoriesLoaded,
  onSelectCategory,
  onOpenDrawerSearch,
  numericBuffer
}) => {
  useRenderCount('LiveTvView');
  useViewProfiler('TV en Vivo');
  const [streamQuality, setStreamQuality] = useState<string>('FHD 1080p');

  // Query AVPlay hardware stream quality when OSD is visible
  useEffect(() => {
    if (isFullscreen && showOsd && (window as any).XuperAVPlay && (window as any).XuperAVPlay.getCurrentStreamQuality) {
      try {
        const q = (window as any).XuperAVPlay.getCurrentStreamQuality();
        if (q && q.label) setStreamQuality(q.label);
      } catch (e) {}
    }
  }, [isFullscreen, showOsd, tunedChannel]);
  const savedCatIdx = useMemo(() => {
    try {
      const v = localStorage.getItem('xuper_last_live_cat_idx');
      if (v !== null) {
        const parsed = parseInt(v, 10);
        if (!isNaN(parsed)) return parsed;
      }
    } catch {}
    return 4;
  }, []);
  const selectedCatIndex = focus.selectedCatIndex !== undefined ? focus.selectedCatIndex : savedCatIdx;
  const [categories, setCategories] = useState<LiveCategory[]>(() => withIptvCategories(DEFAULT_LIVE_CATEGORIES));
  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState<boolean>(true);
  // A free IPTV list that could not be downloaded
  const [channelsError, setChannelsError] = useState<string>('');
  // Signal of the playing channel: a channel that does not answer shows a message, not a black box
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(() => playerService.getLiveStatus());
  useEffect(() => playerService.onLiveStatus(setLiveStatus), []);
  const [lockTick, setLockTick] = useState<number>(0);

  // Re-filter channel lists when the parental settings or the session lock change
  useEffect(() => parentalService.subscribe(() => setLockTick(t => t + 1)), []);
  const [liveClock, setLiveClock] = useState<string>('20:00');

  const catListRef = useRef<HTMLDivElement>(null);
  const channelListRef = useRef<HTMLDivElement>(null);
  const drawerListRef = useRef<HTMLDivElement>(null);
  const drawerCatsRef = useRef<HTMLDivElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  // The hardware player draws the preview in a fixed screen rectangle: when the box changes size or place (the
  // columns settle, fonts load, fullscreen and back), that rectangle follows it
  useEffect(() => {
    const box = previewBoxRef.current;
    const av = (window as any).XuperAVPlay;
    if (!box || !av || typeof (window as any).ResizeObserver !== 'function') return;
    let frame = 0;
    const ro = new (window as any).ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (av.isPreviewActive) av.syncDisplayRect(); });
    });
    ro.observe(box);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, []);
  const channelMasterCache = useRef<Record<string, LiveChannel>>(globalChannelMasterCache);

  // Live Clock updater for InfoBar OSD
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      const hrs = d.getHours();
      const mins = d.getMinutes().toString().padStart(2, '0');
      const ampm = hrs >= 12 ? 'PM' : 'AM';
      const h12 = hrs % 12 || 12;
      setLiveClock(`${h12}:${mins} ${ampm}`);
    };
    updateTime();
    const timer = setInterval(updateTime, 15000);
    return () => clearInterval(timer);
  }, []);

  // Fast direct scrolling without animation lag - zero-reflow fastScrollList
  useEffect(() => {
    if (!isFullscreen && isFocusActive && focus.area === 'cats' && catListRef.current) {
      const container = catListRef.current;
      if (focus.catIndex === 0) {
        container.scrollTop = 0;
        return;
      }
      if (focus.catIndex === categories.length - 1) {
        container.scrollTop = container.scrollHeight;
        return;
      }
      fastScrollList(container, focus.catIndex, 48, 12);
    }
  }, [isFullscreen, isFocusActive, focus.area, focus.catIndex, categories.length]);

  useEffect(() => {
    if (!isFullscreen && isFocusActive && focus.area === 'channels' && channelListRef.current) {
      const container = channelListRef.current;
      if (focus.channelIndex === 0) {
        container.scrollTop = 0;
        return;
      }
      if (focus.channelIndex === channels.length - 1) {
        container.scrollTop = container.scrollHeight;
        return;
      }
      fastScrollList(container, focus.channelIndex, CHANNEL_PITCH, 16);
    }
  }, [isFullscreen, isFocusActive, focus.area, focus.channelIndex, channels.length]);

  useEffect(() => {
    if (isFullscreen && showChannelsDrawer && drawerListRef.current) {
      const container = drawerListRef.current;
      if (drawerFocusIndex === 0) {
        container.scrollTop = 0;
        return;
      }
      if (drawerFocusIndex === channels.length - 1) {
        container.scrollTop = container.scrollHeight;
        return;
      }
      fastScrollList(container, drawerFocusIndex, DRAWER_PITCH, 16);
    }
  }, [isFullscreen, showChannelsDrawer, drawerFocusIndex, channels.length]);

  // Keep the category cursor of the fullscreen drawer visible
  useEffect(() => {
    if (!isFullscreen || !showChannelsDrawer || !drawerCatsRef.current) return;
    if (drawerCatIndex === 0) {
      drawerCatsRef.current.scrollTop = 0;
      return;
    }
    fastScrollList(drawerCatsRef.current, drawerCatIndex, 52, 12);
  }, [isFullscreen, showChannelsDrawer, drawerCatIndex, drawerArea]);

  // Drawer search: looks through every channel already loaded (all categories)
  const drawerResults = useMemo(() => {
    const q = normalizeText(drawerQuery.trim());
    if (!q) return [] as LiveChannel[];
    const seen = new Set<string>();
    const found: LiveChannel[] = [];
    const pool = [...channels, ...Object.values(channelMasterCache.current)];
    for (const ch of pool) {
      const key = String(ch.id || ch.code);
      if (seen.has(key)) continue;
      if (normalizeText(ch.name).includes(q) || normalizeText(ch.code).includes(q)) {
        seen.add(key);
        found.push(ch);
      }
    }
    return filterLockedChannels(found, categories, '').slice(0, 60);
  }, [drawerQuery, channels, categories, lockTick]);

  useEffect(() => {
    if (onDrawerResults) onDrawerResults(drawerResults);
  }, [drawerResults]);

  const drawerSearching = drawerQuery.trim().length > 0;
  const drawerChannels = drawerSearching ? drawerResults : channels;


  // Load Categories on mount (and when the +18 section or a free IPTV list is turned on/off) and notify parent
  const [adultTick, setAdultTick] = useState(0);
  useEffect(() => parentalService.subscribe(() => setAdultTick(t => t + 1)), []);
  useEffect(() => iptvService.subscribe(() => setAdultTick(t => t + 1)), []);
  useEffect(() => {
    if (window.MagisClient && typeof window.MagisClient.getLiveCategories === 'function') {
      window.MagisClient.getLiveCategories((err: any, cats: any[]) => {
        if (!err && Array.isArray(cats) && cats.length) {
          const adultOn = parentalService.isAdultEnabled();
          const formatted: LiveCategory[] = cats
            .map(c => ({ id: c.id || c.columnId, name: c.name || c.title }))
            // The adult category ("18+") exists only while the +18 section is on
            .filter(c => adultOn || !parentalService.isAdultCategory(c.name));
          const allCats = withIptvCategories([{ id: 'favs', name: '★ Favoritos', isFav: true }, ...formatted]);
          setCategories(allCats);
          if (onCategoriesLoaded) onCategoriesLoaded(allCats);
        } else {
          const fallback = withIptvCategories(DEFAULT_LIVE_CATEGORIES);
          setCategories(fallback);
          if (onCategoriesLoaded) onCategoriesLoaded(fallback);
        }
      });
    } else {
      const fallback = withIptvCategories(DEFAULT_LIVE_CATEGORIES);
      setCategories(fallback);
      if (onCategoriesLoaded) onCategoriesLoaded(fallback);
    }
  }, [adultTick]);

  const activeCategory = categories[selectedCatIndex] || categories[0];
  // The tuned channel keeps the name of the category it was picked from (for the problem report)
  const tune = useCallback(
    (ch: LiveChannel) => onTuneChannel(ch.categoryName || !activeCategory ? ch : { ...ch, categoryName: activeCategory.name }),
    [onTuneChannel, activeCategory]
  );

  // Background Preloader: prefetch and cache channels & logos for ALL categories
  useEffect(() => {
    if (!categories || categories.length <= 1) return;
    if (!window.MagisClient || typeof window.MagisClient.getLiveChannels !== 'function') return;

    let isCancelled = false;
    let idx = 0;

    const prefetchStep = () => {
      if (isCancelled) return;
      if (idx >= categories.length) {
        // all categories cached: re-apply the parental filter to aggregate lists
        setLockTick(t => t + 1);
        return;
      }
      const cat = categories[idx++];

      if (!cat || cat.id === 'favs') {
        setTimeout(prefetchStep, 40);
        return;
      }

      // Free IPTV list: only its saved copy (for Favoritos); the download waits until it is opened
      if (cat.iptvListId) {
        iptvService.getSaved(cat.iptvListId).then(list => {
          if (list && !isCancelled) list.forEach(c => { channelMasterCache.current[String(c.id)] = c; });
        }, () => {}).then(() => setTimeout(prefetchStep, 40));
        return;
      }

      const catKey = String(cat.id);

      // Check if already in memory cache
      if (categoryChannelsCache.has(catKey)) {
        setTimeout(prefetchStep, 40);
        return;
      }

      // Check the saved list
      try {
        const parsed = getChannelEntry(catKey);
        if (parsed) {
          if (Array.isArray(parsed.channels) && parsed.channels.length) {
            const cachedList = normalizeChannels<LiveChannel>(parsed.channels);
            categoryChannelsCache.set(catKey, cachedList);
            cachedList.forEach((c: LiveChannel) => {
              channelMasterCache.current[String(c.id || c.code)] = c;
            });
            setTimeout(prefetchStep, 40);
            return;
          }
        }
      } catch (e) {}

      // Fetch from API in background
      window.MagisClient.getLiveChannels(catKey, 1, 50, (err: any, list: any[]) => {
        if (isCancelled) return;
        if (!err && Array.isArray(list) && list.length) {
          const chs: LiveChannel[] = list.map((c, i) => ({
            id: c.channelCode || c.id || i,
            name: c.name || c.channelName || 'Canal',
            code: c.channelCode || String(c.id || ''),
            url: c.streamUrl || '',
            logo: c.logo || c.channelLogo || '',
            now: realText(c.now || c.currentProgram),
            next: realText(c.next || c.nextProgram),
            time: c.time || 'EN VIVO',
            isFav: !!favMap[channelKey(c)]
          }));

          chs.forEach(c => {
            channelMasterCache.current[String(c.id || c.code)] = c;
            // Preload logo image in browser cache
            if (c.logo) {
              const img = new Image();
              img.src = c.logo;
            }
          });

          categoryChannelsCache.set(catKey, chs);

          setChannelEntry(catKey, chs);
        }
        setTimeout(prefetchStep, 400);
      });
    };

    // Wait until the first screens are interactive before downloading every category
    const startTimer = setTimeout(prefetchStep, 5000);
    return () => {
      isCancelled = true;
      clearTimeout(startTimer);
    };
  }, [categories, favMap]);

  // Fetch Channels when active category changes (0ms instant if cached in memory!)
  useEffect(() => {
    if (!activeCategory) return;
    const catId = String(activeCategory.id);

    if (activeCategory.isFav) {
      const allKnown = Object.values(channelMasterCache.current);
      const favChannels = filterLockedChannels(allKnown.filter(c => favMap[channelKey(c)]), categories, catId);
      setChannels(favChannels);
      setIsLoadingChannels(false);
      if (onChannelsLoaded) onChannelsLoaded(favChannels);
      return;
    }

    // Free IPTV list: memory, saved copy or download (once), see iptvService
    if (activeCategory.iptvListId) {
      const listId = activeCategory.iptvListId;
      const show = (list: LiveChannel[]) => {
        list.forEach(c => { channelMasterCache.current[String(c.id)] = c; });
        setChannels(list);
        setChannelsError('');
        setIsLoadingChannels(false);
        if (onChannelsLoaded) onChannelsLoaded(list);
      };
      const ready = iptvService.peek(listId);
      if (ready) {
        show(ready);
        return;
      }
      let alive = true;
      setChannels([]);
      setChannelsError('');
      setIsLoadingChannels(true);
      if (onChannelsLoaded) onChannelsLoaded([]);
      iptvService.getChannels(listId).then(
        list => { if (alive) show(list); },
        () => {
          if (!alive) return;
          setChannelsError('No se pudo descargar esta lista. Revisa la conexión e inténtalo más tarde.');
          setIsLoadingChannels(false);
        }
      );
      return () => { alive = false; };
    }

    // 1. In-memory cache: 0ms instant display!
    if (categoryChannelsCache.has(catId)) {
      const cached = filterLockedChannels(categoryChannelsCache.get(catId)!, categories, catId);
      setChannels(cached);
      setIsLoadingChannels(false);
      if (onChannelsLoaded) onChannelsLoaded(cached);
      return;
    }

    // 2. Saved list (memory, loaded from IndexedDB at start): 0ms instant display!
    try {
      const parsed = getChannelEntry(catId);
      if (parsed) {
        if (Array.isArray(parsed.channels) && parsed.channels.length) {
          const cachedList = normalizeChannels<LiveChannel>(parsed.channels);
          categoryChannelsCache.set(catId, cachedList);
          const visible = filterLockedChannels(cachedList, categories, catId);
          setChannels(visible);
          cachedList.forEach((c: LiveChannel) => {
            channelMasterCache.current[String(c.id || c.code)] = c;
          });
          setIsLoadingChannels(false);
          if (onChannelsLoaded) onChannelsLoaded(visible);
          return;
        }
      }
    } catch (e) {}

    // 3. Fallback to API if not cached yet
    setIsLoadingChannels(true);
    if (window.MagisClient && typeof window.MagisClient.getLiveChannels === 'function') {
      window.MagisClient.getLiveChannels(catId, 1, 50, (err: any, list: any[]) => {
        if (!err && Array.isArray(list) && list.length) {
          const chs: LiveChannel[] = list.map((c, idx) => ({
            id: c.channelCode || c.id || idx,
            name: c.name || c.channelName || 'Canal',
            code: c.channelCode || String(c.id || ''),
            url: c.streamUrl || '',
            logo: c.logo || c.channelLogo || '',
            now: realText(c.now || c.currentProgram),
            next: realText(c.next || c.nextProgram),
            time: c.time || 'EN VIVO',
            isFav: !!favMap[channelKey(c)]
          }));
          chs.forEach(c => {
            channelMasterCache.current[String(c.id || c.code)] = c;
          });
          categoryChannelsCache.set(catId, chs);
          const visible = filterLockedChannels(chs, categories, catId);
          setChannels(visible);
          setChannelEntry(catId, chs);
          if (onChannelsLoaded) onChannelsLoaded(visible);
        } else {
          // No channels from the portal: an empty list (never made-up channels)
          setChannels([]);
          if (onChannelsLoaded) onChannelsLoaded([]);
        }
        setIsLoadingChannels(false);
      });
    } else {
      setChannels([]);
      if (onChannelsLoaded) onChannelsLoaded([]);
      setIsLoadingChannels(false);
    }
  }, [activeCategory, favMap, categories, lockTick]);

  // When channels load and nothing is tuned yet (first run), tune the saved channel or the first one.
  // A channel that is already tuned keeps playing even if it belongs to another category:
  // auto-tuning here used to replace the last watched channel on every start.
  useEffect(() => {
    if (channels.length === 0 || tunedChannel) return;
    let saved: LiveChannel | null = null;
    try {
      const raw = localStorage.getItem('xuper_last_live_ch');
      if (raw) saved = JSON.parse(raw);
      // Older versions saved filler texts as the programme: they are not data
      if (saved) { saved.now = realText(saved.now); saved.next = realText(saved.next); }
    } catch {}
    const foundInCat = saved ? channels.find(c => isSameChannel(c, saved)) : undefined;
    tune(foundInCat || channels[0]);
  }, [channels]);

  // ZERO-FLICKER: Stream playback depends ONLY on tunedChannel!
  // Navigating up/down in the channel list does NOT interrupt or restart the stream!
  useEffect(() => {
    if (isActiveTab && tunedChannel && previewVideoRef.current) {
      // The category goes into the problem report (portal channels do not carry its name)
      const category = tunedChannel.categoryName || (categories.find(c => String(c.id) === String(tunedChannel.colId)) || { name: '' }).name;
      playerService.playLivePreview(category && !tunedChannel.categoryName ? { ...tunedChannel, categoryName: category } : tunedChannel, previewVideoRef.current);
    } else if (!isActiveTab) {
      playerService.stop();
    }
  }, [isActiveTab, tunedChannel]);

  // ZERO-FLICKER: Toggle AVPlay fullscreen / preview display rectangle dynamically!
  useEffect(() => {
    playerService.setFullscreen(isFullscreen);
  }, [isFullscreen]);

  // Stop playback only when unmounting the whole Live TV view (e.g. closing app)
  useEffect(() => {
    return () => {
      playerService.stop();
    };
  }, []);

  // Dynamic Live Progress percentage based on the current hour (e.g., 20:15 -> 25%)

  // Which channel is currently under cursor vs which channel is tuned/playing
  const focusedChannel = channels[focus.channelIndex] || tunedChannel || channels[0] || null;
  // The info panel always describes the channel that is playing in the preview
  const displayChannel = tunedChannel || focusedChannel;
  // Progress of the current programme from its "HH:MM - HH:MM" times; null when the channel does not send them
  const programProgress = useMemo(() => {
    const t = displayChannel && displayChannel.time;
    const m = t && t.match(/(\d{1,2}):(\d{2})\s*(am|pm)?\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (!m) return null;
    const mins = (h: string, mm: string, ap?: string) => {
      let hh = Number(h) % 24;
      if (ap) hh = (Number(h) % 12) + (/pm/i.test(ap) ? 12 : 0);
      return hh * 60 + Number(mm);
    };
    const start = mins(m[1], m[2], m[3]);
    let end = mins(m[4], m[5], m[6]);
    if (end <= start) end += 24 * 60;
    const d = new Date();
    let now = d.getHours() * 60 + d.getMinutes();
    if (now < start) now += 24 * 60;
    return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayChannel && displayChannel.time, liveClock]);
  const isFocusedChannelTuned = isSameChannel(tunedChannel, focusedChannel);
  const isDisplayChannelTuned = isSameChannel(tunedChannel, displayChannel);
  const isDisplayChannelFav = !!(displayChannel && favMap[channelKey(displayChannel)]);
  const tunedIsDown = !!tunedChannel && liveStatus.state === 'error' && liveStatus.code === String(tunedChannel.code || tunedChannel.id);
  const [chFrom, chTo] = listWindow(channels.length, focus.channelIndex);

  return (
    <div className={`live-tv-view-2col ${isFullscreen ? 'is-fullscreen' : ''}`}>
      {/* =========================================================
          COLUMNA 1: Categorías Verticales (260px)
          ========================================================= */}
      <aside className="live-col-categories">
        <div className="live-col-header">
          <span className="live-header-title">CATEGORÍAS</span>
          <span className="live-header-count">{categories.length}</span>
        </div>

        <div className="live-cat-vlist" ref={catListRef}>
          {categories.map((cat, idx) => (
            <CategoryRow
              key={cat.id || idx}
              cat={cat}
              idx={idx}
              active={selectedCatIndex === idx}
              cursor={isFocusActive && focus.area === 'cats' && focus.catIndex === idx}
              onSelect={onSelectCategory}
            />
          ))}
        </div>
      </aside>

      {/* =========================================================
          COLUMNA 2: Lista de Canales (460px)
          ========================================================= */}
      <section className="live-col-channels">
        <div className="live-col-header">
          <span className="live-header-title">{activeCategory.name.toUpperCase()}</span>
          <span className="live-header-count">{channels.length} canales</span>
        </div>

        <div className="live-channel-vlist" ref={channelListRef}>
          {channels.length === 0 && isLoadingChannels ? (
            <div className="live-loading-msg">{activeCategory.iptvListId ? 'Descargando la lista de canales...' : 'Cargando canales...'}</div>
          ) : channels.length === 0 ? (
            <div className="live-empty-msg">
              {activeCategory.isFav
                ? 'Aún no tienes canales en ★ Favoritos.\nSintoniza un canal y presiona Añadir a Favoritos.'
                : activeCategory.iptvListId && channelsError
                  ? channelsError
                  : 'No hay canales disponibles en esta categoría'}
            </div>
          ) : (
            <>
              {rowsSpacer(chFrom, CHANNEL_PITCH)}
              {channels.slice(chFrom, chTo).map((ch, i) => {
                const idx = chFrom + i;
                return (
                  <ChannelRow
                    key={ch.id || idx}
                    ch={ch}
                    idx={idx}
                    focused={isFocusActive && focus.area === 'channels' && focus.channelIndex === idx}
                    tuned={isSameChannel(tunedChannel, ch)}
                    fav={!!favMap[channelKey(ch)]}
                    onTune={tune}
                    onFullscreen={onEnterFullscreen}
                  />
                );
              })}
              {rowsSpacer(channels.length - chTo, CHANNEL_PITCH)}
            </>
          )}
        </div>
      </section>

      {/* =========================================================
          ZONA 3: Gran Preview 16:9 + Zero-Flicker Fullscreen Player Surface
          ========================================================= */}
      <main className="live-col-preview">
        {/* Persistent Single Video Box (Seamless 16:9 Preview <-> Fullscreen) */}
        <div
          ref={previewBoxRef}
          className={`live-grand-preview-box ${isFullscreen ? 'is-fullscreen' : ''} ${
            !isFullscreen && isFocusActive && focus.area === 'preview_btns' && focus.btnIndex === 0 ? 'is-focused' : ''
          }`}
          onClick={() => {
            if (!isFullscreen && (tunedChannel || displayChannel)) {
              onEnterFullscreen(tunedChannel || displayChannel);
            }
          }}
          style={{ cursor: isFullscreen ? 'default' : 'pointer' }}
          title={!isFullscreen ? 'Clic para expandir a pantalla completa' : undefined}
        >
          <video
            ref={previewVideoRef}
            id="live-preview-video"
            className="live-preview-video"
            playsInline
            autoPlay
          />
          <div className="live-preview-overlay" />

          {/* The tuned channel does not answer: say so instead of a black box */}
          {tunedIsDown && (
            liveStatus.reason === 'isp' ? (
              <div className="live-signal-error">
                <div className="live-signal-error-title">Tu proveedor de internet bloquea este canal</div>
                <div className="live-signal-error-desc">
                  Cambia el DNS de la TV a 1.1.1.1: Configuración › General › Red › Estado de la red › Configuración de IP ›
                  Configuración de DNS › Introducir manualmente. Si sigue igual, prueba con otra red.
                </div>
              </div>
            ) : (
              <div className="live-signal-error">
                <div className="live-signal-error-title">Señal no disponible</div>
                <div className="live-signal-error-desc">Este canal no responde en este momento. Prueba con otro canal.</div>
              </div>
            )
          )}
          
          <div className="live-preview-top-tags">
            <span className="live-stream-badge">
              <span className="live-pulse-dot" /> EN VIVO
            </span>
            <span className="live-quality-tag">FHD 1080p</span>
            {tunedChannel && (
              <span className="live-quality-tag" style={{ background: 'rgba(0, 229, 255, 0.25)', borderColor: '#00e5ff' }}>
                {tunedChannel.name}
              </span>
            )}
          </div>

          {!isFullscreen && (
            <div
              className="live-preview-expand-hint"
              title="Pantalla completa"
              aria-label="Pantalla completa"
              onClick={() => { if (displayChannel) onEnterFullscreen(displayChannel); }}
            >
              <span className="live-expand-icon">⛶</span>
            </div>
          )}

          {/* Direct Channel Number Tuning Floating Overlay */}
          {numericBuffer && (
            <div className="osd-numeric-banner">
              <span className="osd-numeric-label">CANAL</span>
              <span className="osd-numeric-digits">{numericBuffer}</span>
            </div>
          )}

          {/* =========================================================
              FULLSCREEN: Authentic InfoBar OSD (Vanilla Layout)
              ========================================================= */}
          {isFullscreen && displayChannel && (
            <div className={`player-infobar ${showOsd && !showChannelsDrawer ? 'is-active' : ''}`}>
              {displayChannel.logo ? (
                <img
                  className="pi-logo"
                  src={displayChannel.logo}
                  alt=""
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                    const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                    if (fallback) fallback.style.display = 'flex';
                  }}
                />
              ) : null}
              <div className="pi-avatar" style={{ display: displayChannel.logo ? 'none' : 'flex' }}>
                {String(displayChannel.name || 'TV').trim().slice(0, 2).toUpperCase()}
              </div>

              <div className="pi-namerow">
                <span className="pi-name">{displayChannel.name}</span>
                <span className="pi-quality-badge">{streamQuality || 'FHD 1080p'}</span>
              </div>

              <div className="pi-btn-group">
                <button
                  className={`pi-action-btn ${fullscreenFocusBtn === 'channels' ? 'is-focused' : ''}`}
                  onClick={onToggleChannelsDrawer}
                >
                  ☰ Lista de canales
                </button>
                <button
                  className={`pi-action-btn pi-icon-only fav-btn ${isDisplayChannelFav ? 'is-fav' : ''} ${fullscreenFocusBtn === 'fav' ? 'is-focused' : ''}`}
                  title={isDisplayChannelFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                  aria-label={isDisplayChannelFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                  onClick={() => onToggleFavorite(displayChannel)}
                >
                  {isDisplayChannelFav ? '★' : '☆'}
                </button>
              </div>

              <div className="pi-date">{liveClock}</div>
              <div className="pi-div-line" />
              <div className="pi-now">
                {displayChannel.now && !/^en vivo$/i.test(displayChannel.now.trim()) ? displayChannel.now : ''}
              </div>
              {displayChannel.next && <div className="pi-next">{`Siguiente: ${displayChannel.next}`}</div>}
              <div className="pi-range">{displayChannel.time || 'EN VIVO'}</div>

              <div className="pi-seek">
                <div className="bar" />
              </div>

              <div className="pi-hint-row">
                <div>
                  <span className="hint-badge">▲ / ▼</span> Canal
                  <span className="hint-badge" style={{ marginLeft: 16 }}>◄ / ►</span> Lista de canales
                  <span className="hint-badge" style={{ marginLeft: 16 }}>OK</span> OSD Info
                </div>
                <div>
                  <span className="hint-badge">BACK</span> Salir de pantalla completa
                </div>
              </div>
            </div>
          )}

          {/* =========================================================
              FULLSCREEN: Authentic Floating Channel Drawer (Vanilla Layout)
              ========================================================= */}
          {isFullscreen && (
            <div className={`player-channels ${showChannelsDrawer ? 'is-active' : ''}`}>
              <div className="pc-head">
                <div>
                  <div className="pc-title">{drawerSearching ? `BÚSQUEDA: "${drawerQuery.trim().toUpperCase()}"` : activeCategory.name.toUpperCase()}</div>
                  <div className="pc-counter">{drawerChannels.length} canales</div>
                </div>
                {drawerArea !== 'search' && !drawerSearching && (
                  <div
                    className={`pc-search-btn ${drawerArea === 'searchbtn' ? 'is-focused' : ''}`}
                    title="Buscar canal"
                    aria-label="Buscar canal"
                    onClick={() => onOpenDrawerSearch && onOpenDrawerSearch()}
                  >
                    ⌕
                  </div>
                )}
              </div>
              <div className="pc-div" />

              <div className="pc-body">
              {drawerArea === 'search' ? (
                <div className="pc-cats pc-keyboard-col">
                  <div className={`pc-search ${drawerArea === 'search' ? 'is-focused' : ''}`}>
                    <span className="pc-search-icon">⌕</span>
                    <div className={`pc-search-text ${drawerQuery ? '' : 'is-empty'}`}>
                      {drawerQuery ? (
                        <>
                          <span className="search-typed-text">{drawerQuery}</span>
                          {drawerArea === 'search' && <span className="pc-search-caret" />}
                        </>
                      ) : (
                        <>
                          {drawerArea === 'search' && <span className="pc-search-caret search-caret-start" />}
                          <span className="search-placeholder-text">Buscar canal...</span>
                        </>
                      )}
                    </div>
                  </div>
                  <OnScreenKeyboard state={drawerKb} focused okLabel="Buscar" />
                </div>
              ) : (
              <div className={`pc-cats ${drawerArea === 'cats' ? 'is-active-col' : ''}`} ref={drawerCatsRef}>
                {categories.map((cat, idx) => (
                  <div
                    key={String(cat.id) + idx}
                    className={`pc-cat ${idx === selectedCatIndex ? 'is-current' : ''} ${
                      drawerArea === 'cats' && idx === drawerCatIndex ? 'is-focused' : ''
                    }`}
                  >
                    <span className="pc-cat-name">{cat.name}</span>
                    {!cat.isFav && parentalService.isAdultCategory(cat.name) && <span className="pc-cat-lock">🔒</span>}
                  </div>
                ))}
              </div>
              )}

              <div className="pc-list" ref={drawerListRef}>
                {drawerChannels.length === 0 ? (
                  <div className="pc-empty-msg">
                    {drawerSearching ? `Sin resultados para "${drawerQuery.trim()}"` : activeCategory.isFav
                      ? 'Aún no tienes canales en ★ Favoritos.\nEn el reproductor usa el botón ☆ Favorito para guardarlos.'
                      : 'No hay canales disponibles en esta categoría'}
                  </div>
                ) : (
                  (() => {
                  const [dFrom, dTo] = listWindow(drawerChannels.length, drawerFocusIndex);
                  return (
                  <>
                  {rowsSpacer(dFrom, DRAWER_PITCH)}
                  {drawerChannels.slice(dFrom, dTo).map((ch, i) => {
                    const idx = dFrom + i;
                    const isChTuned = isSameChannel(tunedChannel, ch);
                    const isCursor = drawerArea === 'channels' && drawerFocusIndex === idx;
                    const isFav = !!favMap[channelKey(ch)];
                    const initials = String(ch.name || 'TV').trim().slice(0, 2).toUpperCase();

                    return (
                      <div
                        key={ch.id || idx}
                        className={`pc-row ${isChTuned ? 'is-current' : ''} ${isCursor ? 'is-focused' : ''}`}
                        onClick={() => {
                          tune(ch);
                          onToggleChannelsDrawer();
                          onToggleOsd();
                        }}
                      >
                        {ch.logo ? (
                          <img
                            className="ic"
                            src={ch.logo}
                            alt=""
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                              const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div className="pc-avatar" style={{ display: ch.logo ? 'none' : 'flex' }}>
                          {initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="nm">
                            {ch.name} {isFav && <span style={{ color: '#FFD60A', marginLeft: 8 }}>★</span>}
                          </div>
                          {ch.now && <div className="epg">{ch.now}</div>}
                        </div>
                      </div>
                    );
                  })}
                  {rowsSpacer(drawerChannels.length - dTo, DRAWER_PITCH)}
                  </>
                  );
                  })()
                )}
              </div>
              </div>

              <div className="pc-menu">
                <span style={{ color: '#94a3b8', fontSize: 16 }}>
                  <b style={{ color: '#00e5ff' }}>▲▼</b> Navegar &nbsp;&nbsp;|&nbsp;&nbsp; 
                  <b style={{ color: '#00e5ff' }}>◄►</b> Categorías / Canales &nbsp;&nbsp;|&nbsp;&nbsp; 
                  <b style={{ color: '#00e5ff' }}>OK</b> {drawerArea === 'cats' ? 'Abrir' : 'Sintonizar'} &nbsp;&nbsp;|&nbsp;&nbsp; 
                  <b style={{ color: '#00e5ff' }}>BACK</b> Cerrar
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Super EPG Showcase Card (Visible in Preview Mode) */}
        {!isFullscreen && (
          <div className="live-super-epg-card">
            {displayChannel ? (
              <>
                <div className="epg-main-info">
                  <div className="epg-badge-row">
                    <span className={`epg-signal-tag ${isDisplayChannelTuned ? 'is-playing' : 'is-preview'}`}>
                      {isDisplayChannelTuned ? '● EN REPRODUCCIÓN' : '○ SELECCIONADO (PRESIONA OK PARA SINTONIZAR)'}
                    </span>
                    {hasClockTime(displayChannel.time) && (
                      <span className="epg-time-badge">{displayChannel.time}</span>
                    )}
                    <div className="epg-top-right">
                      <button
                        className={`epg-fav-icon ${
                          isFocusActive && focus.area === 'preview_btns' && focus.btnIndex === 1 ? 'is-focused' : ''
                        } ${isDisplayChannelFav ? 'is-favorite' : ''}`}
                        title={isDisplayChannelFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                        aria-label={isDisplayChannelFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                        onClick={() => onToggleFavorite(displayChannel)}
                      >
                        {isDisplayChannelFav ? '★' : '☆'}
                      </button>
                    </div>
                  </div>

                  <div className="epg-channel-header-row">
                    {displayChannel.logo ? (
                      <img
                        className="epg-channel-logo"
                        src={displayChannel.logo}
                        alt=""
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                          const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div className="epg-channel-avatar" style={{ display: displayChannel.logo ? 'none' : 'flex' }}>
                      {String(displayChannel.name || 'TV').trim().slice(0, 2).toUpperCase()}
                    </div>
                    <div className="epg-channel-text">
                      <h2 className="epg-channel-title">{displayChannel.name}</h2>
                      {displayChannel.now && !/^en vivo$/i.test(displayChannel.now.trim()) && (
                        <div className="epg-program-name">{displayChannel.now}</div>
                      )}
                    </div>
                  </div>

                  {/* Progress of the current programme: only when the channel sends its start and end times */}
                  {programProgress !== null && (
                    <div className="epg-progress-container">
                      <div className="epg-progress-labels">
                        <span className="epg-prog-time">{displayChannel.time!.split('-')[0].trim()}</span>
                        <span className="epg-prog-time">{displayChannel.time!.split('-')[1].trim()}</span>
                      </div>
                      <div className="epg-progress-track">
                        <div className="epg-progress-fill" style={{ width: `${programProgress}%` }} />
                      </div>
                    </div>
                  )}

                  {displayChannel.next && (
                    <div className="epg-upcoming-row">
                      <span className="epg-upcoming-label">A CONTINUACIÓN:</span>
                      <span className="epg-upcoming-title">{displayChannel.next}</span>
                    </div>
                  )}
                </div>

              </>
            ) : (
              <div className="epg-main-info" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: 180, textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>
                  No hay canal seleccionado
                </div>
                <div style={{ fontSize: 16 }}>
                  {activeCategory.isFav ? 'Añade tus canales favoritos para verlos aquí' : 'Selecciona una categoría con canales disponibles'}
                </div>
              </div>
            )}

            <div className="epg-footer-shortcuts">
              <span><b>OK</b> {focus.area === 'channels' && !isFocusedChannelTuned ? 'Sintonizar canal' : 'Pantalla completa'}</span>
              <span><b>▲ ▼</b> Navegar canales</span>
              <span><b>◄ ►</b> Columnas y botones</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

/** Memoized: App re-renders on every key, but this view only re-renders when its own props change */
export const LiveTvView = React.memo(LiveTvViewInner);
