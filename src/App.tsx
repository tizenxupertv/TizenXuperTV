import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TabId, getTabs } from './components/layout/TopNavbar';
import { tabPrefs } from './services/tabPrefs';
import { parentalService } from './services/parentalService';
import { Header } from './components/layout/Header';
import { DestacadosView, DestacadosFocus, ContentRowDef } from './views/DestacadosView';
import { LiveTvView } from './views/LiveTvView';
import { VodDetailView } from './views/VodDetailView';
import { VodPlayerFullscreen } from './views/VodPlayerFullscreen';
import { SportsView } from './views/SportsView';
import { SportsPlayerFullscreen } from './views/SportsPlayerFullscreen';
import type { SportsEvent, SportsStream } from './types/sports';
import { SearchModal } from './components/search/SearchModal';
import { ProfileScreen } from './screens/ProfileScreen';
import { BrowseScreen, resolveCategoryIdForRow } from './screens/BrowseScreen';
import { FilterScreen } from './screens/FilterScreen';
import { BrowseRoot, FilterRoot } from './lib/screenStack';
import { PerfHud } from './components/common/PerfHud';
import { PinDialog } from './screens/PinDialog';
import { WelcomeModal } from './components/common/WelcomeModal';
import { ContinueWatchingOptionsModal } from './components/vod/ContinueWatchingOptionsModal';
import { playerService } from './services/playerService';
import { favoritesService } from './services/favoritesService';
import { useTvRemote, TvKey } from './hooks/useTvRemote';
import { useScreenStack } from './hooks/useScreenStack';
import { useStableHandlers } from './hooks/useStableHandlers';
import { startSplash, completeSplashTask, preloadImages } from './lib/splash';
import { optimizedImage } from './lib/imageCache';
import { catalogService } from './services/catalogService';
import { VodItem, VodEpisode } from './types/vod';
import { LiveChannel, LiveCategory } from './types/channel';
import { historyService } from './services/historyService';
import type { HistoryItem } from './types/history';
import { settingsService, subtitleChoiceIndex, applySettingChoice, SETTINGS_ROW } from './services/settingsService';
import { getResumeTarget, startAtForEpisode } from './lib/vodResume';
import { FocusDomain, VodPlayerState } from './app/types';
import { useCatalog } from './app/useCatalog';
import { useLiveTv } from './app/useLiveTv';
import { useVodDetail } from './app/useVodDetail';
import { useParentalGuards } from './app/useParentalGuards';
import { heroItemsForTab, buildTabRows, rowHasSeeAll, browseTargetForRow, portalRootForTab } from './app/tabRows';
import { handleFullscreenLiveKeys } from './app/keys/fullscreenLiveKeys';
import { handleVodDetailKeys, settingPosition } from './app/keys/vodDetailKeys';
import { handleHeaderKeys } from './app/keys/headerKeys';
import { handleLiveTvKeys } from './app/keys/liveTvKeys';
import { handleVodTabsKeys } from './app/keys/vodTabsKeys';
import { getTrackOffset, setTrackOffset } from './utils/scrollHelper';
import { updateService } from './services/updateService';
import { UpdateReady } from './components/common/UpdateReady';
import { pk } from './lib/localProfiles';
import { ProfileMenu, type ProfileMenuAction } from './components/layout/ProfileMenu';
import { ProfilePickerScreen } from './screens/ProfilePickerScreen';

