/**
 * Lightweight browser-native image cache & predictive preloader for TV.
 *
 * Uses the TV browser's built-in image decoder and HTTP cache directly.
 * Predictive preloading creates offscreen Image elements with decoding="async",
 * pre-warming Chromium's internal cache without touching disk I/O (IndexedDB)
 * or freezing CPU with worker canvas re-scaling.
 */

const preloadedUrls = new Set<string>();
const loadedImageUrls = new Set<string>();
const failedImageUrls = new Set<string>();
let preloadTimer: any = null;

export function isImagePrecached(url: string): boolean {
  if (!url) return false;
  return loadedImageUrls.has(url);
}

export function markImageLoaded(url: string): void {
  if (url) {
    loadedImageUrls.add(url);
    failedImageUrls.delete(url);
  }
}

export function markImageFailed(url: string): void {
  if (url) {
    failedImageUrls.add(url);
  }
}

export function isImageFailed(url: string): boolean {
  if (!url) return false;
  return failedImageUrls.has(url);
}

export function getImageCacheStats(): { loaded: number; failed: number; preloaded: number } {
  return {
    loaded: loadedImageUrls.size,
    failed: failedImageUrls.size,
    preloaded: preloadedUrls.size
  };
}

export function getDirectImageUrl(url: string): string {
  if (!url) return '';
  return import.meta.env.DEV && /^https?:/.test(url)
    ? `${location.origin}/stream-proxy?url=${encodeURIComponent(url)}`
    : url;
}

/** Preload neighboring cards into Chromium native cache ahead of user navigation (debounced to idle) */
export function preloadCardNeighbors(
  items: { poster?: string; landscape?: string; backdrop?: string }[],
  currentIndex: number,
  count = 2,
  isWide = false
): void {
  if (!items || !items.length || typeof window === 'undefined') return;

  // Clear pending preloads while user is actively pressing D-pad keys
  if (preloadTimer) clearTimeout(preloadTimer);

  // Only preload after user pauses for 280ms
  preloadTimer = setTimeout(() => {
    const targets: string[] = [];

    // Look ahead N+1 to N+count
    for (let offset = 1; offset <= count; offset++) {
      const idx = currentIndex + offset;
      if (idx < items.length) {
        const it = items[idx];
        const url = isWide ? (it.landscape || it.backdrop || it.poster) : (it.poster || it.landscape || it.backdrop);
        if (url && /^https?:/.test(url)) targets.push(url);
      }
    }

    // Look back N-1
    if (currentIndex > 0) {
      const it = items[currentIndex - 1];
      const url = isWide ? (it.landscape || it.backdrop || it.poster) : (it.poster || it.landscape || it.backdrop);
      if (url && /^https?:/.test(url)) targets.push(url);
    }

    for (const rawUrl of targets) {
      if (!preloadedUrls.has(rawUrl)) {
        preloadedUrls.add(rawUrl);
        const direct = getDirectImageUrl(rawUrl);
        const img = new Image();
        img.decoding = 'async';
        img.src = direct;
        if (typeof img.decode === 'function') {
          img.decode()
            .then(() => markImageLoaded(direct))
            .catch(() => {});
        }
      }
    }
  }, 280);
}

/** Returns the image URL synchronously without cascading re-renders */
export function useCardImage(url: string, _w?: number, _h?: number, enabled = true): string | null {
  if (!enabled || !url) return null;
  return getDirectImageUrl(url);
}

/** Legacy signature compatibility for splash/preload logic */
export function optimizedImage(url: string, _w?: number, _h?: number): Promise<string> {
  const direct = getDirectImageUrl(url);
  if (!preloadedUrls.has(url) && typeof window !== 'undefined' && direct) {
    preloadedUrls.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = direct;
    if (typeof img.decode === 'function') {
      img.decode()
        .then(() => markImageLoaded(direct))
        .catch(() => {});
    }
  }
  return Promise.resolve(direct);
}
