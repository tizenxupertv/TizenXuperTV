import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeAt, routeCount, routeLabel } from '../src/lib/signalRoutes.ts';

const opt: any = { name: 'Opción 1 · Fox Soccer Plus', url: 'https://edge.example/premium756/index.m3u8', scheme: 0, headers: {}, source: 'tiktok',
  alternates: [{ url: 'https://dlive.example/stream/stream-756.php', tokenApi: 'epic-resolve' }] };

test('routes: the own address, then the alternates, without carrying the list along', () => {
  assert.equal(routeCount(opt), 2);
  assert.equal(routeCount({ ...opt, alternates: undefined }), 1);
  assert.equal(routeCount(undefined), 0);
  assert.equal(routeAt(opt, 0), opt);
  const second = routeAt(opt, 1);
  assert.equal(second.url, 'https://dlive.example/stream/stream-756.php');
  assert.equal(second.tokenApi, 'epic-resolve');
  assert.equal(second.alternates, undefined);
  assert.equal(second.name, opt.name);
  assert.equal(routeAt(opt, 5), opt);
});

test('routeLabel names the signal, its route and its source for the log', () => {
  assert.equal(routeLabel(opt, 1, 'dlive.example'), '«Opción 1 · Fox Soccer Plus» · ruta 2/2 · tiktok · dlive.example');
  assert.equal(routeLabel({ ...opt, alternates: undefined, source: undefined }, 0, 'h'), '«Opción 1 · Fox Soccer Plus» · h');
});
