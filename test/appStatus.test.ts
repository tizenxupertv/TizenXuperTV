import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeKey, noticeToShow, parseAppStatus } from '../src/lib/appStatus.ts';

test('the server answer becomes a status only when it is active and has a message', () => {
  assert.deepEqual(parseAppStatus({ active: true, level: 'notice', message: ' Fallas temporales ', updatedAt: 't1' }),
    { level: 'notice', message: 'Fallas temporales', updatedAt: 't1' });
  assert.equal(parseAppStatus({ active: false, message: '' }), null);
  assert.equal(parseAppStatus({ active: true, message: '   ' }), null);
  assert.equal(parseAppStatus({ active: 'yes', message: 'x' }), null);
  assert.equal(parseAppStatus({ error: 'not_found' }), null);
  assert.equal(parseAppStatus(null), null);
  assert.equal(parseAppStatus('active'), null);
});

test('an answer without a level, or with an unknown one, blocks: that is what the first server did', () => {
  assert.equal(parseAppStatus({ active: true, message: 'Mantenimiento' })!.level, 'block');
  assert.equal(parseAppStatus({ active: true, message: 'Mantenimiento', level: 'whatever' })!.level, 'block');
  assert.equal(parseAppStatus({ active: true, message: 'x' })!.updatedAt, '');
});

test('a closed notice stays closed until the team sets a new one; a block is never a notice', () => {
  const first = parseAppStatus({ active: true, level: 'notice', message: 'Fallas', updatedAt: 't1' })!;
  assert.equal(noticeToShow(first, null), first);
  assert.equal(noticeToShow(first, noticeKey(first)), null);

  const again = parseAppStatus({ active: true, level: 'notice', message: 'Fallas', updatedAt: 't2' })!;
  assert.equal(noticeToShow(again, noticeKey(first)), again);
  const reworded = parseAppStatus({ active: true, level: 'notice', message: 'Siguen las fallas', updatedAt: 't1' })!;
  assert.equal(noticeToShow(reworded, noticeKey(first)), reworded);

  assert.equal(noticeToShow(parseAppStatus({ active: true, level: 'block', message: 'x' }), null), null);
  assert.equal(noticeToShow(null, null), null);
});
