import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPortalClient } from './helpers/portalClient.ts';

test('a session start that fails reports the error, and the next call starts over instead of hanging', () => {
  // No host answers: every request fails as a network error
  const { client, requests, advance } = loadPortalClient(req => req.fail());

  const first: any[] = [];
  client.ensureSession((err: any) => first.push(err));
  advance(5000);
  assert.equal(first.length, 1, 'the caller gets an answer');
  assert.match(String(first[0] && first[0].message), /v3\/snToken: el portal no respondió/);
  assert.equal(requests.length, 8, 'one try per host, and no second round for a network failure');
  assert.ok(requests.every(r => /\/api\/portalCore\/v3\/snToken$/.test(r.url)));

  // The app asks again later (the Wi-Fi is back, or not): a new attempt starts and answers too
  const second: any[] = [];
  client.ensureSession((err: any) => second.push(err));
  advance(5000);
  assert.equal(second.length, 1, 'not left waiting for the first attempt');
  assert.equal(requests.length, 16);
});

test('callers that arrive while the session is starting all get the same answer', () => {
  const { client, advance } = loadPortalClient(req => req.fail());
  const answers: string[] = [];
  client.ensureSession((err: any) => answers.push('a:' + !!err));
  client.ensureSession((err: any) => answers.push('b:' + !!err));
  advance(5000);
  assert.deepEqual(answers, ['a:true', 'b:true']);
});

test('a host that sends nothing is left after 8 s', () => {
  const { client, requests, advance } = loadPortalClient(() => {});
  client.ensureSession(() => {});
  advance(100);
  assert.equal(requests.length, 1);
  advance(7800);
  assert.equal(requests.length, 1, 'still inside the 8 s');
  advance(300);
  assert.equal(requests.length, 2, 'next host');
  assert.equal(requests[0].aborted, true, 'the silent request is closed');
});

test('a host that keeps sending is not cut at 8 s, only at 30 s', () => {
  const { client, requests, advance } = loadPortalClient(() => {});
  client.ensureSession(() => {});
  advance(100);
  // A large answer arriving slowly: some bytes every 5 s
  for (let t = 0; t < 5; t++) {
    advance(5000);
    requests[0].progress();
  }
  assert.equal(requests.length, 1, '25 s in and still downloading from the first host');
  assert.equal(requests[0].aborted, false);
  advance(6000);
  assert.equal(requests[0].aborted, true, 'the 30 s limit per host');
  assert.equal(requests.length, 2);
});

test('a request gives up after 64 s in all, even with hosts left', () => {
  const { client, requests, advance } = loadPortalClient(() => {});
  const answers: any[] = [];
  client.ensureSession((err: any) => answers.push(err));
  for (let second = 1; second <= 100 && !answers.length; second++) {
    advance(1000);
    // Every open host sends some bytes every 5 s, so each one lasts until its own 30 s limit
    if (second % 5 === 0) requests.filter(r => !r.aborted).forEach(r => r.progress());
  }
  assert.equal(answers.length, 1);
  assert.match(String(answers[0].message), /el portal no respondió/);
  assert.equal(requests.length, 3, 'three hosts at 30 s each pass the 64 s: the other five are not tried');
});
