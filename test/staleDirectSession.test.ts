import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortalClient } from './helpers/portalClient.ts';

/**
 * A TV that kept the direct session of an earlier run: the portal answers it portal200001 on every call and host,
 * while a new session works (seen on 2026-11-21). The relay is down, so only the direct path counts.
 */
function portal(newSessionWorks: boolean) {
  const stored: Record<string, string> = {
    xuper_magis_direct_v1: JSON.stringify({ sn: 'old-sn', snToken: 'old', userId: 'old-user', userToken: 'old-token', portalCode: 'masnew' })
  };
  let minted = 0;
  const loaded = loadPortalClient(req => {
    if (/workers\.dev/.test(req.url)) return req.fail();
    const endpoint = req.url.split('/api/portalCore/')[1] || '';
    if (endpoint === 'v3/snToken') return req.respond(200, JSON.stringify({ returnCode: '0', data: { snToken: 's' } }));
    if (endpoint === 'v8/active') {
      minted++;
      return req.respond(200, JSON.stringify({ returnCode: '0', data: { userId: 'new-user', userToken: 't' } }));
    }
    if (!minted || !newSessionWorks) return req.respond(200, JSON.stringify({ returnCode: 'portal200001', errorMessage: 'version' }));
    return req.respond(200, JSON.stringify({ returnCode: '0', data: { assetData: { name: 'Serie', contentId: 'x1', programType: 'teleplay' } } }));
  }, {
    localStorage: {
      getItem: (k: string) => (k in stored ? stored[k] : null),
      setItem: (k: string, v: string) => { stored[k] = String(v); },
      removeItem: (k: string) => { delete stored[k]; }
    },
    fetch: () => Promise.reject(new Error('no static files'))
  });
  return { ...loaded, minted: () => minted, stored };
}

function detail(client: any, advance: (ms: number) => void) {
  const out: any[] = [];
  client.detail('x1', (err: any, res: any) => out.push(err || res));
  for (let i = 0; i < 80; i++) advance(300);
  return out;
}

test('a saved direct session answered portal200001 is replaced by a new one, and the call goes through', () => {
  const { client, advance, minted, stored } = portal(true);
  const out = detail(client, advance);
  assert.equal(out.length, 1);
  assert.ok(!(out[0] instanceof Error), `answered, not ${out[0] && out[0].portalCode}`);
  assert.equal(minted(), 1);
  assert.equal(JSON.parse(stored.xuper_magis_direct_v1).userId, 'new-user', 'the new session is saved');
  detail(client, advance);
  assert.equal(minted(), 1, 'no new session per call');
});

test('portal200001 on a session made in this run is not renewed again', () => {
  const { client, advance, minted } = portal(false);
  detail(client, advance);
  detail(client, advance);
  assert.equal(minted(), 1, 'one renewal of the saved session, never a loop');
});
