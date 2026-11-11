import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeExtraChannels } from '../src/lib/extraChannels.ts';

const ch = (id: string, name: string) => ({ id, code: id, name });
const names = (list: { name: string }[]) => list.map(c => c.name);

test('an own channel goes right after the last channel of its brand', () => {
  const list = [ch('a', 'ESPN'), ch('b', 'ESPN 2'), ch('c', 'ESPN 7'), ch('d', 'DSports'), ch('e', 'Bolivia TV')];
  assert.deepEqual(names(placeExtraChannels(list, [ch('x', 'ESPN U HD')])), ['ESPN', 'ESPN 2', 'ESPN 7', 'ESPN U HD', 'DSports', 'Bolivia TV']);
});

test('an own channel of a brand the list does not have goes at the end', () => {
  const list = [ch('a', 'ESPN'), ch('d', 'DSports')];
  assert.deepEqual(names(placeExtraChannels(list, [ch('x', 'Fox Sports')])), ['ESPN', 'DSports', 'Fox Sports']);
});

test('two own channels of one brand keep their order, and one the service already lists is not repeated', () => {
  const list = [ch('a', 'ESPN'), ch('d', 'DSports')];
  const extras = [ch('x', 'ESPN U HD'), ch('y', 'ESPN Deportes'), ch('a', 'ESPN')];
  assert.deepEqual(names(placeExtraChannels(list, extras)), ['ESPN', 'ESPN U HD', 'ESPN Deportes', 'DSports']);
});

test('the list given is not changed', () => {
  const list = [ch('a', 'ESPN'), ch('d', 'DSports')];
  placeExtraChannels(list, [ch('x', 'ESPN U HD')]);
  assert.equal(list.length, 2);
});
