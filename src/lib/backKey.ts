/**
 * One physical press of Back = one step back.
 *
 * A Back held a moment, or a bouncing remote, arrives as many presses. From a fullscreen channel that is leave
 * fullscreen, go to the header, "press again to exit", exit: the app closed instead of going back to the list.
 * No relative imports, so tests can load this file in Node.
 */

/** Two Back events closer than this are the same press (a key repeating, or a bouncing remote) */
export const BACK_MIN_GAP_MS = 200;

/** True when this Back event must be ignored: it repeats a held key, or follows the previous one too closely */
export function dropBack(s: { repeat: boolean; sinceLastMs: number }): boolean {
  return s.repeat || (s.sinceLastMs >= 0 && s.sinceLastMs < BACK_MIN_GAP_MS);
}
