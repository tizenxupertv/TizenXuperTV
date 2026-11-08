import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreboardService } from '../src/services/scoreboardService.ts';

test('scoreboardService matches teams accurately and avoids false positives on generic stop words', () => {
  // Access private teamMatches method through test wrapper
  const service = scoreboardService as any;

  assert.equal(
    service.teamMatches('Indiana Pacers', 'Indiana Pacers', 'Pacers', 'IND'),
    true,
    'Exact match should succeed'
  );

  assert.equal(
    service.teamMatches('Denver Nuggets', 'Denver Nuggets', 'Nuggets', 'DEN'),
    true,
    'Exact match should succeed'
  );

  assert.equal(
    service.teamMatches('Seattle Kraken', 'Seattle Kraken', 'Kraken', 'SEA'),
    true,
    'Team name with distinctive nickname should match'
  );

  assert.equal(
    service.teamMatches('New York Rangers', 'New York Rangers', 'Rangers', 'NYR'),
    true,
    'City + nickname should match'
  );

  // Negative tests: Stop words alone must not trigger false positives
  assert.equal(
    service.teamMatches('New York Red Bulls', 'D.C. United', 'D.C. United', 'DC'),
    false,
    'Stop words like United should not cross match'
  );

  assert.equal(
    service.teamMatches('Manchester City', 'Swansea City', 'Swansea', 'SWA'),
    false,
    'Generic word City should not cross match'
  );
});

test('scoreboardService findScore returns score when teams match in any order', () => {
  const service = scoreboardService as any;

  // Populate mock games
  service.games = [
    {
      sport: 'nba',
      homeFull: 'Indiana Pacers',
      homeShort: 'Pacers',
      homeAbbr: 'IND',
      homeScore: '78',
      awayFull: 'Denver Nuggets',
      awayShort: 'Nuggets',
      awayAbbr: 'DEN',
      awayScore: '90',
      state: 'live',
      periodDetail: '4th Qtr'
    }
  ];

  // Direct order match
  const scoreDirect = service.findScore('Indiana Pacers', 'Denver Nuggets');
  assert.ok(scoreDirect);
  assert.equal(scoreDirect.homeScore, '78');
  assert.equal(scoreDirect.awayScore, '90');
  assert.equal(scoreDirect.state, 'live');
  assert.equal(scoreDirect.periodDetail, '4th Qtr');

  // Inverted order match
  const scoreInverted = service.findScore('Denver Nuggets', 'Indiana Pacers');
  assert.ok(scoreInverted);
  assert.equal(scoreInverted.homeScore, '90');
  assert.equal(scoreInverted.awayScore, '78');

  // Unrelated match returns null
  const scoreNone = service.findScore('Boston Celtics', 'Miami Heat');
  assert.equal(scoreNone, null);
});

