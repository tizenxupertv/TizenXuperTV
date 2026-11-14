import { useEffect, useState } from 'react';
import { getDirectImageUrl } from './imageCache';
import { coverCacheEnabled, getCover, peekCover } from './coverCache';

/**
 * Address of a card image. On Tizen 6.0 and older (lib/coverCache.ts) it is a stored card-size copy, null while
 * that copy is made (the card's placeholder shows meanwhile); on other TVs the plain address, as before.
 */
export function useCardImage(url: string, w = 230, h = 340, enabled = true): string | null {
  const direct = enabled && url ? getDirectImageUrl(url) : '';
  const cached = !!direct && coverCacheEnabled();
  const [copy, setCopy] = useState<string | null>(() => (cached ? peekCover(url, w, h) : null));

  useEffect(() => {
    if (!cached) return;
    const known = peekCover(url, w, h);
    if (known) {
      setCopy(known);
      return;
    }
    setCopy(null);
    let alive = true;
    getCover(url, w, h, direct, direct).then(src => {
      if (alive) setCopy(src);
    });
    return () => {
      alive = false;
    };
  }, [cached, url, w, h, direct]);

  if (!direct) return null;
  return cached ? copy : direct;
}
