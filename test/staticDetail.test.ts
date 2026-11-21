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
