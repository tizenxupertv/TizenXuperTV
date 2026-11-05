import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TabId, TABS } from './components/layout/TopNavbar';
import { Header } from './components/layout/Header';
import { DestacadosView, DestacadosFocus, ContentRowDef } from './views/DestacadosView';
import { LiveTvView } from './views/LiveTvView';
import { VodDetailView } from './views/VodDetailView';
import { VodPlayerFullscreen } from './views/VodPlayerFullscreen';
import { SearchModal } from './components/search/SearchModal';
import { ProfileScreen } from './screens/ProfileScreen';
import { BrowseScreen } from './screens/BrowseScreen';
import { PinDialog } from './screens/PinDialog';
import { WelcomeModal } from './components/common/WelcomeModal';
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
import { settingsService, applySubtitleChoice, PREFERRED_LANGUAGES, SUBTITLE_CHOICES } from './services/settingsService';
import { getResumeTarget, startAtForEpisode } from './lib/vodResume';
import { FocusDomain, VodPlayerState } from './app/types';
import { useCatalog } from './app/useCatalog';
import { useLiveTv } from './app/useLiveTv';
import { useVodDetail } from './app/useVodDetail';
import { useParentalGuards } from './app/useParentalGuards';
import { heroItemsForTab, buildTabRows, rowHasSeeAll, browseTargetForRow } from './app/tabRows';
import { handleFullscreenLiveKeys } from './app/keys/fullscreenLiveKeys';
import { handleVodDetailKeys } from './app/keys/vodDetailKeys';
import { handleHeaderKeys } from './app/keys/headerKeys';
import { handleLiveTvKeys } from './app/keys/liveTvKeys';
import { handleVodTabsKeys } from './app/keys/vodTabsKeys';
import { getTrackOffset, setTrackOffset } from './utils/scrollHelper';

