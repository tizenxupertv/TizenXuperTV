/**
 * Seeking with the remote: a press jumps 10 s; holding the key makes the jumps grow (30 s, 1 min, 2 min, 5 min) so a
 * long film can be crossed in a few seconds. Key repeats are thinned out to one jump every REPEAT_GAP_MS, whatever the
 * remote's repeat rate. Modeled on titlog/telegram-tizen's player (MIT).
 * No relative imports, so test/seekAccel.test.ts can load this file in Node.
 */
export const SEEK_STEPS: Array<{ afterMs: number; seconds: number }> = [
  { afterMs: 0, seconds: 10 },
  { afterMs: 1000, seconds: 30 },
  { afterMs: 3000, seconds: 60 },
  { afterMs: 5000, seconds: 120 },
  { afterMs: 8000, seconds: 300 }
];
export const REPEAT_GAP_MS = 120;

/** Jump size after the key has been held `heldMs` */
export function stepFor(heldMs: number): number {
  let seconds = SEEK_STEPS[0].seconds;
  for (const s of SEEK_STEPS) if (heldMs >= s.afterMs) seconds = s.seconds;
  return seconds;
}

/** One hold of ◄ or ►: `press` returns the signed jump in seconds, or 0 when a repeat comes too soon */
export function createSeekHold() {
  let hold: { dir: number; since: number; last: number } | null = null;
  return {
    press(dir: 1 | -1, isRepeat: boolean, now: number): number {
      if (!isRepeat || !hold || hold.dir !== dir) {
        hold = { dir, since: now, last: now };
        return dir * SEEK_STEPS[0].seconds;
      }
      if (now - hold.last < REPEAT_GAP_MS) return 0;
      hold.last = now;
      return dir * stepFor(now - hold.since);
    },
    release(): void {
      hold = null;
    }
  };
}

/** "+10 s", "−1:30", "+12:00" for the on-screen seek feedback */
export function formatSkip(seconds: number): string {
  const sign = seconds < 0 ? '−' : '+';
  const abs = Math.abs(Math.round(seconds));
  if (abs < 60) return `${sign}${abs} s`;
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${s < 10 ? '0' : ''}${s}`;
}
