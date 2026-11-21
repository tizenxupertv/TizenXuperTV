import { test } from 'node:test';
import assert from 'node:assert/strict';
import CryptoJS from 'crypto-js';
import { loadPortalClient } from './helpers/portalClient.ts';

const SEC_KEY_HEX = 'd7a09729603a04efbdebfd4dc5ba37f0';
const SEC_ALPHA = 'jWB7YtC3n9iXbEkUcJl1VxF4STpQoOIaRmh2M-efAgLwPqGr6uyD5vNsdH_Kz0Z8';
const STD_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function secUnwrap(str: string): Record<string, any> {
  let b64 = '';
  for (const ch of String(str).trim()) {
    const idx = SEC_ALPHA.indexOf(ch);
    b64 += idx >= 0 ? STD_B64[idx] : ch;
  }
  while (b64.length % 4) b64 += '=';
  const key = CryptoJS.enc.Hex.parse(SEC_KEY_HEX);
  const dec = CryptoJS.AES.decrypt(b64, key, { iv: key, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
  return JSON.parse(dec.toString(CryptoJS.enc.Utf8));
}

test('live channels on a direct session go to the portal with that session\'s user and token', () => {
  const livePayloads: Record<string, any>[] = [];
  const liveUrls: string[] = [];
  const { client, advance } = loadPortalClient(req => {
    const endpoint = req.url.split('/api/portalCore/')[1] || '';
    if (endpoint === 'v3/snToken') {
      return req.respond(200, JSON.stringify({ returnCode: '0', data: { snToken: 'sn_tok_1' } }));
    }
    if (endpoint === 'v8/active') {
      return req.respond(200, JSON.stringify({ returnCode: '0', data: { userId: 'user_1', userToken: 'tok_1' } }));
    }
    if (endpoint === 'v6/getLiveData') {
      liveUrls.push(req.url);
      livePayloads.push(secUnwrap(req.body || ''));
      return req.respond(200, JSON.stringify({
        returnCode: '0',
        data: { channelList: [{ channelCode: 'c1', name: 'Uno', channelNumber: 1 }] }
      }));
    }
    req.fail();
  });

  const answers: any[] = [];
  client.getLiveChannels(76206, 1, 50, (err: any, list: any[]) => answers.push({ err, list }));
  for (let i = 0; i < 20; i++) advance(300);

  assert.equal(answers.length, 1, 'the caller gets an answer');
  assert.equal(answers[0].err, null);
  assert.deepEqual(Array.from(answers[0].list, (c: any) => c.channelCode), ['c1']);
  assert.equal(livePayloads.length, 1);
  // It used to leave through the relay with an empty user and token, which the portal refuses
  assert.ok(!/workers\.dev/.test(liveUrls[0]), 'sent straight to the portal, not through the relay');
  assert.equal(livePayloads[0].userId, 'user_1');
  assert.equal(livePayloads[0].userToken, 'tok_1');
  assert.equal(String(livePayloads[0].columnId), '76206');
});

test('a category with more than 1000 channels comes back whole', () => {
  // "Todos los canales" has about 1035: 20 full pages and a short one. The cap used to stop at 20 pages
  const { client, advance } = loadPortalClient(req => {
    const endpoint = req.url.split('/api/portalCore/')[1] || '';
    if (endpoint === 'v3/snToken') return req.respond(200, JSON.stringify({ returnCode: '0', data: { snToken: 's' } }));
    if (endpoint === 'v8/active') return req.respond(200, JSON.stringify({ returnCode: '0', data: { userId: 'u', userToken: 't' } }));
    if (endpoint === 'v6/getLiveData') {
      const page = Number(secUnwrap(req.body || '').pageNum);
      const count = page <= 20 ? 50 : page === 21 ? 35 : 0;
      const channelList = Array.from({ length: count }, (_, i) => ({ channelCode: `p${page}c${i}`, name: 'x', channelNumber: i }));
      return req.respond(200, JSON.stringify({ returnCode: '0', data: { channelList } }));
    }
    req.fail();
  });

  const answers: any[] = [];
  client.getAllLiveChannels(76182, (err: any, list: any[]) => answers.push({ err, list }));
  for (let i = 0; i < 200; i++) advance(300);

  assert.equal(answers.length, 1);
  assert.equal(answers[0].err, null);
  assert.equal(answers[0].list.length, 1035);
});
