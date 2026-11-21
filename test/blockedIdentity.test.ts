import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortalClient } from './helpers/portalClient.ts';

const IDENTITY_KEY = 'xuper_magis_device_v1';

/**
 * A portal that refuses for good the user of some device identities (aaa100028 on every call), as one TV saw on
 * 2026-11-21. The relay is down, so only the direct path counts.
 */
function portal(refuse: (identity: string, nth: number) => boolean) {
  const stored: Record<string, string> = {};
  const identities: string[] = [];
  let activeIdentity = '';
  const dataCalls: string[] = [];
  const loaded = loadPortalClient(req => {
    if (/workers\.dev/.test(req.url)) return req.fail();
    const endpoint = req.url.split('/api/portalCore/')[1] || '';
    if (endpoint === 'v3/snToken') return req.respond(200, JSON.stringify({ returnCode: '0', data: { snToken: 's' } }));
    if (endpoint === 'v8/active') {
      // The session belongs to the identity stored when it was made
      activeIdentity = JSON.parse(stored[IDENTITY_KEY]).androidId;
      if (!identities.includes(activeIdentity)) identities.push(activeIdentity);
      return req.respond(200, JSON.stringify({ returnCode: '0', data: { userId: activeIdentity, userToken: 't' } }));
    }
    dataCalls.push(activeIdentity);
    if (refuse(activeIdentity, identities.indexOf(activeIdentity))) {
      return req.respond(200, JSON.stringify({ returnCode: 'aaa100028', errorMessage: 'session' }));
    }
    return req.respond(200, JSON.stringify({ returnCode: '0', data: { assetData: { name: 'Serie', contentId: 'x1', programType: 'teleplay' } } }));
  }, {
    localStorage: {
      getItem: (k: string) => (k in stored ? stored[k] : null),
      setItem: (k: string, v: string) => { stored[k] = String(v); },
      removeItem: (k: string) => { delete stored[k]; }
    },
    fetch: () => Promise.reject(new Error('no static files'))
  });
  return { ...loaded, identities, dataCalls, stored };
}

function detail(client: any, advance: (ms: number) => void) {
  const out: any[] = [];
  client.detail('x1', (err: any, res: any) => out.push(err || res));
  for (let i = 0; i < 60; i++) advance(300);
  return out;
}

test('a device identity whose fresh sessions the portal refuses is replaced, and the call goes through', () => {
  const { client, advance, identities } = portal((_id, nth) => nth === 0);
  const out = detail(client, advance);
  assert.equal(out.length, 1);
  assert.ok(!(out[0] instanceof Error), `answered, not ${out[0] && out[0].portalCode}`);
  assert.equal(identities.length, 2, 'a second identity was made');
  // Later calls keep the new identity: no new one per call
  detail(client, advance);
  assert.equal(identities.length, 2);
});

test('when every identity is refused, the TV changes identity only once per run', () => {
  const { client, advance, identities } = portal(() => true);
  const first = detail(client, advance);
  assert.equal(first.length, 1);
  assert.equal(first[0].portalCode, 'aaa100028');
  detail(client, advance);
  detail(client, advance);
  assert.equal(identities.length, 2, 'one renewal, never a loop');
});
