import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveCategoryName, liveProgramLine } from '../src/lib/liveLabels.ts';

test('liveCategoryName: the portal\'s ChannelList reads Todos los canales, other names stay', () => {
  assert.equal(liveCategoryName('ChannelList'), 'Todos los canales');
  assert.equal(liveCategoryName(' channel list '), 'Todos los canales');
  assert.equal(liveCategoryName('Colombia'), 'Colombia');
  assert.equal(liveCategoryName(undefined), '');
});

test('liveProgramLine: a real programme shows, the generic En vivo does not', () => {
  assert.equal(liveProgramLine('En vivo'), '');
  assert.equal(liveProgramLine(' EN VIVO '), '');
  assert.equal(liveProgramLine('Noticiero 7 PM'), 'Noticiero 7 PM');
  assert.equal(liveProgramLine('↺ Partido de ayer'), '↺ Partido de ayer');
  assert.equal(liveProgramLine(undefined), '');
});
