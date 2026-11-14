import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EPIC_RESOLVE, deviceTimeZone, epicMenuPath, epicOptions, epicResolved, epicSport, epicStartMillis, epicTeams, parseEpicMenu } from '../src/lib/epicMenu.ts';

// Shape of one event of /menu (13-nov-2026), trimmed
const match = {
  id: 'api_1528968', hour: '12:00', date: '2026-11-13',
  description: 'UEFA Nations League: Moldova vs Kazakhstan',
  titulo: 'UEFA Nations League: Moldavia vs Kazajistán',
  liga: 'UEFA Nations League', liga_logo: 'https://x/l.png',
  escudo_local: 'https://x/h.png', escudo_visitante: 'https://x/a.png',
  status: 'notlive', ended: true, orden: 1, oculto: false,
  deporte: { clave: 'futbol', nombre: 'Fútbol' },
  channels: [{ name: 'ESPN 2', url: 'https://pelota.example/embed/eventos.html?r=1' }],
  cocinas: [
    { fuente: 'tvlibre', canales: [{ name: 'ESPN 2', publico: 'ESPN 2', url: 'https://pelota.example/embed/eventos.html?r=1' }] },
    { fuente: 'daddylive·stream', canales: [{ name: 'DAZN CA', publico: 'DAZN CA', url: 'https://edge.example/premium68/index.m3u8' }] },
    { fuente: 'youtube', canales: [{ name: 'Canal', url: 'https://www.youtube.com/watch?v=x' }] }
  ]
};

test('epicSport and epicTeams read the agenda fields', () => {
  assert.deepEqual(epicSport({ clave: 'futbol', nombre: 'Fútbol' }), { sport: 'football', label: 'Fútbol' });
  assert.equal(epicSport({ clave: 'futbol-americano' }).sport, 'american_football');
  assert.equal(epicSport({ clave: 'baloncesto' }).sport, 'basketball');
  assert.equal(epicSport({ clave: 'curling', nombre: 'Curling' }).label, 'Curling');
  assert.deepEqual(epicTeams('UEFA Nations League: Moldavia vs Kazajistán'), { home: 'Moldavia', away: 'Kazajistán' });
  assert.deepEqual(epicTeams('Gran Premio de Brasil'), { home: 'Gran Premio de Brasil', away: '' });
});

test('epicStartMillis: the agenda hour is Bogotá time', () => {
  assert.equal(new Date(epicStartMillis('2026-11-13', '12:00')).toISOString(), '2026-11-13T17:00:00.000Z');
  assert.equal(epicStartMillis('2026-11-13', 'luego'), 0);
});

test('epicOptions: same link once, direct HLS plays as is, pages go through /resolve, no YouTube', () => {
  const opts = epicOptions(match);
  assert.deepEqual(opts.map(o => o.name), ['ESPN 2 · tvlibre', 'DAZN CA · daddylive·stream']);
  assert.equal(opts[0].tokenApi, EPIC_RESOLVE);
  assert.equal(opts[1].tokenApi, undefined);
});

test('parseEpicMenu: events with teams, logos, status and their options path', () => {
  const [ev] = parseEpicMenu({ events: [match, { ...match, id: 'x', oculto: true }] }, Date.parse('2026-11-13T18:00:00Z'));
  assert.equal(ev.id, 'epic-api_1528968');
  assert.equal(ev.home, 'Moldavia');
  assert.equal(ev.status, 'finished');
  assert.equal(ev.linksPath, 'epic:api_1528968');
  assert.equal(ev.linkNames.length, 2);
  const live = parseEpicMenu({ events: [{ ...match, ended: false, status: 'live' }] })[0];
  assert.equal(live.status, 'live');
});

test('epicResolved: the address /resolve gives, with its Referer and Origin', () => {
  const opt = epicOptions(match)[0];
  const s = epicResolved(opt, { stream: 'https://cdn.example/espn2/mono.m3u8?token=t', ref: 'https://player.example/', tipo: 'hls' });
  assert.equal(s?.url, 'https://cdn.example/espn2/mono.m3u8?token=t');
  assert.deepEqual(s?.headers, { Referer: 'https://player.example/', Origin: 'https://player.example' });
  assert.equal(s?.tokenApi, undefined);
  assert.equal(epicResolved(opt, { stream: '' }), null);
});

test('epicOptions: repeated names get a number', () => {
  const names = epicOptions({ cocinas: [{ fuente: 'tvlibre', canales: [
    { name: 'ESPN 2', url: 'https://a.example/1' }, { name: 'ESPN 2', url: 'https://a.example/2' }, { name: 'ESPN 2', url: 'https://a.example/3' }
  ] }] }).map(o => o.name);
  assert.deepEqual(names, ['ESPN 2 · tvlibre', 'ESPN 2 · tvlibre (2)', 'ESPN 2 · tvlibre (3)']);
});

test('epicMenuPath asks the agenda in the TV zone, Bogotá when the TV does not say', () => {
  assert.match(epicMenuPath('America/Mexico_City'), /tz=America%2FMexico_City&/);
  assert.match(epicMenuPath(''), /tz=America%2FBogota&/);
  assert.match(epicMenuPath('Europe/Madrid'), /^\/menu\?all=1&recetas=aparte&agenda=propia&v=9999&/);
  assert.equal(deviceTimeZone({ DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'America/Lima' }) }) }), 'America/Lima');
  assert.equal(deviceTimeZone({ DateTimeFormat: () => ({ resolvedOptions: () => ({}) }) }), '');
  assert.equal(deviceTimeZone(null), '');
});
