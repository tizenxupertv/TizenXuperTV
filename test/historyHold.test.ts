import { test } from 'node:test';
import assert from 'node:assert/strict';

// A browser-like localStorage, in place before the service loads (it reads it at import time)
const data: Record<string, string> = {};
const storage = {
  get length() { return Object.keys(data).length; },
  key: (i: number) => Object.keys(data)[i] ?? null,
  getItem: (k: string) => (k in data ? data[k] : null),
  setItem: (k: string, v: string) => { data[k] = String(v); },
  removeItem: (k: string) => { delete data[k]; }
};
(globalThis as any).localStorage = storage;
(globalThis as any).window = { localStorage: storage, addEventListener() {} };

const { historyService } = await import('../src/services/historyService.ts');
const movie = { id: 'm1', title: 'Película' } as any;
const position = () => historyService.getEntry('m1')?.position;

test('while held, every save is stored but the screens are told once, on release', () => {
  let told = 0;
  const stop = historyService.subscribe(() => told++);

  historyService.savePlayback(movie, 10, 6000);
  assert.equal(told, 1);

  const release = historyService.holdNotifications();
  historyService.savePlayback(movie, 25, 6000);
  historyService.savePlayback(movie, 40, 6000);
  assert.equal(told, 1, 'no redraw while the player is open');
  assert.equal(position(), 40, 'the position is saved all the same');

  release();
  assert.equal(told, 2, 'one redraw for all the saves');
  release();
  assert.equal(told, 2, 'releasing twice does nothing');

  historyService.savePlayback(movie, 55, 6000);
  assert.equal(told, 3, 'back to normal after the release');
  stop();
});

test('a hold with no save in it tells nobody, and two holds wait for the last release', () => {
  let told = 0;
  const stop = historyService.subscribe(() => told++);

  historyService.holdNotifications()();
  assert.equal(told, 0);

  const first = historyService.holdNotifications();
  const second = historyService.holdNotifications();
  historyService.savePlayback(movie, 70, 6000);
  first();
  assert.equal(told, 0, 'the other player is still open');
  second();
  assert.equal(told, 1);
  stop();
});
