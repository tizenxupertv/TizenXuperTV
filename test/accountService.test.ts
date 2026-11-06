import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_API, createAccountService, formatCode } from '../src/services/accountService.ts';

interface Sent { url: string; init: RequestInit }

function harness(responses: Array<{ status: number; body?: unknown } | Error>) {
  const data = new Map<string, string>();
  const sent: Sent[] = [];
  let clock = 1_000_000;
  const service = createAccountService({
    storage: () => ({
      getItem: k => data.get(k) ?? null,
      setItem: (k, v) => { data.set(k, v); },
      removeItem: k => { data.delete(k); }
    }),
    fetchFn: async (url, init) => {
      sent.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error('no response queued');
      if (next instanceof Error) throw next;
      return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
    },
    now: () => clock,
    device: () => ({ version: '1.8.2', model: 'UN50U8000FKXZL' }),
    randomBytes: n => new Uint8Array(n).fill(171)
  });
  return { service, data, sent, tick: (ms: number) => { clock += ms; } };
}

const body = (s: Sent) => JSON.parse(String(s.init.body));
const LOGIN = { code: 'ABCD2345', key: 'k'.repeat(24), url: 'https://t.me/bot?start=tv_ABCD2345', expiresIn: 300, interval: 4 };

test('formats the code like the bot', () => {
  assert.equal(formatCode('ABCD2345'), 'ABCD-2345');
});

test('sign-in: code, pending, linked saves the session', async () => {
  const { service, sent, data } = harness([
    { status: 200, body: LOGIN },
    { status: 200, body: { status: 'pending' } },
    { status: 200, body: { status: 'linked', token: 't'.repeat(43), user: { name: 'Ana', username: 'ana' } } }
  ]);
  assert.equal(service.isSignedIn(), false);

  const login = await service.startLogin();
  assert.equal(sent[0].url, `${ACCOUNT_API}/tv/login`);
  assert.deepEqual(body(sent[0]), { deviceId: 'ab'.repeat(16), version: '1.8.2', model: 'UN50U8000FKXZL' });
  assert.equal(login.expiresAt, 1_000_000 + 300_000);
  assert.equal(login.interval, 4);

  assert.deepEqual(await service.poll(login), { status: 'pending' });
  assert.deepEqual(body(sent[1]), { code: 'ABCD2345', key: LOGIN.key });

  const linked = await service.poll(login);
  assert.equal(linked.status, 'linked');
  assert.deepEqual(service.session(), { token: 't'.repeat(43), name: 'Ana', username: 'ana' });
  assert.equal(service.isSignedIn(), true);
  // The installation id is kept for the next sign-in
  assert.equal(data.get('xuper_device_id_v1'), 'ab'.repeat(16));
});

test('an expired code is not polled', async () => {
  const { service, sent, tick } = harness([{ status: 200, body: LOGIN }]);
  const login = await service.startLogin();
  tick(300_000);
  assert.deepEqual(await service.poll(login), { status: 'expired' });
  assert.equal(sent.length, 1);
});

test('startLogin fails when the server cannot be reached', async () => {
  const { service } = harness([new Error('offline')]);
  await assert.rejects(service.startLogin());
});

async function signedIn(extra: Array<{ status: number; body?: unknown } | Error>) {
  const h = harness([
    { status: 200, body: LOGIN },
    { status: 200, body: { status: 'linked', token: 't'.repeat(43), user: { name: 'Ana', username: null } } },
    ...extra
  ]);
  await h.service.poll(await h.service.startLogin());
  return h;
}

test('verify: only a 401 signs the TV out; offline keeps the session', async () => {
  const { service, sent } = await signedIn([
    new Error('offline'),
    { status: 500 },
    { status: 200, body: { user: { name: 'Ana María', username: 'anam' } } },
    { status: 401 }
  ]);
  assert.equal(await service.verify(), 'offline');
  assert.equal(await service.verify(), 'offline');
  assert.equal(service.isSignedIn(), true);

  assert.equal(await service.verify(), 'ok');
  assert.equal((sent.at(-1)!.init.headers as Record<string, string>).Authorization, `Bearer ${'t'.repeat(43)}`);
  assert.deepEqual(service.session(), { token: 't'.repeat(43), name: 'Ana María', username: 'anam' });

  assert.equal(await service.verify(), 'revoked');
  assert.equal(service.session(), null);
});

test('logout forgets the session even when the server is unreachable', async () => {
  const { service, sent } = await signedIn([new Error('offline')]);
  let changes = 0;
  service.subscribe(() => changes++);
  await service.logout();
  assert.equal(service.session(), null);
  assert.equal(sent.at(-1)!.url, `${ACCOUNT_API}/tv/logout`);
  assert.equal(changes, 1);
});

test('sendReport posts the report with the session and maps the answers', async () => {
  const { service, sent } = await signedIn([
    { status: 200, body: { ok: true } },
    { status: 429, body: { error: 'too_many' } },
    { status: 401 },
    new Error('offline')
  ]);
  const report = { app: '1.9.1', events: [] };
  assert.equal(await service.sendReport(report), 'ok');
  assert.equal(sent.at(-1)!.url, `${ACCOUNT_API}/tv/report`);
  assert.deepEqual(body(sent.at(-1)!), { report });
  assert.equal((sent.at(-1)!.init.headers as Record<string, string>).Authorization, `Bearer ${'t'.repeat(43)}`);
  assert.equal(await service.sendReport(report), 'too_many');
  assert.equal(await service.sendReport(report), 'signed_out');
  assert.equal(await service.sendReport(report), 'error');
});

test('sendReport without a session does not call the server', async () => {
  const { service, sent } = harness([]);
  assert.equal(await service.sendReport({}), 'signed_out');
  assert.equal(sent.length, 0);
});
