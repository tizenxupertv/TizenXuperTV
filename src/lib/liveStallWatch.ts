/**
 * Live channels that freeze while playing: a Wi-Fi hiccup or a slow CDN empties the buffer and the player often stays
 * on the last frame (or black) until the viewer changes channel. This watches the playing position and, when it has
 * not moved for STALL_MS while playing and online, asks the player service to recover: first a jump to the live
 * edge (hls.js), then a silent reload, and it stops trying after MAX_TRIES in WINDOW_MS so a channel that is really
 * down does not reload forever. No relative imports, so tests can load this file in Node.
 */

export const STALL_MS = 4000;
const CHECK_MS = 1000;
const MAX_TRIES = 3;
const WINDOW_MS = 120_000;

export interface StallWatchOptions {
  /** Position in seconds and paused flag; null when it cannot be read or must not count (offline, seeking) */
  read: () => { t: number; paused: boolean } | null;
  onStall: () => void;
  stallMs?: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => any;
  clearInterval?: (id: any) => void;
}

export function createStallWatch(opts: StallWatchOptions): { stop: () => void } {
  const now = opts.now || (() => Date.now());
  const every = opts.setInterval || ((fn: () => void, ms: number) => setInterval(fn, ms));
  const cancel = opts.clearInterval || ((id: any) => clearInterval(id));
  const stallMs = opts.stallMs ?? STALL_MS;
  let lastT = -1;
  let lastMoveAt = now();

  const id = every(() => {
    const p = opts.read();
    if (!p || p.paused || p.t > lastT + 0.05) {
      if (p) lastT = p.t;
      lastMoveAt = now();
      return;
    }
    if (now() - lastMoveAt >= stallMs) {
      // The recovery gets its own STALL_MS before the next one
      lastMoveAt = now();
      opts.onStall();
    }
  }, CHECK_MS);

  return { stop: () => cancel(id) };
}

/**
 * What to do about a stall, given the times of this channel's earlier recoveries: 'edge' (hls.js jumps to the live
 * edge), 'reload' (tune the channel again) or 'giveup' after MAX_TRIES in WINDOW_MS.
 */
export function stallAction(earlier: number[], at: number, canJumpToEdge: boolean): 'edge' | 'reload' | 'giveup' {
  const recent = earlier.filter(t => at - t < WINDOW_MS);
  if (recent.length >= MAX_TRIES) return 'giveup';
  return recent.length === 0 && canJumpToEdge ? 'edge' : 'reload';
}
