import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DONATE_MOMENT_KEY, MAX_ASKS, MIN_DAYS, MIN_FINISHED, REPEAT_DAYS, SETTLE_MS,
  markAsked, noteFinished, onDonateMoment, playerClosed, playerOpened, readState, shouldAsk, touch,
} from '../src/lib/donateMoment.ts';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000;

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() { return data.size; },
  };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('no request before enough titles were watched to the end', () => {
  const state = { firstUse: T0, finished: MIN_FINISHED - 1, asked: 0, lastAsked: 0 };
  assert.equal(shouldAsk(state, T0 + 30 * DAY), false);
  assert.equal(shouldAsk({ ...state, finished: MIN_FINISHED }, T0 + 30 * DAY), true);
});

test('no request in the first days, however much was watched', () => {
  const state = { firstUse: T0, finished: 50, asked: 0, lastAsked: 0 };
  assert.equal(shouldAsk(state, T0 + MIN_DAYS * DAY - 1), false);
  assert.equal(shouldAsk(state, T0 + MIN_DAYS * DAY), true);
});

test('a "not now" is respected for a month, and the requests stop after the last one', () => {
  const asked = { firstUse: T0, finished: 50, asked: 1, lastAsked: T0 + 10 * DAY };
  assert.equal(shouldAsk(asked, T0 + 10 * DAY + REPEAT_DAYS * DAY - 1), false);
  assert.equal(shouldAsk(asked, T0 + 10 * DAY + REPEAT_DAYS * DAY), true);
  assert.equal(shouldAsk({ ...asked, asked: MAX_ASKS }, T0 + 5000 * DAY), false);
});

test('the days count from the first start on this TV, and a later start does not reset them', () => {
  const store = memoryStore();
  touch(T0, store);
  touch(T0 + 3 * DAY, store);
  assert.equal(readState(T0 + 4 * DAY, store).firstUse, T0);
});

test('finished titles and requests shown are kept between starts', () => {
  const store = memoryStore();
  touch(T0, store);
  noteFinished(T0 + DAY, store);
  noteFinished(T0 + 2 * DAY, store);
  markAsked(T0 + 9 * DAY, store);
  assert.deepEqual(readState(T0 + 10 * DAY, store), { firstUse: T0, finished: 2, asked: 1, lastAsked: T0 + 9 * DAY });
});

test('a damaged saved state starts over instead of failing', () => {
  const store = memoryStore();
  store.setItem(DONATE_MOMENT_KEY, '{not json');
  assert.deepEqual(readState(T0, store), { firstUse: T0, finished: 0, asked: 0, lastAsked: 0 });
  store.setItem(DONATE_MOMENT_KEY, JSON.stringify({ firstUse: 'x', finished: -4, asked: null }));
  assert.deepEqual(readState(T0, store), { firstUse: T0, finished: 0, asked: 0, lastAsked: 0 });
});

test('the request comes when the player closes after a title ended, not while the next episode opens', async () => {
  const store = memoryStore();
  store.setItem(DONATE_MOMENT_KEY, JSON.stringify({ firstUse: T0, finished: MIN_FINISHED - 1, asked: 0, lastAsked: 0 }));
  const now = () => T0 + 20 * DAY;
  let fired = 0;
  const stop = onDonateMoment(() => fired++);

  // An episode ends and the next one opens right away: nothing in between
  playerOpened();
  noteFinished(now(), store);
  playerClosed(now, store);
  playerOpened();
  await wait(SETTLE_MS + 200);
  assert.equal(fired, 0);

  // The viewer leaves the player: now
  playerClosed(now, store);
  await wait(SETTLE_MS + 200);
  assert.equal(fired, 1);

  // Closing a player in which nothing ended asks nothing
  playerOpened();
  playerClosed(now, store);
  await wait(SETTLE_MS + 200);
  assert.equal(fired, 1);
  stop();
});

test('closing the player before the conditions are met asks nothing', async () => {
  const store = memoryStore();
  touch(T0, store);
  let fired = 0;
  const stop = onDonateMoment(() => fired++);
  playerOpened();
  noteFinished(T0 + DAY, store);
  playerClosed(() => T0 + DAY, store);
  await wait(SETTLE_MS + 200);
  assert.equal(fired, 0);
  stop();
});
