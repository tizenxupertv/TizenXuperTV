import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureText, formatCall, groupBySource, logCall, sourceNames } from '../src/lib/callLog.ts';

const PARTS = [
  { name: 'featured', count: 62, via: 'json' },
  { name: 'movies', count: 62, via: 'relay' },
  { name: 'series', count: 63, via: 'json' },
  { name: 'kids', count: null, via: 'relay' }
];

test('the parts of one step are grouped by source, failures apart', () => {
  assert.deepEqual(groupBySource(PARTS), {
    json: { featured: 62, series: 63 },
    relay: { movies: 62 },
    falló: { kids: null }
  });
  assert.equal(sourceNames(PARTS), 'json + relay + falló');
  assert.deepEqual(groupBySource([]), {});
});

test('a success line has the route, the source, the time and the info', () => {
  assert.equal(formatCall('Home', 'catalog', 'json', null, 412.6, '1200 títulos'), '[Home:catalog] json ✓ 413 ms · 1200 títulos');
  assert.equal(formatCall('Detail', 'persons/77', 'portal', null, 80), '[Detail:persons/77] portal ✓ 80 ms');
});

test('a failure line ends with the portal code and its words, or the error message', () => {
  const portal = Object.assign(new Error('v3/detail -> aaa100027 x'), { portalCode: 'aaa100027', portalText: 'sesión inválida' });
  assert.equal(formatCall('Detail', 'detail/77', 'portal', portal, 230), '[Detail:detail/77] portal ✗ 230 ms · aaa100027 sesión inválida');
  assert.equal(failureText(new Error('Detail request timeout')), 'Detail request timeout');
  assert.equal(failureText('raro'), 'raro');
});

test('successes go to console.log and failures to console.warn, with the details object after the line', () => {
  const logged: unknown[][] = [];
  const warned: unknown[][] = [];
  const log = console.log;
  const warn = console.warn;
  console.log = (...args: unknown[]) => { logged.push(args); };
  console.warn = (...args: unknown[]) => { warned.push(args); };
  try {
    logCall('Home', 'catalog', 'red', null, 10, '3 títulos', { json: { featured: 3 } });
    logCall('Home', 'catalog', 'red', new Error('sin red'), 20);
  } finally {
    console.log = log;
    console.warn = warn;
  }
  assert.deepEqual(logged, [['[Home:catalog] red ✓ 10 ms · 3 títulos', { json: { featured: 3 } }]]);
  assert.deepEqual(warned, [['[Home:catalog] red ✗ 20 ms · sin red']]);
});
