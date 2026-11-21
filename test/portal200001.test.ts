import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortalClient } from './helpers/portalClient.ts';

test('an endpoint every host answers with portal200001 goes through the relay for that call only', () => {
  const urls: string[] = [];
  const { client, advance } = loadPortalClient(req => {
    urls.push(req.url);
    const viaRelay = /workers\.dev/.test(req.url);
    const endpoint = req.url.split('/api/portalCore/')[1] || '';
    if (endpoint === 'v3/snToken') return req.respond(200, JSON.stringify({ returnCode: '0', data: { snToken: 's' } }));
    if (endpoint === 'v8/active') return req.respond(200, JSON.stringify({ returnCode: '0', data: { userId: 'u', userToken: 't' } }));
    if (endpoint === 'v3/searchByName') {
      // "Version discontinued" on this endpoint from every portal host; the relay still answers it
      if (!viaRelay) return req.respond(200, JSON.stringify({ returnCode: 'portal200001', errorMessage: 'version' }));
      return req.respond(200, JSON.stringify({ returnCode: '0', data: { searchItemList: [] } }));
    }
    if (endpoint === 'v6/getLiveData') {
      return req.respond(200, JSON.stringify({ returnCode: '0', data: { channelList: [{ channelCode: 'c1', name: 'Uno' }] } }));
    }
    req.fail();
  });

  const searched: any[] = [];
  client.search('noticias', (err: any) => searched.push(err));
  for (let i = 0; i < 40; i++) advance(300);
  assert.equal(searched.length, 1);
  assert.equal(searched[0], null, 'the search is answered through the relay');

  const live: any[] = [];
  const before = urls.length;
  client.getLiveChannels(76206, 1, 50, (err: any) => live.push(err));
  for (let i = 0; i < 40; i++) advance(300);
  assert.equal(live.length, 1);
  assert.equal(live[0], null);
  const liveUrls = urls.slice(before).filter(u => /getLiveData/.test(u));
  assert.ok(liveUrls.length >= 1);
  assert.ok(liveUrls.every(u => !/workers\.dev/.test(u)), 'the next request still goes straight to the portal');
});
