import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDeviceResources, resourcesLevel, resourcesLine } from '../src/lib/deviceResources.ts';

const MB = 1024 * 1024;

function fakeTv(opts: { availMb: number; status?: string; cpu?: number }) {
  return {
    performance: { now: () => 42 * 60000, memory: { usedJSHeapSize: 120 * MB, jsHeapSizeLimit: 1024 * MB } },
    tizen: {
      systeminfo: {
        getTotalMemory: () => 1536 * MB,
        getAvailableMemory: () => opts.availMb * MB,
        getPropertyValue(name: string, ok: (v: any) => void) {
          if (name === 'MEMORY') ok({ status: opts.status || 'NORMAL' });
          else if (name === 'CPU') ok({ load: opts.cpu ?? 0.35 });
          else if (name === 'STORAGE') ok({ units: [{ type: 'INTERNAL', capacity: 4096 * MB, availableCapacity: 1229 * MB }] });
        }
      }
    }
  };
}

test('a TV reports its memory, CPU, storage and the app\'s own memory', async () => {
  const r = await readDeviceResources(fakeTv({ availMb: 412 }));
  assert.deepEqual(
    { ...r },
    { uptimeMin: 42, appMb: 120, appLimitMb: 1024, memTotalMb: 1536, memAvailMb: 412, memStatus: 'NORMAL', cpuPct: 35, storageFreeMb: 1229, storageTotalMb: 4096 }
  );
  assert.equal(resourcesLevel(r), 'ok');
  assert.equal(
    resourcesLine(r),
    'RAM libre 412 MB de 1,5 GB (NORMAL) · app 120/1024 MB · CPU 35 % · almacenamiento libre 1,2 GB de 4,0 GB · abierta hace 42 min'
  );
});

test('a TV short of memory is flagged', async () => {
  assert.equal(resourcesLevel(await readDeviceResources(fakeTv({ availMb: 180 }))), 'warn');
  assert.equal(resourcesLevel(await readDeviceResources(fakeTv({ availMb: 60 }))), 'bad');
  assert.equal(resourcesLevel(await readDeviceResources(fakeTv({ availMb: 900, status: 'WARNING' }))), 'warn');
});

test('a systeminfo that refuses or never answers does not hold the check up', async () => {
  const silent = { performance: { now: () => 0 }, tizen: { systeminfo: {
    getTotalMemory() { throw new Error('denied'); },
    getAvailableMemory() { throw new Error('denied'); },
    getPropertyValue() { /* never calls back */ }
  } } };
  const started = Date.now();
  const r = await readDeviceResources(silent);
  assert.ok(Date.now() - started < 3000, 'gives up on slow properties');
  assert.equal(r.memAvailMb, undefined);
  assert.equal(resourcesLevel(r), '');
  assert.equal(resourcesLine(r), 'abierta hace 0 min');
});

test('a browser without Tizen gives what it has', async () => {
  const r = await readDeviceResources({ performance: { now: () => 0 }, navigator: { deviceMemory: 8 } });
  assert.equal(r.memTotalMb, 8192);
  assert.equal(resourcesLine(r), 'RAM 8,0 GB · abierta hace 0 min');
});
