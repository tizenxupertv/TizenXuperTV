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

