import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RecentChannelsService } from '../src/services/recentChannelsService.ts';
import type { LiveChannel } from '../src/types/channel.ts';

// In-memory localStorage mock for node test runner
const store = new Map<string, string>();
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => Array.from(store.keys())[i] ?? null
  };
}

beforeEach(() => {
  store.clear();
});

test('RecentChannelsService: adds channels and keeps them in MRU order', () => {
  const service = new RecentChannelsService();
  const ch1: LiveChannel = { id: 101, name: 'Canal 1', code: 'c101' };
  const ch2: LiveChannel = { id: 102, name: 'Canal 2', code: 'c102' };

  service.addRecentChannel(ch1);
  service.addRecentChannel(ch2);

  const recents = service.getRecentChannels();
  assert.equal(recents.length, 2);
  assert.equal(recents[0].id, 102);
  assert.equal(recents[1].id, 101);
});

test('RecentChannelsService: tuning an existing channel moves it to the top without duplicates', () => {
  const service = new RecentChannelsService();
  const ch1: LiveChannel = { id: 101, name: 'Canal 1', code: 'c101' };
  const ch2: LiveChannel = { id: 102, name: 'Canal 2', code: 'c102' };

  service.addRecentChannel(ch1);
  service.addRecentChannel(ch2);
  service.addRecentChannel(ch1); // Tune ch1 again

  const recents = service.getRecentChannels();
  assert.equal(recents.length, 2);
  assert.equal(recents[0].id, 101);
  assert.equal(recents[1].id, 102);
});

test('RecentChannelsService: correctly handles channels without code property (undefined code does not drop other channels)', () => {
  const service = new RecentChannelsService();
  const chA: LiveChannel = { id: 1, name: 'Canal A' }; // code undefined
  const chB: LiveChannel = { id: 2, name: 'Canal B' }; // code undefined
  const chC: LiveChannel = { id: 3, name: 'Canal C' }; // code undefined

  service.addRecentChannel(chA);
  service.addRecentChannel(chB);
  service.addRecentChannel(chC);

  const recents = service.getRecentChannels();
  assert.equal(recents.length, 3);
  assert.equal(recents[0].id, 3);
  assert.equal(recents[1].id, 2);
  assert.equal(recents[2].id, 1);
});

test('RecentChannelsService: excludes adult channels', () => {
  const service = new RecentChannelsService();
  const normal: LiveChannel = { id: 101, name: 'Canal Normal' };
  const adult1: LiveChannel = { id: 201, name: 'Playboy TV', categoryName: 'Adultos' };
  const adult2: LiveChannel = { id: 202, name: 'Canal X', categoryName: '+18' };

  service.addRecentChannel(normal);
  service.addRecentChannel(adult1);
  service.addRecentChannel(adult2);

  const recents = service.getRecentChannels();
  assert.equal(recents.length, 1);
  assert.equal(recents[0].id, 101);
});

test('RecentChannelsService: caps at MAX_RECENTS (20)', () => {
  const service = new RecentChannelsService();
  service.clearRecents();
  for (let i = 1; i <= 25; i++) {
    service.addRecentChannel({ id: i, name: `News ${i}` });
  }

  const recents = service.getRecentChannels();
  // News 18 is excluded by isAdultLabel ('18')
  assert.equal(recents.length, 20);
  assert.equal(recents[0].id, 25);
  assert.equal(recents[19].id, 5);
});

test('RecentChannelsService: getPreviousChannel returns actual previous channel comparing string and number ids', () => {
  const service = new RecentChannelsService();
  const ch1: LiveChannel = { id: 101, name: 'Canal 1' };
  const ch2: LiveChannel = { id: 102, name: 'Canal 2' };

  service.addRecentChannel(ch1);
  service.addRecentChannel(ch2);

  // Currently viewing ch2 (number or string id) -> previous should be ch1
  const prev1 = service.getPreviousChannel(102);
  assert.equal(prev1?.id, 101);

  const prev2 = service.getPreviousChannel('102');
  assert.equal(prev2?.id, 101);

  // If object passed
  const prev3 = service.getPreviousChannel({ id: 102, name: 'Canal 2' });
  assert.equal(prev3?.id, 101);

  // If no current passed, returns first
  assert.equal(service.getPreviousChannel()?.id, 102);
});

test('RecentChannelsService: clearRecents empties the list and notifies subscribers', () => {
  const service = new RecentChannelsService();
  let notified = 0;
  service.subscribe(() => notified++);

  service.addRecentChannel({ id: 1, name: 'Canal 1' });
  assert.equal(notified, 1);
  assert.equal(service.getRecentChannels().length, 1);

  service.clearRecents();
  assert.equal(notified, 2);
  assert.equal(service.getRecentChannels().length, 0);
});
