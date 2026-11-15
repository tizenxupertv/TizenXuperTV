import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichTitleMetaInBackground } from '../src/services/catalogService.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('enrichTitleMetaInBackground: waits for an idle portal and asks only for the latest card', async () => {
  let idle = false;
  const asked: string[] = [];
  (globalThis as any).window = {
    MagisClient: {
      isIdle: () => idle,
      detail: (id: string, cb: Function) => {
        asked.push(id);
        cb(null, { item: { id, title: id, quality: '1080p' }, episodes: [], seasons: [] });
      }
    }
  };

  // Walking a grid: three cards focused while the portal is busy loading a page
  enrichTitleMetaInBackground({ id: 'bg-a', title: 'A' } as any);
  enrichTitleMetaInBackground({ id: 'bg-b', title: 'B' } as any);
  enrichTitleMetaInBackground({ id: 'bg-c', title: 'C' } as any);
  await sleep(50);
  assert.deepEqual(asked, [], 'nothing is asked while the portal is busy');

  idle = true;
  await sleep(900);
  assert.deepEqual(asked, ['bg-c'], 'only the card the user stopped on is asked for');
});
