/**
 * The catalog snapshot shipped with the app (data/portal.js, about 500 kB): only a fallback for when there is no
 * saved catalog and the portal does not answer, and a pool of posters for search results without artwork.
 * It used to be read and parsed on every start; now it is loaded the first time something asks for it.
 */
let pending: Promise<void> | null = null;

export function ensurePortalSnapshot(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  if ((window as any).XUPERTV_PORTAL) return Promise.resolve();
  if (!pending) {
    pending = new Promise<void>(resolve => {
      const script = document.createElement('script');
      // Relative to the page, so it comes from the installed package also when the app runs an update bundle
      script.src = 'data/portal.js';
      script.onload = () => resolve();
      script.onerror = () => resolve(); // missing or unreadable: callers go on without it
      document.head.appendChild(script);
    });
  }
  return pending;
}