export const App: React.FC = () => {
  // Read initial tab from URL if present (useful for deep-links & testing)
  const initialTabParam = (new URLSearchParams(window.location.search).get('tab') as TabId) || 'destacados';
  const initialTabs = getTabs(false, tabPrefs.hidden());
  const validInitialTab = initialTabs.some(t => t.id === initialTabParam) ? initialTabParam : 'destacados';
  const initialTabIdx = initialTabs.findIndex(t => t.id === validInitialTab);

  // Navigation / Focus State
  // Domains: 'header' | 'content'
  // Header focus index: 0..6 = Tabs, 7 = Search, 8 = Profile
  const [focusDomain, setFocusDomain] = useState<FocusDomain>('header');
  const [selectedTab, setSelectedTab] = useState<TabId>(validInitialTab);
  const [headerFocusIndex, setHeaderFocusIndex] = useState<number>(initialTabIdx !== -1 ? initialTabIdx : 1);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);

  // Focus within VOD Views (Destacados, Películas, Series, etc.)
  const [activeHeroIndex, setActiveHeroIndex] = useState<number>(0);
  const [destacadosFocus, setDestacadosFocus] = useState<DestacadosFocus>({
    area: 'hero',
    heroBtn: 'play',
    rowIndex: 0,
    cardIndex: 0
  });

  // Active VOD Player State
  const [activeVodPlayer, setActiveVodPlayer] = useState<VodPlayerState | null>(null);

  // Active Sports Stream Player State
  const [activeSportsPlayer, setActiveSportsPlayer] = useState<{
    event: SportsEvent;
    streamIndex: number;
    streams: SportsStream[];
  } | null>(null);

  // Catalog, live TV, detail screen and screen stack (profile, PIN)
  const catalog = useCatalog(applyDeepLink);
  const { featuredItems, movieItems, seriesItems, kidsItems, animeItems, historyItems, findVod } = catalog;

  const live = useLiveTv();
  const {
    liveTvFocus,
    setLiveTvFocus,
    liveCategories,
    setLiveCategories,
    liveCategoriesRef,
    liveChannels,
    setLiveChannels,
    tunedLiveChannel,
    setTunedLiveChannel,
    liveFavMap,
    isFullscreenLive,
    setIsFullscreenLive,
    showFullscreenGuide,
    setShowFullscreenGuide,
    fullscreenGuideIndex,
    fullscreenGuideArea,
    setFullscreenGuideArea,
    fullscreenQuery,
    fullscreenKb,
    drawerResultsRef,
    fullscreenCatCursor,
    fullscreenFocusBtn,
    setFullscreenFocusBtn,
    showFullscreenOsd,
    setShowFullscreenOsd,
    triggerOsd,
    toggleLiveFavorite,
    locateLiveChannel,
    numericBuffer
  } = live;

  // Double-Back exit prompt state
  const [showExitToast, setShowExitToast] = useState(false);
  const lastBackPressRef = useRef(0);
  const exitToastTimerRef = useRef<any>(null);

  // Continue Watching options modal & toast
  const [historyOptionsItem, setHistoryOptionsItem] = useState<HistoryItem | null>(null);
  const [historyOptionsIdx, setHistoryOptionsIdx] = useState<number>(0);
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const toastNoticeTimerRef = useRef<any>(null);

  const enterLongPressTimerRef = useRef<any>(null);
  const enterLongPressFiredRef = useRef<boolean>(false);
  const pendingHistoryActivateRef = useRef<HistoryItem | null>(null);

  const openHistoryOptions = useCallback((item: HistoryItem) => {
    setHistoryOptionsItem(item);
    setHistoryOptionsIdx(0);
  }, []);

  const closeHistoryOptions = useCallback(() => {
    setHistoryOptionsItem(null);
  }, []);

  const removeHistoryItem = useCallback((item: HistoryItem) => {
    historyService.removeEntry(item.id);
    setHistoryOptionsItem(null);
    setToastNotice(`«${item.title || 'Título'}» eliminado de Seguir viendo`);
    if (toastNoticeTimerRef.current) clearTimeout(toastNoticeTimerRef.current);
    toastNoticeTimerRef.current = setTimeout(() => setToastNotice(null), 2500);
  }, []);

  // Inactivity screensaver for OLED/QLED panels (5 minutes without remote input)
  const screensaverTimerRef = useRef<any>(null);
  const resetScreensaverTimer = useCallback(() => {
    if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
      window.XuperPlatform.setScreenSaver(false);
    }
    if (screensaverTimerRef.current) clearTimeout(screensaverTimerRef.current);
    screensaverTimerRef.current = setTimeout(() => {
      // Only engage screensaver if not actively playing fullscreen video
      if (!activeVodPlayer && !isFullscreenLive) {
        if (window.XuperPlatform && window.XuperPlatform.setScreenSaver) {
          window.XuperPlatform.setScreenSaver(true);
        }
      }
    }, 5 * 60 * 1000);
  }, [activeVodPlayer, isFullscreenLive]);

  // ---------- A downloaded update (services/updateService.ts): a TV app is rarely started from scratch, so it is not
  // left for the next launch. Restarting = reloading the page (public/js/boot.js starts the new version).
  const [, setUpdateTick] = useState(0);
  useEffect(() => updateService.subscribe(() => setUpdateTick(t => t + 1)), []);
  const isPlaying = !!activeVodPlayer || isFullscreenLive;
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;
  // Back from another app or with the screen on again: apply it right away, unless a video is playing
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && !playingRef.current && updateService.status().downloaded) window.location.reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  // Or ask for it: a blocking "Reiniciar ahora", never over a video (it waits for the video to end)
  const readyVersion = updateService.status().downloaded;
  const showUpdateReady = !!readyVersion && !isPlaying;

  useEffect(() => {
    resetScreensaverTimer();
    const onActivity = () => resetScreensaverTimer();
    window.addEventListener('keydown', onActivity, { passive: true });
    return () => {
      window.removeEventListener('keydown', onActivity);
      if (screensaverTimerRef.current) clearTimeout(screensaverTimerRef.current);
    };
  }, [resetScreensaverTimer]);

  const detail = useVodDetail(featuredItems, movieItems, seriesItems);
  const {
    activeDetailItem,
    setActiveDetailItem,
    detailFocus,
    setDetailFocus,
    setDetailCounts,
    handleOpenDetail,
    currentRelatedItems,
    detailEpisodes,
    setDetailEpisodes,
    setDetailCast,
    selectedPerson,
    setSelectedPerson
  } = detail;

  // Starts playback from the detail screen: resume / next episode / chosen episode / trailer
  const playFromDetail = (item: VodItem, episode?: VodEpisode, isTrailer?: boolean) => {
    if (isTrailer) {
      setActiveVodPlayer({ item, isTrailer: true });
      return;
    }
    const entry = historyService.getEntry(item.id);
    const { episodes, seasonId, seasonNumber } = detailEpisodes;
    const target = episode
      ? { episode, startAt: startAtForEpisode(episode, entry) }
      : getResumeTarget(item, episodes, entry, seasonNumber, seasonId);
    setActiveVodPlayer({
      item,
      episode: target.episode,
      startAt: target.startAt,
      seriesId: seasonId,
      seasonNumber,
      episodes
    });
  };

  const { stack, push, pop } = useScreenStack();
  const { requestPin, guardLiveCat, guardTab } = useParentalGuards(push, liveCategoriesRef, liveTvFocus);

  // A collection tile (portal aggregation row) opens its column in the tab's catalog; any other
  // card opens its detail
  const openVodCard = useCallback((it: VodItem) => {
    if (it.collectionId) {
      push({ id: 'browse', root: portalRootForTab(selectedTab) || 'kids', title: it.title, column: it.title });
      return;
    }
    handleOpenDetail(it);
  }, [selectedTab, push, handleOpenDetail]);

  // Deep links for testing: ?detail=<id|title>&detailArea=..&vodPlayer=1&scrollTop=..
  function applyDeepLink(loaded: { featured?: VodItem[]; movies?: VodItem[]; series?: VodItem[]; kids?: VodItem[]; anime?: VodItem[] }) {
    const urlParams = new URLSearchParams(window.location.search);
    const detailParam = urlParams.get('detail');
    if (detailParam) {
      const all = [
        ...(loaded.featured || []),
        ...(loaded.movies || []),
        ...(loaded.series || []),
        ...(loaded.kids || []),
        ...(loaded.anime || [])
      ];
      const found = all.find(it => it.id === detailParam || it.title.toLowerCase().includes(detailParam.toLowerCase()));
      if (found) {
        handleOpenDetail(found);
        const detailArea = urlParams.get('detailArea') as any;
        if (detailArea) {
          const epIdx = parseInt(urlParams.get('epIdx') || '0', 10);
          const actIdx = parseInt(urlParams.get('actIdx') || '0', 10);
          setDetailFocus({
            area: detailArea,
            actionIndex: actIdx,
            seasonIndex: 0,
            episodeIndex: epIdx,
            relatedIndex: 0,
            modalCol: (urlParams.get('modalCol') as any) || 'audio',
            modalIndex: parseInt(urlParams.get('modalIdx') || '0', 10)
          });
        }
        if (urlParams.get('vodPlayer') === '1') {
          setActiveVodPlayer({ item: found, isTrailer: urlParams.get('trailer') === '1' });
        }
      }
    }

    if (urlParams.get('profile') === '1') {
      const sec = parseInt(urlParams.get('sec') || '0', 10);
      push({ id: 'profile', section: sec });
    }

    const scrollParam = urlParams.get('scrollTop');
    if (scrollParam) {
      setTimeout(() => {
        const t = document.querySelector('.page-track') as HTMLElement | null;
        if (t) setTrackOffset(t, 'y', parseInt(scrollParam, 10), false);
      }, 400);
    }
  }

  // Hero and rows for the active VOD tab
  const currentHeroItems = useMemo<VodItem[]>(
    () => heroItemsForTab(selectedTab, catalog),
    [selectedTab, featuredItems, movieItems, seriesItems, kidsItems, animeItems]
  );
  const currentRows = useMemo(
    () => buildTabRows(selectedTab, catalog),
    [selectedTab, historyItems, seriesItems, movieItems, featuredItems, kidsItems, animeItems, catalog.catalogRows, catalog.portalRows]
  );
  const totalRows = currentRows.length;

  // Auto-rotate Hero showcase only when hero is visible at top (paused while browsing rows below to prevent background re-renders)
  useEffect(() => {
    if (selectedTab === 'tv' || selectedTab === 'deportes' || activeVodPlayer || activeSportsPlayer || isFullscreenLive || isSearchOpen || activeDetailItem || stack.length > 0) return;
    if (focusDomain === 'content' && destacadosFocus.area === 'row') return;
    const heroCount = Math.min(10, currentHeroItems.length);
    if (heroCount <= 1) return;

    const timer = setInterval(() => {
      setActiveHeroIndex(prev => (prev + 1) % heroCount);
    }, 8000);

    return () => clearInterval(timer);
  }, [selectedTab, activeVodPlayer, isFullscreenLive, isSearchOpen, activeDetailItem, stack.length, focusDomain, destacadosFocus.area, currentHeroItems.length]);

  // Splash (index.html): a real loading screen, see lib/splash.ts
  useEffect(() => { startSplash(); }, []);
  // Refresh the saved live catalog for the next start: once the first screen is idle, and when a
  // TV left on brings the app back to the front
  useEffect(() => {
    const t = setTimeout(() => catalogService.refreshLiveInBackground(), 15000);
    const onVisible = () => { if (!document.hidden) catalogService.refreshLiveInBackground(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const splashImagesRef = useRef(false);
  useEffect(() => {
    if (splashImagesRef.current || !(featuredItems.length || movieItems.length || seriesItems.length)) return;
    splashImagesRef.current = true;
    completeSplashTask('catalog');
    // The first screen is complete once the hero and the visible posters are decoded
    const hero = currentHeroItems[0];
    const urls: string[] = hero ? [hero.backdrop || hero.landscape || hero.poster || ''] : [];
    // First cards: the same card-size copies the rows will show (made once, then cached)
    const cards: Promise<string>[] = [];
    currentRows.slice(0, 3).forEach(row => {
      const history = row.type === 'history';
      const wide = !!(row as { isWide?: boolean }).isWide;
      (row.items as { poster?: string; landscape?: string; backdrop?: string }[]).slice(0, 7).forEach(it => {
        const url = history || !wide ? (it.poster || it.landscape || it.backdrop) : (it.landscape || it.backdrop || it.poster);
        if (!url) return;
        cards.push(history ? optimizedImage(url, 392, 221) : optimizedImage(url, wide ? 484 : 230, 340));
      });
    });
    // Later starts read the copies from the cache at once; the first start does not wait for them
    // to be made (the placeholder shows until each one is ready)
    const copies = Promise.race([
      Promise.all(cards),
      new Promise<string[]>(resolve => setTimeout(() => resolve([]), 1500))
    ]);
    copies.then(srcs => preloadImages(urls.concat(srcs))).then(() => completeSplashTask('images'));
  }, [currentRows, currentHeroItems, featuredItems, movieItems, seriesItems]);
  const getRowItemCount = useCallback((rowIdx: number): number => {
    const row = currentRows[rowIdx];
    if (!row) return 0;
    return row.items.length + (rowHasSeeAll(row) ? 1 : 0);
  }, [currentRows]);
  // "Ver todo" of a row: opens the Categorized Catalog view focused on that row's category
  const openSeeAll = useCallback((row: ContentRowDef) => {
    const category = resolveCategoryIdForRow(row.title);
    // A portal row is a column of its tab's root: the catalog opens on that same column
    if (row.portalRoot) {
      push({ id: 'browse', root: row.portalRoot, title: row.title, column: row.title, items: row.items as VodItem[], category });
      return;
    }
    const target = browseTargetForRow(row, selectedTab);
    if (target.column) {
      // The column's titles (all roots) plus the row's own, without repeats
      const seen = new Set<string>();
      const items = [...(catalog.catalogRows[target.column] || []), ...(row.items as VodItem[])]
        .filter(it => (seen.has(it.id) ? false : (seen.add(it.id), true)));
      push({ id: 'browse', root: target.root, title: row.title, items, category, column: target.column });
      return;
    }
    push({ id: 'browse', root: target.root, title: row.title, tag: target.tag, year: target.year, category });
  }, [selectedTab, push, catalog.catalogRows]);

  // Each VOD tab remembers its focus, hero slide and scroll; a new tab starts at the top
  const tabMemoryRef = useRef<Partial<Record<TabId, { focus: DestacadosFocus; hero: number; scrollTop: number }>>>({});
  const prevTabRef = useRef<TabId>(selectedTab);
  useEffect(() => {
    const prev = prevTabRef.current;
    if (prev === selectedTab) return;
    prevTabRef.current = selectedTab;

    const track = document.querySelector('.page-track') as HTMLElement | null;
    if (prev !== 'tv') {
      tabMemoryRef.current[prev] = {
        focus: destacadosFocus,
        hero: activeHeroIndex,
        scrollTop: getTrackOffset(track)
      };
    }
    const saved = tabMemoryRef.current[selectedTab];
    setDestacadosFocus(saved ? saved.focus : { area: 'hero', heroBtn: 'play', rowIndex: 0, cardIndex: 0 });
    setActiveHeroIndex(saved ? saved.hero : 0);
    requestAnimationFrame(() => {
      const t = document.querySelector('.page-track') as HTMLElement | null;
      if (t) setTrackOffset(t, 'y', saved ? saved.scrollTop : 0, false);
    });
  }, [selectedTab]);

  // The header avatar opens its menu: switch profile, manage profiles, Mi lista e historial, Ajustes
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profilesView, setProfilesView] = useState<null | 'pick' | 'manage'>(null);
  const openProfile = useCallback(() => setProfileMenuOpen(true), []);
  const runProfileMenu = useCallback((action: ProfileMenuAction) => {
    setProfileMenuOpen(false);
    if (action === 'manage' || action === 'add') {
      setProfilesView(action === 'manage' ? 'manage' : 'pick');
      return;
    }
    playerService.stop();
    // Ajustes: section 0 is Mi perfil (history and Mi lista), 1 Configuración global
    push({ id: 'profile', section: action === 'list' ? 0 : 1 });
  }, [push]);

  // "+18" tab: shown only when enabled in Perfil › Bloqueo; opens the adult section after the PIN
  const [adultEnabled, setAdultEnabled] = useState<boolean>(() => parentalService.isAdultEnabled());
  useEffect(() => parentalService.subscribe(() => setAdultEnabled(parentalService.isAdultEnabled())), []);
  // Kids / Anime can be hidden in Perfil › Pestañas
  const [hiddenTabs, setHiddenTabs] = useState<TabId[]>(() => tabPrefs.hidden());
  useEffect(() => tabPrefs.subscribe(() => setHiddenTabs(tabPrefs.hidden())), []);
  const tabs = useMemo(() => getTabs(adultEnabled, hiddenTabs), [adultEnabled, hiddenTabs]);
  // Search, filter and profile follow the tabs in the header: keep their focus when the number of tabs changes
  const tabCountRef = useRef(tabs.length);
  useEffect(() => {
    const delta = tabs.length - tabCountRef.current;
    const oldCount = tabCountRef.current;
    tabCountRef.current = tabs.length;
    if (delta) setHeaderFocusIndex(i => (i >= oldCount ? i + delta : Math.min(i, tabs.length - 1)));
  }, [tabs.length]);
  // A hidden tab cannot stay selected
  useEffect(() => {
    if (hiddenTabs.indexOf(selectedTab) >= 0) setSelectedTab('destacados');
  }, [hiddenTabs, selectedTab]);
  const openAdult = useCallback(() => {
    const go = () => push({ id: 'browse', root: 'adult', title: 'Adultos +18' });
    if (parentalService.isAdultEnabled()) requestPin('unlock', go);
  }, [push, requestPin]);
  const selectTab = useCallback((tab: TabId) => {
    if (tab === 'adultos') openAdult();
    else guardTab(tab, () => setSelectedTab(tab));
  }, [openAdult, guardTab]);

  // Filter screen, on the type of the current tab (movies elsewhere)
  const openFilter = useCallback((root?: FilterRoot) => {
    const byTab: Partial<Record<TabId, FilterRoot>> = { peliculas: 'movies', series: 'series', kids: 'kids', anime: 'anime' };
    playerService.stop();
    push({ id: 'filter', root: root || byTab[selectedTab] || 'movies' });
  }, [push, selectedTab]);

  // Helper to return to the active tab in header
  const returnToHeader = useCallback(() => {
    setFocusDomain('header');
    const curTabIdx = tabs.findIndex(t => t.id === selectedTab);
    setHeaderFocusIndex(curTabIdx !== -1 ? curTabIdx : 1);
  }, [selectedTab, tabs]);

  // Handle D-pad Navigation: routes each key to the handler of the active screen.
  // Kept in a ref so the window listener never runs with stale state.
  const handleKeyRef = useRef<(key: TvKey, ev?: KeyboardEvent) => boolean>(() => true);
  handleKeyRef.current = (key: TvKey, ev?: KeyboardEvent): boolean => {
    // Continue Watching Options Modal owns remote keys while open
    if (historyOptionsItem) {
      if (key === 'up') {
        setHistoryOptionsIdx(i => Math.max(0, i - 1));
        return true;
      }
      if (key === 'down') {
        setHistoryOptionsIdx(i => Math.min(2, i + 1));
        return true;
      }
      if (key === 'back') {
        closeHistoryOptions();
        return true;
      }
      if (key === 'enter') {
        if (historyOptionsIdx === 0) {
          removeHistoryItem(historyOptionsItem);
        } else if (historyOptionsIdx === 1) {
          const vod = findVod(historyOptionsItem);
          closeHistoryOptions();
          handleOpenDetail(vod);
        } else {
          closeHistoryOptions();
        }
        return true;
      }
      return true;
    }

    // Search modal owns the keyboard while open (typing, arrows, Enter, Back); a detail or the
    // player opened from it sits on top and takes the keys (the search waits hidden underneath)
    if (isSearchOpen && !activeDetailItem && !activeVodPlayer) return false;

    // Fullscreen VOD Player (handles its own keys; back closes player)
    if (activeVodPlayer) {
      if (key === 'back') setActiveVodPlayer(null);
      return true;
    }

    // Fullscreen Sports Player (handles its own keys; back closes player)
    if (activeSportsPlayer) {
      if (key === 'back') setActiveSportsPlayer(null);
      return true;
    }

    if (isFullscreenLive) {
      return handleFullscreenLiveKeys(key, { ...live, guardLiveCat }, ev);
    }

    if (activeDetailItem) {
      return handleVodDetailKeys(key, { ...detail, activeDetailItem, setActiveVodPlayer, playFromDetail });
    }

    // Global Color Shortcuts (Samsung TV Remote)
    if (key === 'colorGreen') {
      setIsSearchOpen(true);
      return true;
    }
    if (key === 'colorRed') {
      if (selectedTab === 'tv' && tunedLiveChannel) {
        toggleLiveFavorite(tunedLiveChannel);
        return true;
      }
      if (activeDetailItem) {
        favoritesService.toggleFavorite(activeDetailItem.id);
        return true;
      }
    }
    if (key === 'colorYellow') {
      if (activeDetailItem) {
        setDetailFocus(prev => ({ ...prev, area: 'audioModal', modalCol: 'menu', modalIndex: 0, quickIndex: 1 }));
        return true;
      }
      if (selectedTab === 'tv') {
        triggerOsd();
        return true;
      }
      if ((window as any).__togglePerfHud) {
        (window as any).__togglePerfHud();
        return true;
      }
    }
    if (key === 'colorBlue') {
      if (selectedTab === 'tv') {
        setShowFullscreenGuide(prev => !prev);
        return true;
      }
      if (activeDetailItem && detail.detailCounts?.hasTrailer) {
        playFromDetail(activeDetailItem, undefined, true);
        return true;
      }
      // The stack always holds the home screen: length 1 means nothing is open on top of it
      if (!activeDetailItem && !activeVodPlayer && stack.length <= 1) {
        // Universal category exploration gives access to the full combined catalog
        push({ id: 'browse', root: 'explorar', title: 'Explorar', category: 'all' });
        return true;
      }
    }

    // Global Back key: return to header if in content, or double-press from header to exit
    if (key === 'back') {
      if (focusDomain === 'content') {
        returnToHeader();
        return true;
      }
      // Currently in header: double-press within 2.5s to exit
      const now = Date.now();
      if (now - lastBackPressRef.current < 2500) {
        if (exitToastTimerRef.current) clearTimeout(exitToastTimerRef.current);
        window.XuperPlatform.exit();
        return true;
      }
      lastBackPressRef.current = now;
      setShowExitToast(true);
      if (exitToastTimerRef.current) clearTimeout(exitToastTimerRef.current);
      exitToastTimerRef.current = window.setTimeout(() => setShowExitToast(false), 2500);
      return true;
    }

    if (focusDomain === 'header') {
      return handleHeaderKeys(key, {
        setFocusDomain,
        selectedTab,
        setSelectedTab,
        headerFocusIndex,
        setHeaderFocusIndex,
        setDestacadosFocus,
        setLiveTvFocus,
        setIsSearchOpen,
        guardTab,
        openProfile,
        openFilter: () => openFilter(),
        tabs,
        selectTab
      });
    }

    if (selectedTab === 'tv') {
      return handleLiveTvKeys(key, { ...live, guardLiveCat, returnToHeader });
    }

    if (selectedTab === 'deportes') {
      return true;
    }

    // Cancel long-press timer if another key is pressed
    if (enterLongPressTimerRef.current && key !== 'enter') {
      clearTimeout(enterLongPressTimerRef.current);
      enterLongPressTimerRef.current = null;
      pendingHistoryActivateRef.current = null;
    }

    // Intercept Enter / Info on Seguir viendo cards for long-press options
    const curRowDef = currentRows[destacadosFocus.rowIndex];
    const isHistoryRow = focusDomain === 'content' && destacadosFocus.area === 'row' && curRowDef?.type === 'history';
    const focusedHistoryItem = isHistoryRow ? (curRowDef.items[destacadosFocus.cardIndex] as HistoryItem) : null;

    if (focusedHistoryItem) {
      if (key === 'info') {
        openHistoryOptions(focusedHistoryItem);
        return true;
      }
      if (key === 'enter') {
        if (ev?.repeat) {
          return true;
        }
        if (enterLongPressTimerRef.current) clearTimeout(enterLongPressTimerRef.current);
        enterLongPressFiredRef.current = false;
        pendingHistoryActivateRef.current = focusedHistoryItem;
        enterLongPressTimerRef.current = window.setTimeout(() => {
          enterLongPressFiredRef.current = true;
          pendingHistoryActivateRef.current = null;
          openHistoryOptions(focusedHistoryItem);
        }, 450);
        return true;
      }
    }

    return handleVodTabsKeys(key, {
      activeHeroIndex,
      setActiveHeroIndex,
      destacadosFocus,
      setDestacadosFocus,
      handleOpenDetail: openVodCard,
      currentHeroItems,
      currentRows,
      totalRows,
      getRowItemCount,
      returnToHeader,
      findVod,
      openSeeAll
    });
  };

  const handleKeyUpRef = useRef<(key: TvKey, ev?: KeyboardEvent) => boolean | void>(() => {});
  handleKeyUpRef.current = (key: TvKey) => {
    if (key === 'enter') {
      if (enterLongPressTimerRef.current) {
        clearTimeout(enterLongPressTimerRef.current);
        enterLongPressTimerRef.current = null;
      }
      if (enterLongPressFiredRef.current) {
        enterLongPressFiredRef.current = false;
        return true;
      }
      if (pendingHistoryActivateRef.current) {
        const item = pendingHistoryActivateRef.current;
        pendingHistoryActivateRef.current = null;
        handleOpenDetail(findVod(item));
        return true;
      }
    }
  };
  const handleKey = useCallback((key: TvKey, ev?: KeyboardEvent) => handleKeyRef.current(key, ev), []);
  const handleKeyUp = useCallback((key: TvKey, ev?: KeyboardEvent) => handleKeyUpRef.current(key, ev), []);

  useTvRemote({ onKey: handleKey, onKeyUp: handleKeyUp });

  // Live TV callbacks with a stable identity, so the memoized LiveTvView skips renders
  // caused by keys handled elsewhere (VOD tabs, header, detail)
  const liveViewHandlers = useStableHandlers({
    onDrawerResults: (list: LiveChannel[]) => { drawerResultsRef.current = list; },
    onTuneChannel: (ch: LiveChannel) => {
      setTunedLiveChannel(ch);
      try { localStorage.setItem(pk('xuper_last_live_ch'), JSON.stringify(ch)); } catch {}
    },
    onEnterFullscreen: (ch: LiveChannel) => {
      if (ch) {
        setTunedLiveChannel(ch);
        try { localStorage.setItem(pk('xuper_last_live_ch'), JSON.stringify(ch)); } catch {}
      }
      setIsFullscreenLive(true);
      triggerOsd();
    },
    onExitFullscreen: () => {
      setIsFullscreenLive(false);
      playerService.exitFullscreen();
    },
    onToggleFavorite: (ch: LiveChannel) => toggleLiveFavorite(ch),
    onToggleChannelsDrawer: () => setShowFullscreenGuide(prev => !prev),
    onOpenDrawerSearch: () => setFullscreenGuideArea('search'),
    onToggleOsd: () => setShowFullscreenOsd(prev => !prev),
    onChannelsLoaded: (chs: LiveChannel[]) => {
      setLiveChannels(chs);
      if (!tunedLiveChannel && chs.length > 0) {
        setTunedLiveChannel(chs[0]);
        try { localStorage.setItem(pk('xuper_last_live_ch'), JSON.stringify(chs[0])); } catch {}
      }
    },
    onCategoriesLoaded: (cats: LiveCategory[]) => {
      setLiveCategories(cats);
      completeSplashTask('live');
      // Open the category that holds the remembered channel: the saved index can point to
      // another category (the list changed, or the user browsed without tuning)
      if (tunedLiveChannel) {
        const loc = locateLiveChannel(tunedLiveChannel, cats, liveTvFocus.selectedCatIndex);
        if (loc) {
          setLiveTvFocus(prev => ({ ...prev, catIndex: loc.catIndex, selectedCatIndex: loc.catIndex, channelIndex: loc.channelIndex }));
        }
      }
    },
    onSelectCategory: (idx: number) => {
      guardLiveCat(idx, () => {
        setLiveTvFocus(prev => ({ ...prev, selectedCatIndex: idx, catIndex: idx }));
        try { localStorage.setItem(pk('xuper_last_live_cat_idx'), String(idx)); } catch {}
      });
    }
  });

  // Check if current hero item is favorite
  const isHeroFav = useMemo(() => {
    const item = currentHeroItems[activeHeroIndex];
    return item ? favoritesService.isFavorite(item.id) : false;
  }, [currentHeroItems, activeHeroIndex]);

  // Network connectivity status (Phase 3 resilience)
  const [networkToast, setNetworkToast] = useState<{ visible: boolean; online: boolean; message: string } | null>(null);

  useEffect(() => {
    let hideTimer: any = null;

    const onNetChange = (e: any) => {
      const isOnline = !!e?.detail?.online;
      if (!isOnline) {
        if (hideTimer) clearTimeout(hideTimer);
        setNetworkToast({
          visible: true,
          online: false,
          message: 'Sin conexión a internet · Esperando reconexión…'
        });
      } else {
        setNetworkToast(prev => {
          if (!prev || !prev.visible) return null; // Don't show toast on fresh boot if already connected
          return {
            visible: true,
            online: true,
            message: 'Conexión a internet restablecida'
          };
        });
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          setNetworkToast(null);
        }, 2800);
      }
    };

    window.addEventListener('xuper-network-change', onNetChange);
    return () => {
      window.removeEventListener('xuper-network-change', onNetChange);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  const [favTick, setFavTick] = useState<number>(0);
  useEffect(() => favoritesService.subscribe(() => setFavTick(t => t + 1)), []);
  void favTick;

  return (
    <div className="app-root theme-apple-dark">
      {/* Network Connectivity Toast (Tizen Resilience) */}
      {networkToast && networkToast.visible && (
        <div className={`network-status-toast ${networkToast.online ? 'is-online' : 'is-offline'}`}>
          <span className="network-status-dot" />
          <span>{networkToast.message}</span>
        </div>
      )}

      {/* Unified Single Header Bar (68px) - Hide when in Fullscreen or Detail Screen! */}
      {!isFullscreenLive && !activeDetailItem && !activeSportsPlayer && (
        <Header
          selectedTab={selectedTab}
          focusedIndex={focusDomain === 'header' ? headerFocusIndex : null}
          tabs={tabs}
          onSelectTab={selectTab}
          onSearchClick={() => setIsSearchOpen(true)}
          onFilterClick={() => openFilter()}
          onProfileClick={openProfile}
          profileActive={profileMenuOpen}
        />
      )}
      {profileMenuOpen && <ProfileMenu onAction={runProfileMenu} onClose={() => setProfileMenuOpen(false)} />}
      {profilesView && (
        <ProfilePickerScreen
          initialManaging={profilesView === 'manage'}
          onDone={() => setProfilesView(null)}
          onClose={() => setProfilesView(null)}
        />
      )}

      {/* View: TV EN VIVO (Preserved in DOM to prevent reload/cache drops on tab switch) */}
      <div
        className="tab-pane-live-tv"
        style={{
          display: selectedTab === 'tv' ? 'contents' : 'none',
          visibility: selectedTab === 'tv' && (activeDetailItem || activeVodPlayer) ? 'hidden' : undefined,
          pointerEvents: selectedTab === 'tv' && (activeDetailItem || activeVodPlayer) ? 'none' : undefined,
        }}
      >
        <LiveTvView
          focus={liveTvFocus}
          isActiveTab={selectedTab === 'tv' && !activeDetailItem && !activeVodPlayer}
          isFocusActive={focusDomain === 'content' && selectedTab === 'tv'}
          isFullscreen={isFullscreenLive}
          tunedChannel={tunedLiveChannel}
          favMap={liveFavMap}
          showOsd={showFullscreenOsd}
          showChannelsDrawer={showFullscreenGuide}
          drawerFocusIndex={fullscreenGuideIndex}
          drawerArea={fullscreenGuideArea}
          drawerQuery={fullscreenQuery}
          drawerKb={fullscreenKb}
          drawerCatIndex={fullscreenCatCursor}
          fullscreenFocusBtn={fullscreenFocusBtn}
          numericBuffer={numericBuffer}
          catchupChannel={live.catchupChannel}
          setCatchupChannel={live.setCatchupChannel}
          {...liveViewHandlers}
        />
      </div>

      {/* View: DEPORTES (Cartelera deportiva en vivo y transmisiones) */}
      {selectedTab === 'deportes' && (
        <div
          className="tab-pane-sports"
          style={{
            display: 'contents',
            visibility: activeDetailItem || activeVodPlayer || activeSportsPlayer ? 'hidden' : 'visible'
          }}
        >
          <SportsView
            isFocusActive={focusDomain === 'content' && !activeSportsPlayer && !activeDetailItem && !activeVodPlayer}
            paused={!!activeSportsPlayer || !!activeDetailItem || !!activeVodPlayer}
            onFocusHeader={returnToHeader}
            onPlayEventStream={(event, streamIndex, streams) => {
              playerService.stop();
              setActiveSportsPlayer({ event, streamIndex, streams });
            }}
          />
        </div>
      )}

      {/* View: VOD TABS (Destacados, Películas, Series, Kids, Anime, Explorar) */}
      {/* Stays mounted under the detail / player (hidden) so Back returns to the same row, card and scroll */}
      {selectedTab !== 'tv' && selectedTab !== 'deportes' && (
        <div
          className="tab-pane-vod"
          style={{ display: 'contents', visibility: activeDetailItem || activeVodPlayer ? 'hidden' : 'visible' }}
        >
        <DestacadosView
          heroItems={currentHeroItems}
          activeHeroIndex={activeHeroIndex}
          historyItems={historyItems}
          trendingItems={featuredItems}
          recommendedMovies={movieItems}
          mustWatchSeries={seriesItems}
          rows={currentRows}
          focus={destacadosFocus}
          isFocusActive={focusDomain === 'content'}
          isFavorite={isHeroFav}
          onPlayHero={it => handleOpenDetail(it)}
          onToggleFavHero={it => favoritesService.toggleFavorite(it.id)}
          onActivateHistory={it => {
            const vod = findVod(it);
            handleOpenDetail(vod);
          }}
          onOptionsHistory={openHistoryOptions}
          onActivateVod={openVodCard}
          onSeeAll={openSeeAll}
        />
        </div>
      )}

      {/* View: VOD DETAIL MODAL / SCREEN (Cinema Dark / Apple TV+) */}
      {activeDetailItem && !activeVodPlayer && (
        <VodDetailView
          item={activeDetailItem}
          focus={detailFocus}
          isFavorite={favoritesService.isFavorite(activeDetailItem.id)}
          relatedItems={currentRelatedItems}
          onBack={detail.handleBackDetail}
          onPlay={(it, ep, isTrailer) => playFromDetail(it, ep, isTrailer)}
          onEpisodesChange={data => setDetailEpisodes(data)}
          onToggleFavorite={it => favoritesService.toggleFavorite(it.id)}
          onSelectSeason={sIdx => setDetailFocus(prev => ({
            ...prev,
            // Picking from the open season list closes it
            area: prev.area === 'seasonMenu' ? 'seasons' : prev.area,
            seasonIndex: sIdx,
            episodeIndex: prev.seasonIndex === sIdx ? prev.episodeIndex : 0
          }))}
          onSelectEpisode={epIdx => setDetailFocus(prev => ({ ...prev, episodeIndex: epIdx }))}
          onOpenSeasonMenu={() => setDetailFocus(prev => ({ ...prev, area: 'seasonMenu', seasonMenuIndex: prev.seasonIndex }))}
          onSelectRelated={rel => handleOpenDetail(rel)}
          onDetailLoaded={counts => setDetailCounts(counts)}
          onCastChange={cast => setDetailCast(cast)}
          selectedPerson={selectedPerson}
          onSelectPerson={p => setSelectedPerson(p)}
          onClosePerson={() => setSelectedPerson(null)}
          onOpenAudioModal={col => {
            const current = col === 'menu' ? 0 : settingPosition(col, detail.detailCounts);
            setDetailFocus(prev => ({ ...prev, area: 'audioModal', modalCol: col, modalIndex: current, quickIndex: 1 }));
          }}
          onCloseAudioModal={() => setDetailFocus(prev => ({ ...prev, area: 'quick', quickIndex: 1 }))}
          onSelectSetting={(col, index) => {
            applySettingChoice(col, index);
            setDetailFocus(prev => ({ ...prev, area: 'audioModal', modalCol: 'menu', modalIndex: SETTINGS_ROW[col] }));
          }}
        />
      )}

      {showUpdateReady && (
        <UpdateReady version={readyVersion} onRestart={() => window.location.reload()} />
      )}

      {/* Fullscreen Cinema Player (VOD & Trailers) */}
      {activeVodPlayer && (
        <VodPlayerFullscreen
          key={`${activeVodPlayer.item.id}-${activeVodPlayer.episode?.id || ''}-${activeVodPlayer.isTrailer ? 't' : ''}`}
          item={activeVodPlayer.item}
          episode={activeVodPlayer.episode}
          isTrailer={activeVodPlayer.isTrailer}
          startAt={activeVodPlayer.startAt}
          seriesId={activeVodPlayer.seriesId}
          seasonNumber={activeVodPlayer.seasonNumber}
          episodes={activeVodPlayer.episodes}
          onPlayEpisode={ep => setActiveVodPlayer(prev => (prev ? { ...prev, episode: ep, startAt: 0 } : prev))}
          onClose={() => setActiveVodPlayer(null)}
        />
      )}

      {/* Fullscreen Sports Player */}
      {activeSportsPlayer && (
        <SportsPlayerFullscreen
          event={activeSportsPlayer.event}
          initialStreamIndex={activeSportsPlayer.streamIndex}
          streams={activeSportsPlayer.streams}
          onClose={() => setActiveSportsPlayer(null)}
        />
      )}

      {/* Stack screens: Profile / PIN dialog */}
      {stack.map((screen, idx) => {
        const isTop = idx === stack.length - 1;
        if (screen.id === 'profile') {
          return (
            <ProfileScreen
              key={`profile-${idx}`}
              isTop={isTop}
              hidden={!!activeDetailItem || !!activeVodPlayer}
              isSearchOpen={isSearchOpen}
              initialSection={screen.section}
              liveCategories={liveCategories}
              catalogItems={[...featuredItems, ...movieItems, ...seriesItems, ...kidsItems, ...animeItems]}
              onClose={pop}
              onRequestPin={(mode, onSuccess) => requestPin(mode, onSuccess)}
              onOpenVod={it => {
                pop();
                handleOpenDetail(it);
              }}
              onOpenHistory={h => {
                const vod = findVod(h);
                pop();
                handleOpenDetail(vod);
              }}
            />
          );
        }
        if (screen.id === 'browse') {
          // Stays under a detail opened from it, so Back returns to the same grid position
          return (
            <BrowseScreen
              key={`browse-${idx}`}
              isTop={isTop}
              hidden={!!activeDetailItem || !!activeVodPlayer}
              isSearchOpen={isSearchOpen}
              root={screen.root}
              title={screen.title}
              initialTag={screen.tag}
              initialYear={screen.year}
              initialCategory={screen.category}
              initialColumn={screen.column}
              fixedItems={screen.items}
              catalogRows={catalog.catalogRows}
              catalogItems={[...featuredItems, ...movieItems, ...seriesItems, ...kidsItems, ...animeItems]}
              onClose={pop}
              onOpenVod={it => handleOpenDetail(it)}
              onOpenSearch={() => setIsSearchOpen(true)}
              onOpenFilter={screen.root === 'adult' ? undefined : () => {
                const r = screen.root;
                openFilter(r === 'movies' || r === 'series' || r === 'kids' || r === 'anime' ? r : 'movies');
              }}
            />
          );
        }
        if (screen.id === 'filter') {
          // Stays under a detail opened from it, so Back returns to the same filters and grid position
          return (
            <FilterScreen
              key={`filter-${idx}`}
              isTop={isTop}
              hidden={!!activeDetailItem || !!activeVodPlayer}
              isSearchOpen={isSearchOpen}
              initialRoot={screen.root}
              onClose={pop}
              onOpenVod={it => handleOpenDetail(it)}
              onOpenSearch={() => setIsSearchOpen(true)}
            />
          );
        }
        if (screen.id === 'pin') {
          return (
            <PinDialog
              key={`pin-${idx}`}
              mode={screen.mode}
              isTop={isTop}
              onSuccess={screen.onSuccess}
              onCancel={screen.onCancel}
              onClose={pop}
            />
          );
        }
        return null;
      })}

      {/* Universal Search View (TV & VOD) - Stays alive under detail view so Back returns to search */}
      <SearchModal
        isOpen={isSearchOpen}
        hidden={!!activeDetailItem || !!activeVodPlayer}
        currentTab={selectedTab}
        onClose={() => setIsSearchOpen(false)}
        onSelectChannel={ch => {
          setIsSearchOpen(false);
          const loc = locateLiveChannel(ch);
          const apply = () => {
            setSelectedTab('tv');
            setFocusDomain('content');
            setTunedLiveChannel(ch);
            if (loc) {
              setLiveTvFocus(prev => ({
                ...prev,
                area: 'channels',
                catIndex: loc.catIndex,
                selectedCatIndex: loc.catIndex,
                channelIndex: loc.channelIndex
              }));
              try { localStorage.setItem(pk('xuper_last_live_cat_idx'), String(loc.catIndex)); } catch {}
            }
            try { localStorage.setItem(pk('xuper_last_live_ch'), JSON.stringify(ch)); } catch {}
          };
          if (loc) guardLiveCat(loc.catIndex, apply);
          else apply();
        }}
        onSelectVodItem={item => {
          handleOpenDetail(item);
          // Do not close search! It stays alive underneath the detail view.
        }}
        channels={liveChannels}
      />

      {/* First-Run Welcome & Remote Control Guide */}
      <WelcomeModal />

      {/* Continue Watching Options Modal (Long Press OK / Info / Dots) */}
      {historyOptionsItem && (
        <ContinueWatchingOptionsModal
          item={historyOptionsItem}
          focusIndex={historyOptionsIdx}
          onSelectIndex={setHistoryOptionsIdx}
          onRemove={() => removeHistoryItem(historyOptionsItem)}
          onDetails={() => {
            const vod = findVod(historyOptionsItem);
            closeHistoryOptions();
            handleOpenDetail(vod);
          }}
          onClose={closeHistoryOptions}
        />
      )}

      {/* Temporary Toast Notice */}
      {toastNotice && (
        <div className="pf-toast">
          {toastNotice}
        </div>
      )}

      {/* Double-Back Exit Toast */}
      {showExitToast && (
        <div className="xuper-exit-toast">
          <span>Presione ATRÁS de nuevo para salir</span>
        </div>
      )}

      {/* Real-Time Performance Monitor & Profiler Overlay */}
      <PerfHud />
    </div>
  );
};
