/**
 * `display` of a tab pane that stays mounted while hidden (the TV tab keeps its player).
 *
 * `display: contents` exists since Chromium 65: Tizen 4.0 (Chromium 56) and 5.0 (Chromium 63) reject it, and an
 * inline style set to a value the engine rejects is ignored, so a pane once hidden with `none` stayed hidden. The
 * live <video> inside measured 0x0 while the channel played: sound with no picture. Those engines get `block`,
 * which lays out the same here (the pane's children are absolutely positioned).
 * No relative imports, so tests can load this file in Node.
 */

/** The engine understands `display: contents` (CSS.supports exists on every Tizen engine) */
export function supportsDisplayContents(css: any = typeof CSS !== 'undefined' ? CSS : undefined): boolean {
  try {
    return !!(css && typeof css.supports === 'function' && css.supports('display', 'contents'));
  } catch {
    return false;
  }
}

export function paneDisplay(visible: boolean, supportsContents: boolean): 'contents' | 'block' | 'none' {
  if (!visible) return 'none';
  return supportsContents ? 'contents' : 'block';
}
