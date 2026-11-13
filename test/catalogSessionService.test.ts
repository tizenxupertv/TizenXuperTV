import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogSessionService, type StorageLike } from '../src/services/catalogSessionService.ts';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: key => data.get(key) || null,
    setItem: (key, value) => data.set(key, value)
  };
}

test('catalog session creates one stable device id and keeps the lease only in memory', async () => {
  let now = 1_000_000;
  const storage = memoryStorage();
  const calls: Array<{ deviceId: string; reason: string }> = [];
  const service = createCatalogSessionService({
    acquire: async input => {
      calls.push(input);
      return { expiresAt: now + 10 * 60_000 };
    }
  }, {
    storage,
    randomBytes: size => Uint8Array.from({ length: size }, (_, index) => index + 1),
    now: () => now
  });

  const first = await service.ensure();
  const second = await service.ensure();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].reason, 'initial');
  assert.match(calls[0].deviceId, /^[a-f0-9]{32}$/);
  assert.equal(service.deviceId(), calls[0].deviceId);
  assert.equal(first.expiresAt, second.expiresAt);
  assert.deepEqual([...storage.data.keys()], ['xuper_catalog_device_v1']);
});

test('catalog session renews before expiry and rejects an invalid lease', async () => {
  let now = 2_000_000;
  const storage = memoryStorage();
  let calls = 0;
  const service = createCatalogSessionService({
    acquire: async () => {
      calls++;
      return { expiresAt: now + (calls === 1 ? 120_000 : 180_000) };
    }
  }, {
    storage,
    randomBytes: size => new Uint8Array(size),
    now: () => now
  });

  await service.ensure();
  now += 70_000;
  await service.ensure();
  assert.equal(calls, 2);
  assert.equal(service.state().ready, true);

  const invalid = createCatalogSessionService({ acquire: async () => ({ expiresAt: now + 1_000 }) }, {
    storage: memoryStorage(),
    randomBytes: size => new Uint8Array(size),
    now: () => now
  });
  await assert.rejects(() => invalid.ensure(), /invalid catalog session/);
});
