import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunGuard } from '../src/lib/runGuard.ts';

test('callbacks of a run stop doing anything once the run ended', () => {
  const errors: string[] = [];
  const first = createRunGuard();
  const failFirst = first.wrap((msg: string) => errors.push(msg));

  failFirst('señal A: sin conexión');
  assert.deepEqual(errors, ['señal A: sin conexión']);

  // The viewer picks another signal: the first run ends and a new one starts
  first.end();
  const second = createRunGuard();
  const failSecond = second.wrap((msg: string) => errors.push(msg));

  failFirst('señal A: error tardío');
  assert.deepEqual(errors, ['señal A: sin conexión'], 'a late error of the old signal is dropped');
  assert.equal(first.alive(), false);
  assert.equal(second.alive(), true);

  failSecond('señal B: error propio');
  assert.deepEqual(errors, ['señal A: sin conexión', 'señal B: error propio']);
});

test('a wrapped callback passes its arguments through while the run is alive', () => {
  const guard = createRunGuard();
  let sum = 0;
  guard.wrap((a: number, b: number) => { sum = a + b; })(2, 3);
  assert.equal(sum, 5);
});
