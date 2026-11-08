import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreboardService } from '../src/services/scoreboardService.ts';

const service = scoreboardService as any;
const game = (homeFull: string, awayFull: string, homeScore: string, awayScore: string, state = 'live') => ({
  sport: 'soccer', homeFull, homeShort: homeFull, homeAbbr: '', homeScore,
  awayFull, awayShort: awayFull, awayAbbr: '', awayScore, state, periodDetail: "67'"
});

test('a game that has not started has no score, even though ESPN sends 0 - 0', () => {
  service.games = [game('Boca Juniors', 'River Plate', '0', '0', 'scheduled')];
  assert.equal(service.findScore('Boca Juniors', 'River Plate'), null);
});

test('teams of the same city are not confused: Manchester United does not take Manchester City\'s score', () => {
  service.games = [game('Manchester City', 'Arsenal', '3', '1')];
  assert.equal(service.findScore('Manchester United', 'Arsenal'), null);
});

test('a derby keeps each score with its team when ESPN lists the teams the other way round', () => {
  service.games = [game('Atletico Madrid', 'Real Madrid', '2', '0')];
  const s = service.findScore('Real Madrid', 'Atletico Madrid');
  assert.ok(s);
  assert.deepEqual([s.homeScore, s.awayScore], ['0', '2']);
});

test('the best match wins when several games share a word', () => {
  service.games = [game('Manchester City', 'Chelsea', '1', '1'), game('Manchester United', 'Chelsea', '2', '0')];
  const s = service.findScore('Manchester United', 'Chelsea');
  assert.deepEqual([s.homeScore, s.awayScore], ['2', '0']);
});

test('accents, short names and extra words still match', () => {
  service.games = [game('Atletico Nacional', 'America', '1', '0')];
  const s = service.findScore('Atlético Nacional', 'Club América');
  assert.deepEqual([s.homeScore, s.awayScore], ['1', '0']);
});
