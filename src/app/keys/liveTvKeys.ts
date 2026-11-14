import { TvKey } from '../../hooks/useTvRemote';
import { DEFAULT_LIVE_CATEGORIES } from '../../views/LiveTvView';
import { isSameChannel } from '../../lib/channelKey';
import { LiveTvState } from '../useLiveTv';
import { SHOW_REPLAY } from '../../lib/liveFeatures';

export type LiveTvKeysCtx = LiveTvState & {
  guardLiveCat: (catIndex: number, apply: () => void) => void;
  returnToHeader: () => void;
};

export function handleLiveTvKeys(key: TvKey, ctx: LiveTvKeysCtx): boolean {
  if (ctx.catchupChannel) {
    return true;
  }
  const {
    liveTvFocus,
    setLiveTvFocus,
    liveCategoriesRef,
    liveChannelsRef,
    tunedLiveChannel,
    setTunedLiveChannel,
    setIsFullscreenLive,
    triggerOsd,
    toggleLiveFavorite,
    guardLiveCat,
    returnToHeader
  } = ctx;
  if (key === 'channelUp' || key === 'channelDown') {
    const channels = liveChannelsRef.current;
    if (!channels.length) return true;
    const tunedIndex = channels.findIndex(channel => isSameChannel(tunedLiveChannel, channel));
    const step = key === 'channelUp' ? -1 : 1;
    const nextIndex = tunedIndex < 0
      ? Math.min(liveTvFocus.channelIndex, channels.length - 1)
      : (tunedIndex + step + channels.length) % channels.length;
    setLiveTvFocus(prev => ({ ...prev, channelIndex: nextIndex }));
    setTunedLiveChannel(channels[nextIndex]);
    triggerOsd();
    return true;
  }
  if (liveTvFocus.area === 'cats') {
    const totalCats = liveCategoriesRef.current.length || DEFAULT_LIVE_CATEGORIES.length;
    if (key === 'up') {
      setLiveTvFocus(prev => ({
        ...prev,
        catIndex: (prev.catIndex - 1 + totalCats) % totalCats
      }));
      return true;
    }
    if (key === 'down') {
      setLiveTvFocus(prev => ({
        ...prev,
        catIndex: (prev.catIndex + 1) % totalCats
      }));
      return true;
    }
    if (key === 'enter') {
      // Activate category without jumping into channels (PIN-guarded)
      const catIdx = liveTvFocus.catIndex;
      guardLiveCat(catIdx, () => {
        setLiveTvFocus(prev => ({
          ...prev,
          catIndex: catIdx,
          selectedCatIndex: catIdx,
          channelIndex: 0
        }));
      });
      return true;
    }
    if (key === 'right') {
      // Activate category AND move into Channels column (PIN-guarded)
      const catIdx = liveTvFocus.catIndex;
      guardLiveCat(catIdx, () => {
        setLiveTvFocus(prev => ({
          ...prev,
          catIndex: catIdx,
          selectedCatIndex: catIdx,
          area: 'channels',
          channelIndex: 0
        }));
      });
      return true;
    }
    if (key === 'left') {
      returnToHeader();
      return true;
    }
  }

  if (liveTvFocus.area === 'channels') {
    const totalChs = liveChannelsRef.current.length;
    if (key === 'up') {
      if (totalChs > 0) {
        setLiveTvFocus(prev => ({
          ...prev,
          channelIndex: (prev.channelIndex - 1 + totalChs) % totalChs
        }));
      }
      return true;
    }
    if (key === 'down') {
      if (totalChs > 0) {
        setLiveTvFocus(prev => ({
          ...prev,
          channelIndex: (prev.channelIndex + 1) % totalChs
        }));
      }
      return true;
    }
    if (key === 'left') {
      // Move back to Categories column, landing cursor right on the active category
      setLiveTvFocus(prev => ({
        ...prev,
        area: 'cats',
        catIndex: prev.selectedCatIndex ?? 0
      }));
      return true;
    }
    if (key === 'right') {
      // Move to Preview Action Buttons (Pantalla completa / Favorito / Replay)
      setLiveTvFocus(prev => ({ ...prev, area: 'preview_btns', btnIndex: 0 }));
      return true;
    }
    if (key === 'colorYellow' || key === 'colorBlue') {
      // Quick access: Open Catch-Up / Replay modal on focused channel
      const focusedChannel = liveChannelsRef.current[liveTvFocus.channelIndex] || tunedLiveChannel;
      if (focusedChannel && ctx.setCatchupChannel) {
        ctx.setCatchupChannel(focusedChannel);
        return true;
      }
    }
    if (key === 'enter') {
      // OK / Enter pressed on a channel:
      const focusedChannel = liveChannelsRef.current[liveTvFocus.channelIndex];
      if (focusedChannel) {
        if (isSameChannel(tunedLiveChannel, focusedChannel)) {
          // Channel is already playing -> Go fullscreen!
          setIsFullscreenLive(true);
          triggerOsd();
        } else {
          // Different channel -> Tune it!
          setTunedLiveChannel(focusedChannel);
        }
      }
      return true;
    }
  }

  if (liveTvFocus.area === 'preview_btns') {
    // btnIndex 0 = Pantalla completa (inside preview), 1 = Favorito, 2 = Replay (↺)
    if (key === 'up') {
      if (liveTvFocus.btnIndex === 1 || liveTvFocus.btnIndex === 2) {
        setLiveTvFocus(prev => ({ ...prev, btnIndex: 0 }));
      } else {
        returnToHeader();
      }
      return true;
    }
    if (key === 'down') {
      if (liveTvFocus.btnIndex === 0) {
        // Replay hidden (lib/liveFeatures): down goes to Favorito
        setLiveTvFocus(prev => ({ ...prev, btnIndex: SHOW_REPLAY ? 2 : 1 }));
      }
      return true;
    }
    if (key === 'left') {
      if (liveTvFocus.btnIndex === 1 && SHOW_REPLAY) {
        // Move from Favorito to Replay
        setLiveTvFocus(prev => ({ ...prev, btnIndex: 2 }));
      } else {
        // Move back to Channels column
        setLiveTvFocus(prev => ({ ...prev, area: 'channels' }));
      }
      return true;
    }
    if (key === 'right') {
      if (liveTvFocus.btnIndex === 2) {
        // Move from Replay to Favorito
        setLiveTvFocus(prev => ({ ...prev, btnIndex: 1 }));
      }
      return true;
    }
    if (key === 'enter') {
      if (liveTvFocus.btnIndex === 0) {
        // Pantalla completa
        setIsFullscreenLive(true);
        triggerOsd();
      } else if (liveTvFocus.btnIndex === 1) {
        // Favorito
        if (tunedLiveChannel) {
          toggleLiveFavorite(tunedLiveChannel);
        }
      } else if (liveTvFocus.btnIndex === 2) {
        // Replay / Catchup modal
        const targetCh = liveChannelsRef.current[liveTvFocus.channelIndex] || tunedLiveChannel;
        if (targetCh && ctx.setCatchupChannel) {
          ctx.setCatchupChannel(targetCh);
        }
      }
      return true;
    }
  }

  return true;
}
