import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function loadCatalogSession(response: () => Promise<unknown>) {
  const values = new Map<string, string>();
  const context: Record<string, unknown> = {
    Date,
    Uint8Array,
    Number,
    Promise,
    Error,
    console,
    localStorage: {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value)
    },
    crypto: {
      getRandomValues: (bytes: Uint8Array) => {
        for (let index = 0; index < bytes.length; index++) bytes[index] = index + 1;
        return bytes;
      }
    },
    XuperServer: { request: response }
  };
  context.window = context;
  vm.runInNewContext(
    readFileSync(new URL('../public/js/xuper-catalog-session.js', import.meta.url), 'utf8'),
    context
  );
  return { context: context as typeof context & { XuperCatalogSession: { acquire(token?: string): Promise<any> } }, values };
}

test('the authorized catalog-session bridge uses one stable local TV id and reuses a valid grant', async () => {
  const calls: Array<{ deviceId: string }> = [];
  const { context, values } = loadCatalogSession(async (_path: string, body: { deviceId: string }) => {
    calls.push(body);
    return {
      session: { sn: 'sn', userId: 'user', userToken: 'token' },
      expiresAt: Date.now() + 60_000
    };
  });

  const first = await context.XuperCatalogSession.acquire();
  const second = await context.XuperCatalogSession.acquire();

  assert.deepEqual(first, second);
  assert.equal(calls.length, 1);
  assert.match(calls[0].deviceId, /^[a-f0-9]{32}$/);
  assert.equal(values.get('xuper_catalog_device_v1'), calls[0].deviceId);
});

test('the catalog-session bridge rejects incomplete grants', async () => {
  const { context } = loadCatalogSession(async () => ({
    session: { sn: 'sn', userId: 'user' },
    expiresAt: Date.now() + 60_000
  }));

  await assert.rejects(() => context.XuperCatalogSession.acquire(), /Autorización de catálogo no válida/);
});
