import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plusFirst, sameMatch, withoutPlusDuplicates } from '../src/lib/sportsPlus.ts';

const T = Date.parse('2026-11-14T00:00:00Z');
function ev(id: string, home: string, away: string, sport = 'football', at = T): any {
  return { id, sport, sportLabel: '', league: '', home, away, startTime: '', startMillis: at, endMillis: at + 7200000, status: 'scheduled', linksPath: '', linkNames: [] };
}

test('sameMatch: both teams, any order, accents and "FC" ignored, close in time', () => {
  assert.equal(sameMatch(ev('a', 'Colombia', 'Chile'), ev('b', 'Colombia', 'Chile', 'football_plus')), true);
  assert.equal(sameMatch(ev('a', 'Atlético Nacional', 'Millonarios FC'), ev('b', 'Millonarios', 'Atletico Nacional', 'football_plus')), true);
  assert.equal(sameMatch(ev('a', 'Colombia', 'Chile'), ev('b', 'Colombia', 'Chile', 'football_plus', T + 6 * 3600000)), false);
  assert.equal(sameMatch(ev('a', 'Colombia', 'Peru'), ev('b', 'Colombia', 'Chile', 'football_plus')), false);
  assert.equal(sameMatch(ev('a', 'WBBL', ''), ev('b', 'WBBL', '', 'football_plus')), false);
});

test('withoutPlusDuplicates keeps the Fútbol+ copy of a repeated match', () => {
  const list = [ev('m1', 'Colombia', 'Chile'), ev('m2', 'Peru', 'Bolivia'), ev('p1', 'Colombia', 'Chile', 'football_plus')];
  assert.deepEqual(withoutPlusDuplicates(list).map(e => e.id), ['m2', 'p1']);
  assert.deepEqual(withoutPlusDuplicates(list.slice(0, 2)).map(e => e.id), ['m1', 'm2']);
});

test('plusFirst: Fútbol+ before the others, then by time', () => {
  const list = [ev('m1', 'A', 'B', 'football', T), ev('p2', 'C', 'D', 'football_plus', T + 60000), ev('p1', 'E', 'F', 'football_plus', T)];
  assert.deepEqual(list.sort(plusFirst).map(e => e.id), ['p1', 'p2', 'm1']);
});