export const App: React.FC = () => {
  // Read initial tab from URL if present (useful for deep-links & testing)
  const initialTabParam = (new URLSearchParams(window.location.search).get('tab') as TabId) || 'destacados';
  const validInitialTab = TABS.some(t => t.id === initialTabParam) ? initialTabParam : 'destacados';
  const initialTabIdx = TABS.findIndex(t => t.id === validInitialTab);

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
    showFullscreenOsd,
    setShowFullscreenOsd,
    triggerOsd,
    toggleLiveFavorite,
    locateLiveChannel
  } = live;

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
    setDetailEpisodes
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
    [selectedTab, historyItems, seriesItems, movieItems, featuredItems, kidsItems, animeItems, catalog.catalogRows]
  );
  const totalRows = currentRows.length;

  // Auto-rotate Hero showcase every 6 seconds when user is browsing rows or header
  useEffect(() => {
    if (selectedTab === 'tv' || activeVodPlayer || isFullscreenLive || isSearchOpen || activeDetailItem || stack.length > 0) return;
    if (focusDomain === 'content' && destacadosFocus.area === 'hero') return;
    const heroCount = Math.min(10, currentHeroItems.length);
    if (heroCount <= 1) return;

    const timer = setInterval(() => {
      setActiveHeroIndex(prev => {
        const next = (prev + 1) % heroCount;
        const upcoming = currentHeroItems[(next + 1) % heroCount];
        const nextBg = upcoming && (upcoming.backdrop || upcoming.landscape || upcoming.poster);
        if (nextBg) {
          try {
            const img = new Image();
            img.src = nextBg;
          } catch (_) {}
        }
        return next;
      });
    }, 6000);

    return () => clearInterval(timer);
  }, [selectedTab, activeVodPlayer, isFullscreenLive, isSearchOpen, activeDetailItem, stack.length, focusDomain, destacadosFocus.area, currentHeroItems]);

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
  // "Ver todo" of a row: the section's full catalog, filtered by the row's genre or year
  const openSeeAll = useCallback((row: ContentRowDef) => {
    const target = browseTargetForRow(row, selectedTab);
    if (target.column) {
      // The column's titles (all roots) plus the row's own, without repeats
      const seen = new Set<string>();
      const items = [...(catalog.catalogRows[target.column] || []), ...(row.items as VodItem[])]
        .filter(it => (seen.has(it.id) ? false : (seen.add(it.id), true)));
      push({ id: 'browse', root: target.root, title: row.title, items });
      return;
    }
    push({ id: 'browse', root: target.root, title: row.title, tag: target.tag, year: target.year });
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

  const openProfile = useCallback(() => {
    playerService.stop();
    push({ id: 'profile' });
  }, [push]);

  // Handle D-pad Navigation: routes each key to the handler of the active screen.
  // Kept in a ref so the window listener never runs with stale state.
  const handleKeyRef = useRef<(key: TvKey, ev?: KeyboardEvent) => boolean>(() => true);
  handleKeyRef.current = (key: TvKey, ev?: KeyboardEvent): boolean => {
    // Search modal owns the keyboard while open (typing, arrows, Enter, Back)
    if (isSearchOpen) return false;

    // Fullscreen VOD Player (handles its own keys; back closes player)
    if (activeVodPlayer) {
      if (key === 'back') setActiveVodPlayer(null);
      return true;
    }

    if (isFullscreenLive) {
      return handleFullscreenLiveKeys(key, { ...live, guardLiveCat }, ev);
    }

    if (activeDetailItem) {
      return handleVodDetailKeys(key, { ...detail, activeDetailItem, setActiveVodPlayer, playFromDetail });
    }

    // Helper to return to the active tab in header
    const returnToHeader = () => {
      setFocusDomain('header');
      const curTabIdx = TABS.findIndex(t => t.id === selectedTab);
      setHeaderFocusIndex(curTabIdx !== -1 ? curTabIdx : 1);
    };

    // Global Back key: return to header if in content
    if (key === 'back') {
      if (focusDomain === 'content') {
        returnToHeader();
        return true;
      }
      return false; // let system handle exit
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
        openProfile
      });
    }

    if (selectedTab === 'tv') {
      return handleLiveTvKeys(key, { ...live, guardLiveCat, returnToHeader });
    }

    return handleVodTabsKeys(key, {
      activeHeroIndex,
      setActiveHeroIndex,
      destacadosFocus,
      setDestacadosFocus,
      handleOpenDetail,
      currentHeroItems,
      currentRows,
      totalRows,
      getRowItemCount,
      returnToHeader,
      findVod,
      openSeeAll
    });
  };
  const handleKey = useCallback((key: TvKey, ev?: KeyboardEvent) => handleKeyRef.current(key, ev), []);

  useTvRemote({ onKey: handleKey });

  // Live TV callbacks with a stable identity, so the memoized LiveTvView skips renders
  // caused by keys handled elsewhere (VOD tabs, header, detail)
  const liveViewHandlers = useStableHandlers({
    onDrawerResults: (list: LiveChannel[]) => { drawerResultsRef.current = list; },
    onTuneChannel: (ch: LiveChannel) => {
      setTunedLiveChannel(ch);
      try { localStorage.setItem('xuper_last_live_ch', JSON.stringify(ch)); } catch {}
    },
    onEnterFullscreen: (ch: LiveChannel) => {
      if (ch) {
        setTunedLiveChannel(ch);
        try { localStorage.setItem('xuper_last_live_ch', JSON.stringify(ch)); } catch {}
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
        try { localStorage.setItem('xuper_last_live_ch', JSON.stringify(chs[0])); } catch {}
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
        try { localStorage.setItem('xuper_last_live_cat_idx', String(idx)); } catch {}
      });
    }
  });

  // Check if current hero item is favorite
  const isHeroFav = useMemo(() => {
    const item = currentHeroItems[activeHeroIndex];
    return item ? favoritesService.isFavorite(item.id) : false;
  }, [currentHeroItems, activeHeroIndex]);

  return (
    <div className="app-root theme-apple-dark">
      {/* Unified Single Header Bar (68px) - Hide when in Fullscreen or Detail Screen! */}
      {!isFullscreenLive && !activeDetailItem && (
        <Header
          selectedTab={selectedTab}
          focusedIndex={focusDomain === 'header' ? headerFocusIndex : null}
          onSelectTab={tab => guardTab(tab, () => setSelectedTab(tab))}
          onSearchClick={() => setIsSearchOpen(true)}
          onProfileClick={openProfile}
        />
      )}

      {/* View: TV EN VIVO (Preserved in DOM to prevent reload/cache drops on tab switch) */}
      <div
        className="tab-pane-live-tv"
        style={{
          display: selectedTab === 'tv' && !activeDetailItem && !activeVodPlayer ? 'contents' : 'none'
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
          fullscreenFocusBtn="none"
          {...liveViewHandlers}
        />
      </div>

      {/* View: VOD TABS (Destacados, Películas, Series, Kids, Anime, Historial) */}
      {/* Stays mounted under the detail / player (hidden) so Back returns to the same row, card and scroll */}
      {selectedTab !== 'tv' && (
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
          onActivateVod={it => handleOpenDetail(it)}
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
          onSelectSeason={sIdx => setDetailFocus(prev => ({ ...prev, seasonIndex: sIdx, episodeIndex: 0 }))}
          onSelectRelated={rel => handleOpenDetail(rel)}
          onDetailLoaded={counts => setDetailCounts(counts)}
          onOpenAudioModal={() => setDetailFocus(prev => ({ ...prev, area: 'audioModal', modalCol: 'audio', modalIndex: 0 }))}
          onCloseAudioModal={() => setDetailFocus(prev => ({ ...prev, area: 'actions', actionIndex: 2 }))}
          onSelectAudioOption={opt => {
            settingsService.set({ audio: Math.max(0, PREFERRED_LANGUAGES.indexOf(opt)) });
            setDetailFocus(prev => ({ ...prev }));
          }}
          onSelectSubOption={sub => {
            applySubtitleChoice(Math.max(0, SUBTITLE_CHOICES.indexOf(sub)));
            setDetailFocus(prev => ({ ...prev }));
          }}
        />
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
              fixedItems={screen.items}
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
              try { localStorage.setItem('xuper_last_live_cat_idx', String(loc.catIndex)); } catch {}
            }
            try { localStorage.setItem('xuper_last_live_ch', JSON.stringify(ch)); } catch {}
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
    </div>
  );
};
