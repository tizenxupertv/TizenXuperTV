import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posterInWindow } from '../src/lib/posterWindow.ts';

const loaded = (count: number, focus: number, cols: number) =>
  Array.from({ length: count }, (_, i) => i).filter(i => posterInWindow(i, focus, cols));

test('with the focus at the top, only the first rows load their posters', () => {
  const list = loaded(120, 0, 6);
  assert.equal(list.length, 24, 'the focused row and three below, of 6');
  assert.equal(list[0], 0);
  assert.equal(list[list.length - 1], 23);
});

test('the window follows the focus: two rows above, three below', () => {
  // Focus on the card 62 of a 6-column grid: row 10
  const list = loaded(120, 62, 6);
  assert.equal(list[0], 48, 'row 8 starts at 48');
  assert.equal(list[list.length - 1], 83, 'row 13 ends at 83');
  assert.equal(list.length, 36);
  assert.equal(posterInWindow(47, 62, 6), false);
  assert.equal(posterInWindow(84, 62, 6), false);
});

test('120 results never load more than six rows of posters', () => {
  for (const cols of [5, 6, 7]) {
    for (let focus = 0; focus < 120; focus++) {
      assert.ok(loaded(120, focus, cols).length <= 6 * cols);
    }
  }
});

test('odd inputs do not break it', () => {
  assert.equal(posterInWindow(0, -1, 6), true);
  assert.equal(posterInWindow(3, 0, 0), true, 'no column count: one per row, row 3 is inside');
  assert.equal(posterInWindow(4, 0, 0), false);
});
