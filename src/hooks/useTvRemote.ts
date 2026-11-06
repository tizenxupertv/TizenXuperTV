import { useEffect, useRef } from 'react';

export type TvKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'enter'
  | 'back'
  | 'play'
  | 'pause'
  | 'playPause'
  | 'stop'
  | 'fastForward'
  | 'rewind'
  | 'channelUp'
  | 'channelDown'
  | 'info'
  | 'digit'
  | 'colorRed'
  | 'colorGreen'
  | 'colorYellow'
  | 'colorBlue'
  | 'other';

interface UseTvRemoteOptions {
  onKey: (key: TvKey, event: KeyboardEvent) => boolean | void;
}

// Minimum interval between repeated keydown events (ms) to prevent event-queue saturation on Tizen
const REPEAT_MIN_INTERVAL_MS = 65;

export function useTvRemote({ onKey }: UseTvRemoteOptions) {
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;

  useEffect(() => {
    let lastRepeatTime = 0;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;

      // Throttle rapid repeated keydowns (holding D-pad arrows) to avoid buffer backlog & overshoot
      if (e.repeat) {
        const now = performance.now();
        if (now - lastRepeatTime < REPEAT_MIN_INTERVAL_MS) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        lastRepeatTime = now;
      } else {
        lastRepeatTime = performance.now();
      }

      let key: TvKey = 'other';

      switch (e.keyCode) {
        case 38: // ArrowUp
          key = 'up';
          break;
        case 40: // ArrowDown
          key = 'down';
          break;
        case 37: // ArrowLeft
          key = 'left';
          break;
        case 39: // ArrowRight
          key = 'right';
          break;
        case 13: // Enter
          key = 'enter';
          break;
        case 10009: // Tizen Back
        case 27:    // Escape
        case 461:   // LG Back
        case 8:     // Backspace
          key = 'back';
          break;
        case 415:   // Samsung MediaPlay
          key = 'play';
          break;
        case 19:    // Samsung MediaPause
          key = 'pause';
          break;
        case 10252: // Samsung MediaPlayPause
          key = 'playPause';
          break;
        case 413:   // Samsung MediaStop
          key = 'stop';
          break;
        case 417:   // Samsung MediaFastForward
          key = 'fastForward';
          break;
        case 412:   // Samsung MediaRewind
          key = 'rewind';
          break;
        case 427:   // Samsung ChannelUp
        case 33:    // PageUp
          key = 'channelUp';
          break;
        case 428:   // Samsung ChannelDown
        case 34:    // PageDown
          key = 'channelDown';
          break;
        case 457:   // Samsung Info
          key = 'info';
          break;
        case 48: // 0
        case 49: // 1
        case 50: // 2
        case 51: // 3
        case 52: // 4
        case 53: // 5
        case 54: // 6
        case 55: // 7
        case 56: // 8
        case 57: // 9
          key = 'digit';
          break;
        case 403: // Samsung ColorF0Red
          key = 'colorRed';
          break;
        case 404: // Samsung ColorF1Green
          key = 'colorGreen';
          break;
        case 405: // Samsung ColorF2Yellow
          key = 'colorYellow';
          break;
        case 406: // Samsung ColorF3Blue
          key = 'colorBlue';
          break;
        default:
          return;
      }

      const consumed = onKeyRef.current(key, e);
      if (consumed !== false) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
