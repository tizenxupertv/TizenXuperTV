/**
 * When to ask for a donation: after the viewer has got something out of the app, not on arrival.
 *
 * The request is shown once the player closes, when enough titles have been watched to the end over enough days. A
 * "not now" is respected for a month, and the request is made a few times in total and then never again. Nothing here
 * knows whether the viewer donated: the limits are what keeps it from nagging.
 */
import { saveItem } from './safeStorage.ts';

export const DONATE_MOMENT_KEY = 'xuper_donate_moment_v1';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Titles watched to the end before the first request */
export const MIN_FINISHED = 5;
/** Days of use before the first request */
export const MIN_DAYS = 7;
/** Days between one request and the next */
export const REPEAT_DAYS = 30;
/** Requests in total */
export const MAX_ASKS = 3;

export interface DonateMomentState {
  /** When this TV first counted (ms) */
  firstUse: number;
  /** Titles watched to the end */
  finished: number;
  /** Requests shown */
  asked: number;
  /** When the last request was shown (ms), 0 when none */
  lastAsked: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function defaultStore(): Store | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined; // storage blocked
  }
}

const count = (v: unknown): number => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function readState(now: number, store: Store | undefined = defaultStore()): DonateMomentState {
  let saved: Partial<DonateMomentState> = {};
  try {
    const raw = store ? store.getItem(DONATE_MOMENT_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') saved = parsed;
  } catch {
    saved = {};
  }
  return {
    firstUse: count(saved.firstUse) || now,
    finished: count(saved.finished),
    asked: count(saved.asked),
    lastAsked: count(saved.lastAsked),
  };
}

function writeState(state: DonateMomentState, store: Store | undefined = defaultStore()): void {
  saveItem(DONATE_MOMENT_KEY, JSON.stringify(state), store);
}

/** Whether a request is due for this state */
export function shouldAsk(state: DonateMomentState, now: number): boolean {
  if (state.asked >= MAX_ASKS) return false;
  if (state.finished < MIN_FINISHED) return false;
  if (now - state.firstUse < MIN_DAYS * DAY_MS) return false;
  if (state.lastAsked > 0 && now - state.lastAsked < REPEAT_DAYS * DAY_MS) return false;
  return true;
}

/** Starts the count of days on this TV; call once at startup */
export function touch(now: number = Date.now(), store: Store | undefined = defaultStore()): void {
  let has = false;
  try {
    has = !!store && store.getItem(DONATE_MOMENT_KEY) !== null;
  } catch {
    has = false;
  }
  if (!has) writeState(readState(now, store), store);
}

// --- The moment: a title ended and the player is gone ------------------------------------------------------------

let openPlayers = 0;
let finishedSinceAsk = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** How long after the player closes: a next episode opens its own player within this time */
export const SETTLE_MS = 1500;

/** A title (not a trailer) played to its end */
export function noteFinished(now: number = Date.now(), store: Store | undefined = defaultStore()): void {
  const state = readState(now, store);
  writeState({ ...state, finished: state.finished + 1 }, store);
  finishedSinceAsk = true;
}

export function playerOpened(): void {
  openPlayers++;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** The player closed: when a title ended in it and no other player took its place, the request may be due */
export function playerClosed(now: () => number = Date.now, store: Store | undefined = defaultStore()): void {
  openPlayers = Math.max(0, openPlayers - 1);
  if (openPlayers > 0 || !finishedSinceAsk) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (openPlayers > 0 || !finishedSinceAsk) return;
    finishedSinceAsk = false;
    if (shouldAsk(readState(now(), store), now())) listeners.forEach(fn => fn());
  }, SETTLE_MS);
}

/** The request was put on screen */
export function markAsked(now: number = Date.now(), store: Store | undefined = defaultStore()): void {
  const state = readState(now, store);
  writeState({ ...state, asked: state.asked + 1, lastAsked: now }, store);
}

/** Calls [fn] when the request is due; returns how to stop listening */
export function onDonateMoment(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
