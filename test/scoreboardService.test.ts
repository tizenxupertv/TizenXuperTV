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


test('scoreboardService parseMatchSummary correctly parses events, lineups and stats', () => {
  const service = scoreboardService as any;
  const game = {
    id: '401878758',
    sport: 'soccer',
    summaryPath: 'soccer/all',
    homeFull: 'Leeds United',
    homeShort: 'Leeds',
    homeAbbr: 'LEE',
    homeLogo: 'http://img.com/leeds.png',
    homeScore: '1',
    awayFull: 'Tottenham Hotspur',
    awayShort: 'Spurs',
    awayAbbr: 'TOT',
    awayLogo: 'http://img.com/tot.png',
    awayScore: '2',
    state: 'live',
    periodDetail: "65'"
  };

  const rawData = {
    keyEvents: [
      {
        id: '1',
        type: { text: 'Yellow Card', type: 'yellow-card' },
        clock: { displayValue: "15'" },
        team: { displayName: 'Tottenham Hotspur' },
        participants: [{ athlete: { displayName: 'Micky van de Ven' } }]
      },
      {
        id: '2',
        type: { text: 'Goal', type: 'goal' },
        clock: { displayValue: "34'" },
        team: { displayName: 'Leeds United' },
        participants: [{ athlete: { displayName: 'Wilfried Gnonto' } }],
        scoringPlay: true
      }
    ],
    rosters: [
      {
        team: { displayName: 'Leeds United' },
        formation: '3-4-2-1',
        roster: [
          { athlete: { id: 'p1', displayName: 'James Trafford' }, jersey: '1', position: { abbreviation: 'G' }, starter: true },
          { athlete: { id: 'p2', displayName: 'Daniel James' }, jersey: '20', position: { abbreviation: 'M' }, starter: false }
        ]
      },
      {
        team: { displayName: 'Tottenham Hotspur' },
        formation: '4-3-3',
        roster: [
          { athlete: { id: 'p3', displayName: 'Antonín Kinsky' }, jersey: '31', position: { abbreviation: 'G' }, starter: true }
        ]
      }
    ],
    boxscore: {
      teams: [
        {
          team: { displayName: 'Leeds United' },
          statistics: [
            { name: 'possession', displayValue: '42' },
            { name: 'shots', displayValue: '12' }
          ]
        },
        {
          team: { displayName: 'Tottenham Hotspur' },
          statistics: [
            { name: 'possession', displayValue: '58' },
            { name: 'shots', displayValue: '15' }
          ]
        }
      ]
    }
  };

  const details = service.parseMatchSummary(game, rawData, false);
  assert.ok(details);
  assert.equal(details.homeTeam, 'Leeds United');
  assert.equal(details.awayTeam, 'Tottenham Hotspur');
  assert.equal(details.homeScore, '1');
  assert.equal(details.awayScore, '2');
  assert.equal(details.events.length, 2);
  assert.equal(details.events[0].type, 'yellow_card');
  assert.equal(details.events[0].teamSide, 'away');
  assert.equal(details.events[1].type, 'goal');
  assert.equal(details.events[1].teamSide, 'home');
  assert.equal(details.lineups.home.formation, '3-4-2-1');
  assert.equal(details.lineups.home.starters.length, 1);
  assert.equal(details.lineups.home.bench.length, 1);
  assert.equal(details.stats.length, 2);
  assert.equal(details.stats[0].label, 'Posesión (%)');
  assert.equal(details.stats[0].homeValue, '42');
  assert.equal(details.stats[0].awayValue, '58');
});
