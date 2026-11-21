import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStallWatch, stallAction } from '../src/lib/liveStallWatch.ts';

/** A clock the test moves, with the interval the watch registers */
function fakeClock() {
  let now = 0;
  let tick: (() => void) | null = null;
  return {
    now: () => now,
    setInterval: (fn: () => void) => { tick = fn; return 1; },
    clearInterval: () => { tick = null; },
    advance(ms: number) {
      for (let t = 0; t < ms; t += 1000) { now += 1000; if (tick) tick(); }
    },
    get running() { return tick !== null; }
  };
}

test('a picture that keeps moving is left alone', () => {
  const clock = fakeClock();
  let t = 0;
  const stalls: number[] = [];
  createStallWatch({ read: () => ({ t: (t += 1), paused: false }), onStall: () => stalls.push(clock.now()), ...clock });
  clock.advance(30_000);
  assert.deepEqual(stalls, []);
});

test('a picture frozen for 4 s is reported once, then given time to recover', () => {
  const clock = fakeClock();
  const stalls: number[] = [];
  createStallWatch({ read: () => ({ t: 10, paused: false }), onStall: () => stalls.push(clock.now()), ...clock });
  // The first check learns the position (1 s); from there it has to stay still for 4 s
  clock.advance(4000);
  assert.deepEqual(stalls, [], 'not before 4 s still');
  clock.advance(1000);
  assert.deepEqual(stalls, [5000]);
  clock.advance(3000);
  assert.deepEqual(stalls, [5000], 'the recovery gets its own 4 s');
  clock.advance(1000);
  assert.deepEqual(stalls, [5000, 9000]);
});

test('paused, offline or unreadable players are not stalls', () => {
  const clock = fakeClock();
  const stalls: number[] = [];
  let state: { t: number; paused: boolean } | null = { t: 5, paused: true };
  createStallWatch({ read: () => state, onStall: () => stalls.push(clock.now()), ...clock });
  clock.advance(20_000);
  state = null;
  clock.advance(20_000);
  assert.deepEqual(stalls, []);
  // Playing again from the same frame: the 4 s count starts now, not from when it was paused
  state = { t: 5, paused: false };
  clock.advance(3000);
  assert.deepEqual(stalls, []);
});

test('stop ends the watch', () => {
  const clock = fakeClock();
  const watch = createStallWatch({ read: () => ({ t: 1, paused: false }), onStall: () => {}, ...clock });
  watch.stop();
  assert.equal(clock.running, false);
});

test('recovery goes live edge first, then reload, then gives up within two minutes', () => {
  assert.equal(stallAction([], 0, true), 'edge', 'hls.js can jump to the live edge');
  assert.equal(stallAction([], 0, false), 'reload', 'AVPlay has no live edge to jump to');
  assert.equal(stallAction([1000], 6000, true), 'reload');
  assert.equal(stallAction([1000, 6000], 12_000, true), 'reload');
  assert.equal(stallAction([1000, 6000, 12_000], 20_000, true), 'giveup', 'three recoveries in two minutes: stop');
  assert.equal(stallAction([1000, 6000, 12_000], 200_000, true), 'edge', 'old ones no longer count');
});
