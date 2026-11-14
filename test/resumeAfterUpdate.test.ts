import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_MIN_MS, RESUME_LIVE_MAX_MS, resumeLiveWanted, wakeAction } from '../src/lib/resumeAfterUpdate.ts';

test('nothing downloaded: nothing happens', () => {
  assert.equal(wakeAction({ downloaded: false, playing: false, liveOnly: false, awayMs: AWAY_MIN_MS * 10 }), 'none');
});

test('an update and nothing playing: reload at once', () => {
  assert.equal(wakeAction({ downloaded: true, playing: false, liveOnly: false, awayMs: 0 }), 'reload');
});

test('a live channel open: reload only after a long time away', () => {
  assert.equal(wakeAction({ downloaded: true, playing: true, liveOnly: true, awayMs: AWAY_MIN_MS - 1 }), 'none');
  assert.equal(wakeAction({ downloaded: true, playing: true, liveOnly: true, awayMs: AWAY_MIN_MS }), 'reload_live');
});

test('a movie open is never interrupted', () => {
  assert.equal(wakeAction({ downloaded: true, playing: true, liveOnly: false, awayMs: AWAY_MIN_MS * 10 }), 'none');
});

test('the resume mark counts only right after it was written', () => {
  const now = 1_800_000_000_000;
  assert.equal(resumeLiveWanted(String(now - 5000), now), true);
  assert.equal(resumeLiveWanted(String(now - RESUME_LIVE_MAX_MS - 1), now), false);
  assert.equal(resumeLiveWanted(String(now + 60_000), now), false);
  assert.equal(resumeLiveWanted(null, now), false);
  assert.equal(resumeLiveWanted('abc', now), false);
});
