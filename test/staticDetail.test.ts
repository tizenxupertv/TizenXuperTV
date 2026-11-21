import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortalClient } from './helpers/portalClient.ts';

const ASSET = {
  assetData: {
    contentId: 'SERIE1',
    name: 'Una serie',
    programType: 'teleplay',
    volumnCount: '2',
    simpleProgramList: [
      { contentId: 'ep1', name: 'Capítulo 1', seriesNumber: 1, quality: '1080p,720p' },
      { contentId: 'ep2', name: 'Capítulo 2', seriesNumber: 2, quality: '1080p,720p' }
    ],
    sameSeasonSeriesList: [{ contentId: 'S1', seasonNumber: 1, name: 'T1' }]
  }
};

/** A fetch that serves the published details of the given titles and 404 for the rest */
function staticFetch(published: Record<string, unknown>, asked: string[]) {
  return (url: string) => {
    asked.push(url);
    const id = decodeURIComponent(url.split('/').pop()!.replace(/\.json$/, ''));
    const body = published[id];
    return Promise.resolve({ ok: !!body, status: body ? 200 : 404, json: () => Promise.resolve(body) });
  };
}

const flush = async (advance: (ms: number) => void) => {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setImmediate(r));
    advance(300);
  }
};

test('a title the Pi published opens without a session or a portal call', async () => {
  const asked: string[] = [];
  const { client, requests, advance } = loadPortalClient(req => req.fail(), { fetch: staticFetch({ SERIE1: ASSET }, asked) });
  const answers: any[] = [];
  client.detail('SERIE1', (err: any, data: any) => answers.push({ err, data }));
  await flush(advance);

  assert.equal(answers.length, 1);
  assert.equal(answers[0].err, null);
  assert.deepEqual(Array.from(answers[0].data.episodes, (e: any) => e.id), ['ep1', 'ep2']);
  assert.equal(answers[0].data.seasons.length, 1);
  assert.equal(requests.length, 0, 'no snToken, no getItemData');
  assert.match(asked[0], /^https:\/\/tizenxuper-img\.pages\.dev\/data\/detail\/SERIE1\.json$/);
});

test('the first See-all pages of a home row come from the Pi; later pages and adult columns from the portal', async () => {
  const asked: string[] = [];
  const page = { items: [{ id: 'T1', title: 'Uno', poster: 'https://x.invalid/p.jpg' }, { id: 'T2', title: 'Dos' }], total: 120 };
  const fetchFake = (url: string) => {
    asked.push(url);
    const ok = /\/data\/column\/555-[12]\.json$/.test(url);
    return Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(page) });
  };
  const portal: string[] = [];
  const { client, advance } = loadPortalClient(req => {
    const endpoint = req.url.split('/api/portalCore/')[1] || '';
    portal.push(endpoint);
    if (endpoint === 'v3/snToken') return req.respond(200, JSON.stringify({ returnCode: '0', data: { snToken: 's' } }));
    if (endpoint === 'v8/active') return req.respond(200, JSON.stringify({ returnCode: '0', data: { userId: 'u', userToken: 't' } }));
    if (endpoint === 'v3/getShelveData') return req.respond(200, JSON.stringify({ returnCode: '0', data: { assetList: [], assetListTotalSize: 0 } }));
    req.fail();
  }, { fetch: fetchFake });

  const first: any[] = [];
  client.columnPage(555, 1, 42, (err: any, res: any) => first.push({ err, res }));
  await flush(advance);
  assert.equal(first[0].err, null);
  assert.deepEqual(Array.from(first[0].res.items, (i: any) => i.id), ['T1', 'T2']);
  assert.equal(first[0].res.total, 120);
  assert.equal(portal.length, 0, 'page 1 asked nothing of the portal');

  client.columnPage(555, 3, 42, () => {});
  await flush(advance);
  assert.ok(portal.includes('v3/getShelveData'), 'page 3 goes to the portal');
  assert.ok(!asked.some(u => /555-3/.test(u)), 'and is not looked for on the Pi');

  const before = asked.length;
  client.columnPage(555, 1, 42, () => {}, { restricted: true });
  await flush(advance);
  assert.equal(asked.length, before, 'an adult column is never read from the public site');
});

test('a title the Pi did not publish goes to the portal as before', async () => {
  const asked: string[] = [];
  const portal: string[] = [];
  const { client, advance } = loadPortalClient(req => {
    const endpoint = req.url.split('/api/portalCore/')[1] || '';
    portal.push(endpoint);
    if (endpoint === 'v3/snToken') return req.respond(200, JSON.stringify({ returnCode: '0', data: { snToken: 's' } }));
    if (endpoint === 'v8/active') return req.respond(200, JSON.stringify({ returnCode: '0', data: { userId: 'u', userToken: 't' } }));
    if (endpoint === 'v4/getItemData') return req.respond(200, JSON.stringify({ returnCode: '0', data: ASSET }));
    req.fail();
  }, { fetch: staticFetch({}, asked) });
  const answers: any[] = [];
  client.detail('OTRA', (err: any, data: any) => answers.push({ err, data }));
  await flush(advance);

  assert.equal(asked.length, 1, 'the static copy is tried first');
  assert.ok(portal.includes('v4/getItemData'), 'then the portal');
  assert.equal(answers.length, 1);
  assert.equal(answers[0].err, null);
  assert.equal(answers[0].data.episodes.length, 2);
});
