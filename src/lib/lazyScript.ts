/**
 * Scripts the app loads when it needs them instead of at every start.
 *
 * Shaka Player (664 KB) is only used by the DASH signals of Deportes, yet it was parsed on every launch. It is no
 * longer in the start list; the first DASH signal loads it from here.
 *
 * Where the file is depends on how the app is running:
 *  - from the installed package: js/shaka-player.compiled.js on disk;
 *  - from a self-update bundle (public/js/boot.js): inside the stored bundle. A TV installed before Shaka existed
 *    has no copy on disk, which is why the bundle keeps carrying it (tools/update-release.mjs, LAZY_FILES).
 * Both are tried, the likelier one first.
 */
export const SHAKA_PATH = 'js/shaka-player.compiled.js';

type Win = typeof window & { shaka?: any; XuperBoot?: any };

function inject(src: string): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => resolve(true);
      el.onerror = () => resolve(false);
      document.body.appendChild(el);
    } catch {
      resolve(false);
    }
  });
}

/** The text of a file of the stored self-update bundle, or null */
function fromBundle(path: string): Promise<string | null> {
  return new Promise(resolve => {
    const boot = (window as Win).XuperBoot;
    if (!boot || !boot.store || typeof boot.store.read !== 'function') return resolve(null);
    try {
      boot.store.read((_meta: unknown, bundle: any) => {
        const text = bundle && bundle.files ? bundle.files[path] : null;
        resolve(typeof text === 'string' && text ? text : null);
      });
    } catch {
      resolve(null);
    }
  });
}

async function injectFromBundle(path: string): Promise<boolean> {
  const text = await fromBundle(path);
  if (!text) return false;
  let url = '';
  try {
    url = URL.createObjectURL(new Blob([text], { type: 'application/javascript' }));
  } catch {
    return false;
  }
  const ok = await inject(url);
  try { URL.revokeObjectURL(url); } catch { /* nothing to free */ }
  return ok;
}

/** True when the app is running the code of a self-update bundle rather than the installed package */
export function runsFromBundle(info: { running?: string; packaged?: string } | null | undefined): boolean {
  return !!info && !!info.running && info.running !== info.packaged;
}

let shakaLoading: Promise<boolean> | null = null;

/** Loads Shaka Player once; resolves to whether window.shaka is usable. A failed load can be tried again */
export function loadShaka(): Promise<boolean> {
  const w = window as Win;
  if (w.shaka && w.shaka.Player) return Promise.resolve(true);
  if (shakaLoading) return shakaLoading;
  const bundleFirst = runsFromBundle(w.XuperBoot && w.XuperBoot.info);
  const ways = bundleFirst
    ? [() => injectFromBundle(SHAKA_PATH), () => inject(SHAKA_PATH)]
    : [() => inject(SHAKA_PATH), () => injectFromBundle(SHAKA_PATH)];
  const usable = () => !!(w.shaka && w.shaka.Player);
  shakaLoading = ways[0]()
    .then(() => (usable() ? true : ways[1]().then(usable)))
    .then(ok => {
      if (!ok) shakaLoading = null;
      return ok;
    });
  return shakaLoading;
}
