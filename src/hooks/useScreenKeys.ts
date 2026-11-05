import { useEffect, useRef } from 'react';
import { TvKey } from './useTvRemote';

// Key handler for stack screens: a capture listener that swallows handled keys,
// so the home screen's useTvRemote never sees them while a screen is on top.
export function useScreenKeys(onKey: (key: TvKey, e: KeyboardEvent) => void, active: boolean = true) {
  const ref = useRef(onKey);
  ref.current = onKey;

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      let key: TvKey = 'other';
      switch (e.keyCode) {
        case 38: key = 'up'; break;
        case 40: key = 'down'; break;
        case 37: key = 'left'; break;
        case 39: key = 'right'; break;
        case 13: key = 'enter'; break;
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
