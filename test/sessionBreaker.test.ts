import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortalClient } from './helpers/portalClient.ts';

/**
 * The portal refuses to activate sessions (portal100024, region blacklisted) and every pool session is "not logged
 * in" (aaa100028). Before the breakers, each live channel started session after session in a loop.
 */
function refusingPortal() {
  const harness = loadPortalClient(req => {
    if (/\/session\/fallback$/.test(req.url)) {
      req.respond(200, JSON.stringify({ ok: true, session: { sn: 'pool_sn', snToken: 'pool_tok', userId: 'pool_user', userToken: 'pool_user_tok' } }));
      return;
    }
    const endpoint = req.url.split('/api/portalCore/')[1] || '';
    if (endpoint === 'v3/snToken') {
      req.respond(200, JSON.stringify({ returnCode: '0', data: { snToken: 'sn_tok_1', isNew: 0 } }));
      return;
    }
    if (endpoint === 'v8/active') {
      req.respond(200, JSON.stringify({ returnCode: 'portal100024', errorMessage: '所在区域为黑名单，栏目不可见' }));
      return;
    }
    if (/startPlayLive$/.test(endpoint)) {
      req.respond(200, JSON.stringify({ returnCode: 'aaa100028', errorMessage: '未登录！' }));
      return;
    }
    req.fail();
  });
  const settle = () => { for (let i = 0; i < 40; i++) harness.advance(300); };
  const count = (re: RegExp) => harness.requests.filter(r => re.test(r.url)).length;
  return { ...harness, settle, count };
}

function resolve(client: any, settle: () => void, code = '1234') {
  const answers: any[] = [];
  client.resolveLive(code, (err: any, meta: any) => answers.push({ err, meta }));
  settle();
  return answers;
}

test('a refused activation is not retried with a new device identity', () => {
  const { client, settle, count } = refusingPortal();
  resolve(client, settle);
  // One direct session and one relay session are tried; neither is retried as a new device
  assert.equal(count(/workers\.dev\/api\/portalCore\/v8\/active$/), 1, 'one relay activation, no second identity');
  assert.equal(count(/v8\/active$/), 2);
});

test('one refused live channel asks the portal a bounded number of times, then pauses', () => {
  const { client, settle, requests } = refusingPortal();
  const first = resolve(client, settle);
  assert.equal(first.length, 1, 'the caller gets an answer');
  assert.ok(first[0].err, 'and it is an error');
  const afterFirst = requests.length;
  assert.ok(afterFirst <= 8, `bounded: ${afterFirst} requests`);

  // Same channel again, and another one: the pause answers without asking anyone
  const second = resolve(client, settle);
  const third = resolve(client, settle, '5678');
  assert.equal(requests.length, afterFirst, 'no request while paused');
  assert.equal(second[0].err.sessionBlocked, true);
  assert.equal(third[0].err.sessionBlocked, true);
  assert.equal(second[0].err.portalCode, 'aaa100028', 'the pause keeps the portal\'s reason');
});

test('after the pause the next call tries again', () => {
  const { client, settle, advance, requests } = refusingPortal();
  resolve(client, settle);
  const before = requests.length;
  advance(5 * 60 * 1000 + 1000);
  resolve(client, settle);
  assert.ok(requests.length > before, 'asks the portal again after 5 minutes');
});

test('a cancelled tune stops before asking the portal', () => {
  const { client, settle, requests } = refusingPortal();
  const answers: any[] = [];
  client.resolveLive('1234', (err: any) => answers.push(err), { isCancelled: () => true });
  settle();
  assert.equal(requests.length, 0);
  assert.equal(answers[0].cancelled, true);
});
