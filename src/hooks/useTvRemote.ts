import { useEffect, useRef } from 'react';
import { dropBack } from '../lib/backKey';

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
  onKeyUp?: (key: TvKey, event: KeyboardEvent) => boolean | void;
}

// Minimum interval between repeated keydown events (ms) to prevent event-queue saturation on Tizen
const REPEAT_MIN_INTERVAL_MS = 65;

export function mapKeyCode(code: number): TvKey {
  switch (code) {
    case 38: return 'up';
    case 40: return 'down';
    case 37: return 'left';
    case 39: return 'right';
    case 13: return 'enter';
    case 10009:
    case 27:
    case 461:
    case 8: return 'back';
    case 415: return 'play';
    case 19: return 'pause';
    case 10252: return 'playPause';
    case 413: return 'stop';
    case 417: return 'fastForward';
    case 412: return 'rewind';
    case 427:
    case 33: return 'channelUp';
    case 428:
    case 34: return 'channelDown';
    case 457: return 'info';
    case 48:
    case 49:
    case 50:
    case 51:
    case 52:
    case 53:
    case 54:
    case 55:
    case 56:
    case 57: return 'digit';
    case 403: return 'colorRed';
    case 404: return 'colorGreen';
    case 405: return 'colorYellow';
    case 406: return 'colorBlue';
    default: return 'other';
  }
}

export function useTvRemote({ onKey, onKeyUp }: UseTvRemoteOptions) {
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  const onKeyUpRef = useRef(onKeyUp);
  onKeyUpRef.current = onKeyUp;

  useEffect(() => {
    let lastRepeatTime = 0;
    let lastBackAt = -Infinity;
    let backRepeats = false;

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

      const key = mapKeyCode(e.keyCode);
      // One press of Back = one step (lib/backKey.ts): a held Back must not walk out of the app
      // (not while typing: Backspace held in a text field deletes as usual)
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (key === 'back' && !typing) {
        const now = performance.now();
        const drop = dropBack({ repeat: e.repeat || backRepeats, sinceLastMs: now - lastBackAt });
        lastBackAt = now;
        if (drop) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      const consumed = onKeyRef.current(key, e);
      if (consumed !== false) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    // The remote's own Back event, seen before the bridge re-sends it without `repeat`
    function noteRemoteBack(e: KeyboardEvent) {
      if (e.keyCode === 10009) backRepeats = e.repeat;
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (!onKeyUpRef.current) return;
      const key = mapKeyCode(e.keyCode);
      const consumed = onKeyUpRef.current(key, e);
      if (consumed !== false) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    window.addEventListener('keydown', noteRemoteBack, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', noteRemoteBack, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
}
