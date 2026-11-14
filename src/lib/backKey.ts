/**
 * One physical press of Back = one step back.
 *
 * On a TV the bridge (public/js/tizen-bridge.js) re-sends the remote's Back as a new key event, which loses `repeat`:
 * a Back held a moment arrived as many separate presses. From a fullscreen channel that is hide the bar, leave
 * fullscreen, go to the header, "press again to exit", exit: the app closed instead of going back to the list.
 * No relative imports, so tests can load this file in Node.
 */

/** Two Back events closer than this are the same press (a key repeating, or a bouncing remote) */
export const BACK_MIN_GAP_MS = 200;

/** True when this Back event must be ignored: it repeats a held key, or follows the previous one too closely */
export function dropBack(s: { repeat: boolean; sinceLastMs: number }): boolean {
  return s.repeat || (s.sinceLastMs >= 0 && s.sinceLastMs < BACK_MIN_GAP_MS);
}
