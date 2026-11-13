/**
 * Which signal to try after one failed: the next in the list that has not failed in this session, going on from the
 * one that failed and around to the start. -1 when every other signal has failed too.
 * No imports, so tests can load this file in Node.
 */
export function nextSignal(count: number, current: number, failed: { has(i: number): boolean }): number {
  for (let step = 1; step < count; step++) {
    const i = (current + step) % count;
    if (!failed.has(i)) return i;
  }
  return -1;
}

/** How long the failed signal's card shows before the next signal is tried by itself */
export const AUTO_NEXT_MS = 4000;
