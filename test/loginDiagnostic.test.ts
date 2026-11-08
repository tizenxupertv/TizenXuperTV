import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLoginDiagnostic } from '../src/services/diagnosticService.ts';

test('login diagnostic: detects offline network interface', async () => {
  const result = await runLoginDiagnostic({
    isOnline: () => false,
    now: () => Date.parse('2026-11-08T12:00:00Z'),
    fetchFn: async () => new Response('{}', { status: 200 })
  });

  assert.equal(result.verdict, 'no-internet');
  assert.equal(result.checks.find(c => c.id === 'network')?.status, 'error');
  assert.match(result.recommendation, /Wi-Fi|cable Ethernet/i);
});

test('login diagnostic: detects desynchronized clock (e.g. 2015 after power cut)', async () => {
  const result = await runLoginDiagnostic({
    isOnline: () => true,
    now: () => Date.parse('2015-06-01T12:00:00Z'), // Year 2015
    fetchFn: async () => new Response('{}', { status: 200 })
  });

  assert.equal(result.verdict, 'clock-wrong');
  assert.equal(result.checks.find(c => c.id === 'clock')?.status, 'error');
  assert.match(result.recommendation, /2015/);
  assert.match(result.recommendation, /SSL/);
});

test('login diagnostic: detects workers.dev blocked but relay accessible', async () => {
  const result = await runLoginDiagnostic({
    isOnline: () => true,
    now: () => Date.parse('2026-11-08T12:00:00Z'),
    fetchFn: async (url) => {
      if (url.includes('dns-query')) {
        return new Response(JSON.stringify({ Answer: [{ type: 1, data: '1.2.3.4' }] }), { status: 200 });
      }
      if (url.includes('tizenxuper-tv.pages.dev')) {
        return new Response('{"status":"ok"}', { status: 200 });
      }
      if (url.includes('workers.dev')) {
        throw new Error('TypeError: Failed to fetch (DNS NXDOMAIN)');
      }
      return new Response('{}', { status: 200 });
    }
  });

  assert.equal(result.verdict, 'relay-only');
  assert.equal(result.checks.find(c => c.id === 'workers')?.status, 'warn');
  assert.equal(result.checks.find(c => c.id === 'relay')?.status, 'ok');
  assert.match(result.recommendation, /relay de respaldo/i);
});

test('login diagnostic: detects all blocked / DNS poisoning', async () => {
  const result = await runLoginDiagnostic({
    isOnline: () => true,
    now: () => Date.parse('2026-11-08T12:00:00Z'),
    fetchFn: async (url) => {
      if (url.includes('dns-query')) {
        throw new Error('Connection refused');
      }
      if (url.includes('tizenxuper-tv.pages.dev')) {
        throw new Error('Connection timed out');
      }
      if (url.includes('workers.dev')) {
        throw new Error('Connection timed out');
      }
      return new Response('{}', { status: 200 });
    }
  });

  assert.equal(result.verdict, 'all-blocked');
  assert.equal(result.checks.find(c => c.id === 'doh')?.status, 'error');
  assert.equal(result.checks.find(c => c.id === 'relay')?.status, 'error');
  assert.equal(result.checks.find(c => c.id === 'workers')?.status, 'error');
  assert.match(result.recommendation, /1\.1\.1\.1/);
});

test('login diagnostic: verifies all green when connectivity is healthy', async () => {
  const result = await runLoginDiagnostic({
    isOnline: () => true,
    now: () => Date.parse('2026-11-08T12:00:00Z'),
    fetchFn: async (url) => {
      if (url.includes('dns-query')) {
        return new Response(JSON.stringify({ Answer: [{ type: 1, data: '172.66.44.182' }] }), { status: 200 });
      }
      if (url.includes('tizenxuper-tv.pages.dev')) {
        return new Response('{"status":"ok"}', { status: 200 });
      }
      if (url.includes('workers.dev')) {
        return new Response('{"error":"bad_request"}', { status: 400 }); // Valid HTTP response means reached
      }
      return new Response('{}', { status: 200 });
    }
  });

  assert.equal(result.verdict, 'ok');
  assert.equal(result.checks.every(c => c.status === 'ok'), true);
  assert.match(result.recommendation, /Reintentar conexión/i);
});
