import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SportsService } from '../src/services/sportsService.ts';

test('parseEventsJson parses and normalizes sports events properly', () => {
  const service = new SportsService();
  const sampleEvents = [
    {
      event: {
        category: 'Futbol',
        eventName: 'LaLiga EA Sports',
        teamAName: 'Real Madrid',
        teamBName: 'Barcelona',
        teamAFlag: 'http://img.sofascore.com/flagA.png',
        teamBFlag: 'https://example.com/flagB.png',
        eventLogo: 'https://example.com/laliga.png',
        date: '07/11/2026',
        time: '20:00:00',
        links: 'pro/sample_links.txt',
        link_names: ['Servidor 1', 'Servidor 2'],
        visible: true
      }
    },
    {
      event: {
        category: 'Motor Sport',
        eventName: 'Formula 1',
        teamAName: 'GP Brasil',
        teamBName: 'Carrera',
        date: '08/11/2026',
        time: '18:00:00',
        links: 'pro/f1_links.txt',
        visible: true
      }
    },
    {
      event: {
        eventName: 'Hidden Event',
        teamAName: 'Hidden 1',
        teamBName: 'Hidden 2',
        date: '08/11/2026',
        time: '10:00:00',
        links: 'pro/hidden.txt',
        visible: false
      }
    }
  ];

  const parsed = service.parseEventsJson(JSON.stringify(sampleEvents));
  assert.equal(parsed.length, 2, 'Hidden events should be excluded');

  const match = parsed.find(e => e.home === 'Real Madrid');
  assert.ok(match);
  assert.equal(match.sport, 'football');
  assert.equal(match.sportLabel, 'Fútbol');
  assert.equal(match.league, 'LaLiga EA Sports');
  assert.equal(match.homeLogo, 'https://img.sofascore.com/flagA.png', 'HTTP sofascore converted to HTTPS');
  assert.equal(match.linksPath, 'pro/sample_links.txt');

  const f1 = parsed.find(e => e.home === 'GP Brasil');
  assert.ok(f1);
  assert.equal(f1.sport, 'motor_sport');
  assert.equal(f1.sportLabel, 'Motor / F1');
});

test('parseStreams parses streams and headers correctly', () => {
  const service = new SportsService();
  const sampleStreams = [
    {
      name: 'ESPN FHD',
      link: 'https://stream.example.com/live.m3u8|Referer=https://example.com/&User-Agent=Mozilla/5.0',
      scheme: 0,
      api: '0b42be26:ae240901'
    },
    {
      name: 'DAZN 1',
      link: 'https://stream.example.com/dazn.mpd',
      scheme: 1,
      api: ''
    }
  ];

  const streams = service.parseStreams(JSON.stringify(sampleStreams));
  assert.equal(streams.length, 2);

  assert.equal(streams[0].name, 'ESPN FHD');
  assert.equal(streams[0].url, 'https://stream.example.com/live.m3u8');
  assert.equal(streams[0].headers['Referer'], 'https://example.com/');
  assert.equal(streams[0].headers['User-Agent'], 'Mozilla/5.0');
  assert.equal(streams[0].drmApi, '0b42be26:ae240901');

  assert.equal(streams[1].name, 'DAZN 1');
  assert.equal(streams[1].url, 'https://stream.example.com/dazn.mpd');
  assert.equal(streams[1].drmApi, undefined);
  assert.deepEqual(streams[1].headers, {});
});


test('only signals with valid resolved URLs are playable', async () => {
  const { isPlayableStream } = await import('../src/services/sportsService.ts');
  const base = { name: 'x', scheme: 0, headers: {} as Record<string, string> };
  assert.equal(isPlayableStream({ ...base, url: 'https://cdn/a.m3u8' }), true);
  assert.equal(isPlayableStream({ ...base, url: 'https://cdn/a.mpd', drmApi: 'k:v' }), true);
  assert.equal(isPlayableStream({ ...base, url: '', tokenApi: '{"type":"embed"}' }), false);
  assert.equal(isPlayableStream({ ...base, url: 'invalid-scheme' }), false);
});

test('a signal is resolved when it is picked: one without work to do comes back as it is', async () => {
  const service = new SportsService();
  const plain = { name: 'TV QUALITY', url: 'http://example.com/live/index.m3u8', scheme: 0, headers: {} };
  assert.equal(service.needsResolving(plain), false);
  assert.equal(await service.resolveStream(plain), plain);
  assert.equal(service.needsResolving(null), false);
});

test('a signal whose address cannot be worked out is returned unchanged instead of failing', async () => {
  const service = new SportsService();
  const broken = { name: 'X', url: 'http://example.com/a.m3u8', scheme: 0, headers: {}, tokenApi: '{not json' };
  assert.equal(service.needsResolving(broken), true);
  assert.deepEqual(await service.resolveStream(broken), broken);
  const unknown = { name: 'Y', url: 'http://example.com/b.m3u8', scheme: 0, headers: {}, tokenApi: '{"type":"other"}' };
  assert.deepEqual(await service.resolveStream(unknown), unknown);
});

test('parseEventsJson drops repeated matches and keeps ids unique', () => {
  const service = new SportsService();
  const match = (links: string) => ({
    event: { category: 'Futbol', eventName: 'Liga', teamAName: 'A', teamBName: 'B', date: '07/11/2026', time: '20:00:00', links }
  });
  const parsed = service.parseEventsJson(JSON.stringify([match('pro/a.txt'), match('pro/a.txt'), match('pro/b.txt'), match('pro/a.txt')]));

  assert.equal(parsed.length, 2, 'The same match with the same links is listed once');
  assert.deepEqual(parsed.map(e => e.linksPath), ['pro/a.txt', 'pro/b.txt']);
  assert.equal(new Set(parsed.map(e => e.id)).size, 2, 'Ids are unique');
});
