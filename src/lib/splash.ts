/**
 * Splash screen defined in index.html (shown before any script runs).
 *
 * It is a real loading screen: it stays until every startup task is done, so the first screen
 * appears complete (catalog, hero and first posters decoded, live TV categories), and at least
 * MIN_VISIBLE_MS so it never flashes. MAX_VISIBLE_MS is a safety net for a slow network.
 * The script loader in index.html fills the first 30% of the bar while scripts download.
 */
export type SplashTask = 'catalog' | 'images' | 'live';

const TASKS: { id: SplashTask; weight: number; text: string }[] = [
  { id: 'catalog', weight: 30, text: 'Cargando catálogo…' },
  { id: 'images', weight: 25, text: 'Preparando imágenes…' },
  { id: 'live', weight: 15, text: 'Conectando TV en vivo…' }
];
const SCRIPTS_SHARE = 30;
const MIN_VISIBLE_MS = 1500;
const MAX_VISIBLE_MS = 12000;

const done = new Set<SplashTask>();
let hidden = false;

function fill(pct: number): void {
  const el = document.querySelector('#xuper-splash .xs-fill') as HTMLElement | null;
  if (el) el.style.width = `${Math.min(100, Math.round(pct))}%`;
}

export function setSplashStatus(text: string): void {
  const el = document.querySelector('#xuper-splash .xs-status');
  if (el) el.textContent = text;
}

function hideSplash(): void {
  if (hidden) return;
  hidden = true;
  // First screen reached: a downloaded update that got this far is good (public/js/boot.js)
  if (window.XuperBoot) window.XuperBoot.ok();
  fill(100);
  console.log(`[startup] splash hidden at ${Math.round(performance.now())} ms (done: ${Array.from(done).join(', ') || 'none'})`);
  const el = document.getElementById('xuper-splash');
  if (!el) return;
  // Let the bar reach 100% before fading out
  setTimeout(() => {
    el.classList.add('is-hiding');
    setTimeout(() => el.remove(), 400);
  }, 250);
}

function next(): void {
  if (hidden) return;
  const progress = SCRIPTS_SHARE + TASKS.filter(t => done.has(t.id)).reduce((sum, t) => sum + t.weight, 0);
  fill(progress);
  const pending = TASKS.find(t => !done.has(t.id));
  if (pending) {
    setSplashStatus(pending.text);
    return;
  }
  setSplashStatus('Listo');
  const elapsed = performance.now();
  setTimeout(hideSplash, Math.max(0, MIN_VISIBLE_MS - elapsed));
}

/** Call once the app is mounted: starts the progress and the safety timer */
export function startSplash(): void {
  // index.html (part of the installed package, never replaced by a self-update) wrote the installed version:
  // the version running now is this code's own
  const ver = document.querySelector('#xuper-splash .xs-version');
  if (ver) ver.textContent = `v${__APP_VERSION__}`;
  fill(SCRIPTS_SHARE);
  next();
  setTimeout(hideSplash, Math.max(0, MAX_VISIBLE_MS - performance.now()));
}

export function completeSplashTask(task: SplashTask): void {
  if (done.has(task)) return;
  done.add(task);
  next();
}

/** Decodes images so the first screen shows them at once; resolves after `timeoutMs` at the latest */
export function preloadImages(urls: string[], timeoutMs = 5000): Promise<void> {
  const unique = Array.from(new Set(urls.filter(Boolean)));
  const loads = unique.map(url => new Promise<void>(resolve => {
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode === 'function') img.decode().then(() => resolve(), () => resolve());
      else resolve();
    };
    img.onerror = () => resolve();
    img.src = url;
  }));
  return Promise.race([
    Promise.all(loads).then(() => undefined),
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs))
  ]);
}
