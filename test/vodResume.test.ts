import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSaveProgress, formatDuration, formatRemaining, getResumeTarget, reachedResumeGoal, retryStartAt, isFinished, continueWatchingItems, parseDurationToSeconds } from '../src/lib/vodResume.ts';
import type { VodItem } from '../src/types/vod.ts';
import type { HistoryItem } from '../src/types/history.ts';

test('isFinished requires 95% completion or <= 120s remaining', () => {
  const duration = 6000; // 100 min
  // 90% (5400s) was previously considered finished; now it is NOT finished so climax/ending is not lost
  assert.equal(isFinished(5400, duration), false);
  // 94% is not finished
  assert.equal(isFinished(5640, duration), false);
  // 95% is finished
  assert.equal(isFinished(5700, duration), true);
  // Within 120s of end is finished
  assert.equal(isFinished(5900, duration), true);
  // Unknown or 0 duration is never finished
  assert.equal(isFinished(500, 0), false);
  assert.equal(isFinished(0, 0), false);
});

test('continueWatchingItems preserves series after finishing an episode', () => {
  const movieFinished: HistoryItem = { id: 'm-1', title: 'Movie 1', poster: '', series: false, position: 5800, duration: 6000, updatedAt: 1 };
  const movieUnfinished: HistoryItem = { id: 'm-2', title: 'Movie 2', poster: '', series: false, position: 2000, duration: 6000, updatedAt: 2 };
  const seriesEpFinished: HistoryItem = { id: 's-1', title: 'Series 1', poster: '', series: true, episodeNumber: 1, position: 2700, duration: 2700, updatedAt: 3 };

  const res = continueWatchingItems([movieFinished, movieUnfinished, seriesEpFinished]);
  // Finished movie is filtered out
  assert.equal(res.some(h => h.id === 'm-1'), false);
  // Unfinished movie is kept
  assert.equal(res.some(h => h.id === 'm-2'), true);
  // Series is KEPT even though episode 1 reached 100%, because next episode is up next!
  assert.equal(res.some(h => h.id === 's-1'), true);
});

test('parseDurationToSeconds parses various formats', () => {
  assert.equal(parseDurationToSeconds('02:18:00'), 8280);
  assert.equal(parseDurationToSeconds('01:30'), 90);
  assert.equal(parseDurationToSeconds('138 min'), 8280);
  assert.equal(parseDurationToSeconds('2 h 18 min'), 8280);
  assert.equal(parseDurationToSeconds('45 min'), 2700);
  assert.equal(parseDurationToSeconds(5400), 5400);
  assert.equal(parseDurationToSeconds(''), 0);
});

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

test('a title that did not get to where it was asked to continue keeps its saved position', () => {
  // Asked to continue at 52 min; the TV refused the jump and plays from the start
  const goal = 52 * 60;
  assert.equal(canSaveProgress(15, goal), false, 'the first seconds from the start are not the viewer\'s position');
  assert.equal(canSaveProgress(119, goal), false);
  assert.equal(canSaveProgress(120, goal), true, 'two minutes watched from there: now it is');
  assert.equal(canSaveProgress(goal - 10, goal), true, 'the player is where it was asked to continue');
  assert.equal(canSaveProgress(goal + 300, goal), true);
  // Nothing was asked (played from the start, or the resume already landed): every time counts
  assert.equal(canSaveProgress(15, 0), true);
  assert.equal(canSaveProgress(0.5, 0), false, 'under a second is not progress');
});

test('the resume goal is met once the player is within 15 s of it, or past it', () => {
  assert.equal(reachedResumeGoal(3105, 3120), true);
  assert.equal(reachedResumeGoal(3200, 3120), true);
  assert.equal(reachedResumeGoal(3100, 3120), false);
  assert.equal(reachedResumeGoal(10, 3120), false);
  assert.equal(reachedResumeGoal(10, 0), false, 'no goal');
});

test('a retry reopens where the title is, or where it was asked to continue when it never got to play', () => {
  // MSE failed before its first frame while resuming at 160 s: AVPlay opens at 160 s, not at 0
  assert.equal(retryStartAt(0, 160, 160), 160);
  // It was playing at 600 s (the resume landed, no goal left): the retry reopens there
  assert.equal(retryStartAt(600, 160, 0), 600);
  // The TV refused the resume and the title has been playing from the start for 40 s: reopen there
  assert.equal(retryStartAt(40, 3120, 3120), 40);
  // Played from the start, 3 s in: the retry starts from the beginning
  assert.equal(retryStartAt(3, 0, 0), 3);
});
