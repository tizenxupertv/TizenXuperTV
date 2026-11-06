import { useEffect, useRef } from 'react';
import { TvKey } from './useTvRemote';

// Key handler for stack screens: a capture listener that swallows handled keys,
// so the home screen's useTvRemote never sees them while a screen is on top.
const REPEAT_MIN_INTERVAL_MS = 65;

export function useScreenKeys(onKey: (key: TvKey, e: KeyboardEvent) => void, active: boolean = true) {
  const ref = useRef(onKey);
  ref.current = onKey;

  useEffect(() => {
    if (!active) return;
    let lastRepeatTime = 0;

    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      // Throttle rapid repeated keydowns to prevent event queue saturation on Tizen
      if (e.repeat) {
        const now = performance.now();
        if (now - lastRepeatTime < REPEAT_MIN_INTERVAL_MS) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        lastRepeatTime = now;
      } else {
        lastRepeatTime = performance.now();
      }

      let key: TvKey = 'other';
      switch (e.keyCode) {
        case 38: key = 'up'; break;
        case 40: key = 'down'; break;
        case 37: key = 'left'; break;
        case 39: key = 'right'; break;
        case 13: key = 'enter'; break;
        case 403: key = 'colorRed'; break;
        case 404: key = 'colorGreen'; break;
        case 405: key = 'colorYellow'; break;
        case 406: key = 'colorBlue'; break;
        case 10009:
        case 27:
        case 461:
        case 8:
          key = 'back';
          break;
        default:
          if (!/^[0-9]$/.test(e.key)) return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      ref.current(key, e);
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [active]);
}
