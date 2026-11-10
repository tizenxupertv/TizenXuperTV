import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagQrPayload, diagQrUrl } from '../src/lib/diagQr.ts';

const blocked = {
  verdict: 'all-blocked',
  checks: [
    { id: 'network', status: 'ok' },
    { id: 'clock', status: 'ok' },
    { id: 'doh', status: 'error' },
    { id: 'relay', status: 'error' },
    { id: 'workers', status: 'error' }
  ]
};

// Same pattern as the bot's parser (TizenXuper Bot, src/diagReport.ts)
const BOT_PATTERN = /^diag-(\d{1,3}(?:_\d{1,3}){0,3})-(\d{1,2}(?:_\d{1,2})?|x)-([ocnwrax])([owex]{5})-([A-Z0-9]{1,20}|x)$/;

test('the payload carries the version, Tizen, verdict, checks and model', () => {
  assert.equal(diagQrPayload('1.13.1', 'UN50U8000FKXZL · Tizen 9.0', blocked), 'diag-1_13_1-9_0-aooeee-UN50U8000FKXZL');
  assert.equal(
    diagQrUrl('1.13.1', 'UE55MU6120 · Tizen 3.0', blocked),
    'https://t.me/TizenXuperSupportBot?start=diag-1_13_1-3_0-aooeee-UE55MU6120'
  );
});

test('missing data becomes x, and the model keeps only letters and digits', () => {
  assert.equal(diagQrPayload('dev', '', null), 'diag-0-x-xxxxxx-x');
  assert.equal(diagQrPayload('1.13.1', 'Tizen 6.5', null), 'diag-1_13_1-6_5-xxxxxx-x');
  assert.equal(diagQrPayload('1.13.1', 'qn-55 q60r <b> · Tizen 5.5', { verdict: 'ok', checks: [] }), 'diag-1_13_1-5_5-oxxxxx-QN55Q60RB');
  assert.equal(diagQrPayload('1.13.1', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', null).split('-').pop(), 'ABCDEFGHIJKLMNOPQRST');
  assert.equal(diagQrPayload('1.13.1', 'X', { verdict: 'something-new', checks: [{ id: 'workers', status: 'warn' }] }), 'diag-1_13_1-x-xxxxxw-X');
});

test('every payload fits a Telegram /start parameter and the bot pattern', () => {
  const longest = diagQrPayload('100.200.300.400', `${'Z'.repeat(40)} · Tizen 10.10`, blocked);
  for (const p of [longest, diagQrPayload('dev', '', null), diagQrPayload('1.13.1', 'UN50U8000FKXZL · Tizen 9.0', blocked)]) {
    assert.ok(p.length <= 64, p);
    assert.match(p, /^[A-Za-z0-9_-]+$/);
    assert.match(p, BOT_PATTERN);
  }
});
