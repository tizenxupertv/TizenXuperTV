import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedPlan, feedsOfEvent, inPlay, LIVE_MAX_AGE_MS, QUIET_MAX_AGE_MS } from '../src/lib/scoreFeeds.ts';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const ev = (over: Record<string, unknown>) => ({
  sport: 'football', league: 'LaLiga', home: 'A', away: 'B', status: 'scheduled',
  startMillis: NOW + 180 * MIN, endMillis: NOW + 300 * MIN, ...over
});

test('each sport asks only for its own feeds; hockey is found by its league name', () => {
  assert.deepEqual(feedsOfEvent(ev({})), ['soccer']);
  assert.deepEqual(feedsOfEvent(ev({ sport: 'basketball', league: 'NBA' })), ['nba']);
  assert.deepEqual(feedsOfEvent(ev({ sport: 'american_football', league: 'NFL' })), ['nfl'], 'the league names one feed');
  assert.deepEqual(feedsOfEvent(ev({ sport: 'american_football', league: 'Liga X' })).sort(), ['cfb', 'cfl', 'nfl'], 'no hint: every feed of the sport');
  assert.deepEqual(feedsOfEvent(ev({ sport: 'baseball', league: 'MLB' })), ['mlb']);
  assert.deepEqual(feedsOfEvent(ev({ sport: 'other', league: 'NHL' })), ['nhl']);
  assert.deepEqual(feedsOfEvent(ev({ sport: 'other', league: 'NBA' })), ['nba'], 'a match filed under another category');
  assert.deepEqual(feedsOfEvent(ev({ sport: 'tennis', league: 'ATP' })), []);
  assert.deepEqual(feedsOfEvent(ev({ sport: 'motor_sport', league: 'Formula 1' })), []);
});

test('a match is in play from shortly before its start to a while after its end, or when the schedule says live', () => {
  assert.equal(inPlay(ev({ startMillis: NOW + 11 * MIN }), NOW), false);
  assert.equal(inPlay(ev({ startMillis: NOW + 9 * MIN }), NOW), true);
  assert.equal(inPlay(ev({ startMillis: NOW - 100 * MIN, endMillis: NOW - 29 * MIN }), NOW), true);
  assert.equal(inPlay(ev({ startMillis: NOW - 200 * MIN, endMillis: NOW - 31 * MIN }), NOW), false);
  assert.equal(inPlay(ev({ status: 'live', startMillis: NOW - 400 * MIN, endMillis: NOW - 200 * MIN }), NOW), true);
});

test('feeds with a match in play are kept fresh, the others are asked for rarely, and unused ones not at all', () => {
  const plan = feedPlan([
    ev({ status: 'live' }),                                         // soccer, in play
    ev({ sport: 'basketball', league: 'NBA' }),                      // nba, later today
    ev({ sport: 'tennis', league: 'ATP' }),                          // no feed
    ev({ sport: 'baseball', league: 'MLB', away: 'A' })              // not a match between two sides
  ], NOW);
  assert.deepEqual(plan, { soccer: LIVE_MAX_AGE_MS, nba: QUIET_MAX_AGE_MS });
});

test('one match in play is enough to keep its feed fresh among quiet ones', () => {
  const plan = feedPlan([ev({}), ev({ startMillis: NOW - 5 * MIN, endMillis: NOW + 100 * MIN }), ev({})], NOW);
  assert.deepEqual(plan, { soccer: LIVE_MAX_AGE_MS });
});

test('an empty schedule asks for nothing', () => {
  assert.deepEqual(feedPlan([], NOW), {});
});
