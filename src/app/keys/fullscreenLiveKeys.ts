import { TvKey } from '../../hooks/useTvRemote';
import { playerService } from '../../services/playerService';
import { pressKey, moveCursor, keyAt } from '../../components/live/OnScreenKeyboard';
import { LiveTvState } from '../useLiveTv';
import { pk } from '../../lib/localProfiles';
import { createSeekHold } from '../../lib/seekAccel';

/** Holding ◄ ► in a replay makes the jumps grow, as in movies (lib/seekAccel.ts) */
const replayHold = createSeekHold();

export type FullscreenLiveKeysCtx = LiveTvState & {
  guardLiveCat: (catIndex: number, apply: () => void) => void;
};

export function handleFullscreenLiveKeys(key: TvKey, ctx: FullscreenLiveKeysCtx, ev?: KeyboardEvent): boolean {
  const {
    liveTvFocus,
    setLiveTvFocus,
    liveCategoriesRef,
    liveChannels,
    liveChannelsRef,
    setTunedLiveChannel,
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
    showFullscreenOsd,
    setShowFullscreenOsd,
    triggerOsd,
    guardLiveCat,
    locateLiveChannel
  } = ctx;

  // Black screen on: any key brings the picture back (and does nothing else)
  if (ctx.screenOff) {
    ctx.setScreenOff(false);
    triggerOsd();
    return true;
  }
  if (showFullscreenGuide) {
    // Navigating inside Quick Mini-Guide Drawer (search + categories + channels)
    const searching = fullscreenQuery.trim().length > 0;
    const channelList = searching ? drawerResultsRef.current : liveChannelsRef.current;
    const totalChs = channelList.length;
    const totalCats = liveCategoriesRef.current.length;
    const closeDrawer = () => {
      setFullscreenQuery('');
      setFullscreenGuideArea('channels');
      setShowFullscreenGuide(false);
    };

    if (fullscreenGuideArea === 'searchbtn') {
      // Search icon (top-right of the drawer): OK opens the field + keyboard
      if (key === 'enter') {
        setFullscreenGuideArea('search');
        return true;
      }
      if (key === 'down') {
        setFullscreenGuideIndex(0);
        setFullscreenGuideArea('channels');
        return true;
      }
      if (key === 'back') {
        closeDrawer();
        return true;
      }
      return true;
    }

    if (fullscreenGuideArea === 'search') {
      // On-screen keyboard: arrows move over the keys, OK presses one
      const press = (k: string) => {
        const res = pressKey(k, fullscreenQuery, fullscreenKb, 30);
        setFullscreenKb(res.state);
        if (res.ok) {
          setFullscreenGuideIndex(0);
          setFullscreenGuideArea('channels');
        } else if (res.query !== fullscreenQuery) {
          setFullscreenQuery(res.query);
          setFullscreenGuideIndex(0);
        }
      };
      if (key === 'back') {
        if (ev && ev.keyCode === 8) {
          press('del'); // physical Backspace
        } else {
          setFullscreenGuideArea('channels');
        }
        return true;
      }
      if (key === 'enter') {
        press(keyAt(fullscreenKb));
        return true;
      }
      if (key === 'up' || key === 'down' || key === 'left' || key === 'right') {
        const next = moveCursor(fullscreenKb, key);
        if (next) {
          setFullscreenKb(next);
        } else if (key === 'right') {
          setFullscreenGuideIndex(0);
          setFullscreenGuideArea('channels');
        }
        return true;
      }
      return false;
    }

    if (fullscreenGuideArea === 'channels' && key === 'up') {
      if (fullscreenGuideIndex === 0) {
        setFullscreenGuideArea(fullscreenQuery ? 'search' : 'searchbtn');
      } else if (totalChs > 0) {
        setFullscreenGuideIndex(prev => Math.max(0, prev - 1));
      }
      return true;
    }
    if (fullscreenGuideArea === 'channels' && key === 'down') {
      if (totalChs > 0) {
        setFullscreenGuideIndex(prev => (prev + 1) % totalChs);
      }
      return true;
    }
    if (fullscreenGuideArea === 'cats') {
      // Categories column
      if (key === 'up' || key === 'down') {
        if (key === 'up' && fullscreenCatCursor === 0) {
          setFullscreenGuideArea(fullscreenQuery ? 'search' : 'searchbtn');
        } else if (totalCats > 0) {
          const delta = key === 'up' ? -1 : 1;
          setFullscreenCatCursor(prev => (prev + delta + totalCats) % totalCats);
        }
        return true;
      }
      if (key === 'right' || key === 'enter') {
        const idx = fullscreenCatCursor;
        guardLiveCat(idx, () => {
          setFullscreenQuery('');
          setLiveTvFocus(prev => ({ ...prev, catIndex: idx, selectedCatIndex: idx, channelIndex: 0 }));
          setFullscreenGuideIndex(0);
          setFullscreenGuideArea('channels');
        });
        return true;
      }
      if (key === 'left') {
        return true;
      }
    } else {
      // Channels column
      if (key === 'left') {
        setFullscreenCatCursor(liveTvFocus.selectedCatIndex ?? 0);
        setFullscreenGuideArea('cats');
        return true;
      }
      if (key === 'right') {
        return true;
      }
    }
    if (key === 'enter') {
      const selected = channelList[fullscreenGuideIndex];
      if (selected) {
        if (searching) {
          // A search result may live in another category: jump to it
          const loc = locateLiveChannel(selected);
          const apply = () => {
            if (loc) {
              setLiveTvFocus(prev => ({
                ...prev,
                catIndex: loc.catIndex,
                selectedCatIndex: loc.catIndex,
                channelIndex: loc.channelIndex
              }));
              try { localStorage.setItem(pk('xuper_last_live_cat_idx'), String(loc.catIndex)); } catch {}
            }
            setTunedLiveChannel(selected);
            try { localStorage.setItem(pk('xuper_last_live_ch'), JSON.stringify(selected)); } catch {}
            closeDrawer();
            triggerOsd();
          };
          if (loc) guardLiveCat(loc.catIndex, apply);
          else apply();
        } else {
          setLiveTvFocus(prev => ({ ...prev, channelIndex: fullscreenGuideIndex }));
          setTunedLiveChannel(selected);
          closeDrawer();
          triggerOsd();
        }
      }
      return true;
    }
    if (key === 'back') {
      closeDrawer();
      return true;
    }
    return true;
  }

  // Quick Mini-Guide is closed:
  // Color Shortcuts in Fullscreen Live TV
  if (key === 'colorRed' && ctx.tunedLiveChannel) {
    ctx.toggleLiveFavorite(ctx.tunedLiveChannel);
    ctx.triggerOsd();
    return true;
  }
  if (key === 'colorBlue') {
    ctx.setShowFullscreenGuide(prev => !prev);
    ctx.setShowFullscreenOsd(false);
    return true;
  }
  if (key === 'colorYellow') {
    ctx.triggerOsd();
    return true;
  }

  // Direct channel number keys (0-9)
  if (key === 'digit' && ev) {
    ctx.pushNumericDigit(ev.key);
    return true;
  }
  if (ctx.numericBuffer) {
    if (key === 'enter') {
      ctx.commitNumericTune();
      return true;
    }
    if (key === 'back') {
      ctx.cancelNumericTune();
      return true;
    }
  }

  // Back key
  if (key === 'back' || key === 'stop') {
    if (fullscreenFocusBtn !== 'none') {
      setFullscreenFocusBtn('none');
      return true;
    }
    if (showFullscreenOsd) {
      setShowFullscreenOsd(false);
      setFullscreenFocusBtn('none');
      return true;
    }
    setIsFullscreenLive(false);
    playerService.exitFullscreen();
    return true;
  }

  // When focused on InfoBar Action Buttons ([☰ Lista de canales] / [★ Favoritos] / [Pantalla negra])
  if (fullscreenFocusBtn !== 'none') {
    const buttons = ['channels', 'fav', 'screen'] as const;
    const at = Math.max(0, buttons.indexOf(fullscreenFocusBtn));
    if (key === 'left') {
      setFullscreenFocusBtn(buttons[Math.max(0, at - 1)]);
      triggerOsd();
      return true;
    }
    if (key === 'right') {
      setFullscreenFocusBtn(buttons[Math.min(buttons.length - 1, at + 1)]);
      triggerOsd();
      return true;
    }
    if (key === 'enter') {
      if (fullscreenFocusBtn === 'screen') {
        ctx.setScreenOff(true);
        setShowFullscreenOsd(false);
        setFullscreenFocusBtn('none');
        return true;
      }
      if (fullscreenFocusBtn === 'fav' && ctx.tunedLiveChannel) {
        ctx.toggleLiveFavorite(ctx.tunedLiveChannel);
        triggerOsd();
        return true;
      }
      if (fullscreenFocusBtn === 'channels') {
        setFullscreenGuideIndex(liveTvFocus.channelIndex);
        setFullscreenGuideArea('channels');
        setShowFullscreenGuide(true);
        setShowFullscreenOsd(false);
        setFullscreenFocusBtn('none');
        return true;
      }
      return true;
    }
    if (key === 'down' || key === 'up') {
      setFullscreenFocusBtn('none');
      triggerOsd();
      return true;
    }
    return true;
  }

  // A replay (catch-up programme): ◄ ► ⏪ ⏩ move in time and OK / play / pause pause it, like a movie,
  // instead of opening the channel list
  const tuned = ctx.tunedLiveChannel as (typeof ctx.tunedLiveChannel & { isCatchup?: boolean }) | null;
  const isReplay = !!(tuned && ((tuned.now && tuned.now.startsWith('↺')) || tuned.isCatchup));
  if (isReplay) {
    if (key === 'left' || key === 'right' || key === 'rewind' || key === 'fastForward') {
      const dir = key === 'right' || key === 'fastForward' ? 1 : -1;
      const delta = replayHold.press(dir, !!(ev && ev.repeat), Date.now());
      if (delta) playerService.replaySeekBy(delta);
      triggerOsd();
      return true;
    }
    if (key === 'enter' || key === 'playPause' || key === 'play' || key === 'pause') {
      playerService.replayTogglePause(key === 'play' ? 'play' : key === 'pause' ? 'pause' : undefined);
      triggerOsd();
      return true;
    }
  }

  // InfoBar buttons entry from normal viewing while OSD is visible:
  // ▲ (Up) or ► (Right) enters the buttons, focusing [★ Favoritos] directly
  if (showFullscreenOsd) {
    if (key === 'up') {
      setFullscreenFocusBtn('fav');
      triggerOsd();
      return true;
    }
    if (key === 'right') {
      setFullscreenFocusBtn('channels');
      triggerOsd();
      return true;
    }
  }

  if (key === 'left' || key === 'right') {
    // Open Floating Channel Drawer
    setFullscreenGuideIndex(liveTvFocus.channelIndex);
    setFullscreenGuideArea('channels');
    setShowFullscreenGuide(true);
    setShowFullscreenOsd(false);
    setFullscreenFocusBtn('none');
    return true;
  }
  if (key === 'up' || key === 'channelUp') {
    if (liveChannels.length > 0) {
      const nextIdx = (liveTvFocus.channelIndex - 1 + liveChannels.length) % liveChannels.length;
      setLiveTvFocus(prev => ({ ...prev, channelIndex: nextIdx }));
      setTunedLiveChannel(liveChannels[nextIdx]);
      triggerOsd();
    }
    return true;
  }
  if (key === 'down' || key === 'channelDown') {
    if (liveChannels.length > 0) {
      const nextIdx = (liveTvFocus.channelIndex + 1) % liveChannels.length;
      setLiveTvFocus(prev => ({ ...prev, channelIndex: nextIdx }));
      setTunedLiveChannel(liveChannels[nextIdx]);
      triggerOsd();
    }
    return true;
  }
  if (key === 'info') {
    if (showFullscreenOsd) {
      setShowFullscreenOsd(false);
      setFullscreenFocusBtn('none');
    } else {
      triggerOsd();
    }
    return true;
  }
  if (key === 'enter') {
    // Toggle OSD Info Banner
    if (showFullscreenOsd) {
      setShowFullscreenOsd(false);
      setFullscreenFocusBtn('none');
    } else {
      triggerOsd();
    }
    return true;
  }
  return true;
}
