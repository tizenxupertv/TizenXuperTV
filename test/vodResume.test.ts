import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatRemaining, getResumeTarget } from '../src/lib/vodResume.ts';
import type { VodItem } from '../src/types/vod.ts';

test('formatDuration formats various duration representations into standard X h Y min', () => {
  // HH:MM:SS format
  assert.equal(formatDuration('02:18:00'), '2 h 18 min');
  assert.equal(formatDuration('01:04:00'), '1 h 4 min');
  assert.equal(formatDuration('02:00:00'), '2 h');

  // Minutes format
  assert.equal(formatDuration('138'), '2 h 18 min');
  assert.equal(formatDuration('138 min'), '2 h 18 min');
  assert.equal(formatDuration('45'), '45 min');
  assert.equal(formatDuration('45 min'), '45 min');
  assert.equal(formatDuration('9 min'), '9 min');

  // Seconds format (> 600)
  assert.equal(formatDuration(8280), '2 h 18 min');
  assert.equal(formatDuration('8280'), '2 h 18 min');

  // Already formatted
  assert.equal(formatDuration('2 h 18 min'), '2 h 18 min');
  assert.equal(formatDuration('2 h'), '2 h');

  // Invalid / empty
  assert.equal(formatDuration(''), '');
  assert.equal(formatDuration('—'), '');
  assert.equal(formatDuration(undefined), '');
});

test('formatRemaining formats remaining playback time relative to hours and minutes', () => {
  // 138 minutes remaining (8280 seconds)
  assert.equal(formatRemaining(10, 8290), 'Quedan 2 h 18 min');

  // Under an hour remaining
  assert.equal(formatRemaining(6000, 8280), 'Quedan 38 min');

  // Finished or invalid
  assert.equal(formatRemaining(0, 8280), '');
  assert.equal(formatRemaining(8280, 8280), '');
});

test('getResumeTarget formats movie labels and remaining status', () => {
  const movie: VodItem = { id: 'm-1', title: 'Bu feng zhui ying', kind: 'película' };

  // Not started
  const targetUnstarted = getResumeTarget(movie, []);
  assert.equal(targetUnstarted.label, 'Reproducir película');
  assert.equal(targetUnstarted.startAt, 0);
  assert.equal(targetUnstarted.remainingText, undefined);

  // Started: position 1200s of 8280s (~20 min of 138 min)
  const entry = { id: 'm-1', position: 1200, duration: 8280 };
  const targetStarted = getResumeTarget(movie, [], entry);
  assert.equal(targetStarted.label, 'Continuar película');
  assert.equal(targetStarted.startAt, 1200);
  assert.equal(targetStarted.remainingText, 'Quedan 1 h 58 min');
  assert.equal(targetStarted.progressPercent, 14);
});
