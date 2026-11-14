import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EPIC_RESOLVE, deviceTimeZone, epicChannelKey, epicMenuPath, epicOptionLabel, epicOptions, epicResolved, epicStartMillis, epicTeams, parseEpicMenu } from '../src/lib/epicMenu.ts';

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

test('epicTeams reads the teams of a title', () => {
  assert.deepEqual(epicTeams('UEFA Nations League: Moldavia vs Kazajistán'), { home: 'Moldavia', away: 'Kazajistán' });
  assert.deepEqual(epicTeams('Gran Premio de Brasil'), { home: 'Gran Premio de Brasil', away: '' });
});

test('epicStartMillis: the agenda hour is Bogotá time', () => {
  assert.equal(new Date(epicStartMillis('2026-11-13', '12:00')).toISOString(), '2026-11-13T17:00:00.000Z');
  assert.equal(epicStartMillis('2026-11-13', 'luego'), 0);
});

test('epicOptions: same link once, direct HLS plays as is, pages go through /resolve, no YouTube', () => {
  const opts = epicOptions(match);
  assert.deepEqual(opts.map(o => o.name), ['Opción 1 · ESPN 2', 'Opción 2 · DAZN']);
  assert.equal(opts[0].tokenApi, EPIC_RESOLVE);
  assert.equal(opts[1].tokenApi, undefined);
});

test('parseEpicMenu: events with teams, logos, status and their options path', () => {
  const [ev] = parseEpicMenu({ events: [match, { ...match, id: 'x', oculto: true }] }, Date.parse('2026-11-13T18:00:00Z'));
  assert.equal(ev.id, 'epic-api_1528968');
  assert.equal(ev.home, 'Moldavia');
  assert.equal(ev.sport, 'football_plus');
  assert.equal(ev.sportLabel, 'Fútbol+');
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

test('epicOptionLabel: order number, the channel when it is one, HD kept, source names out', () => {
  // The options of Colombia vs Chile on 13-nov
  const names = ['Caracol TV', 'Caracol Colombia', 'Sport 4 Israel', 'Sport 4 Israel', 'PirloTV Col-Chi 5', 'PirloTV Col-Chi 6 (HD)', 'Opción 3', '', 'ESPN 2 (HD)', 'Fox Sports 2 USA', 'Canal 2', 'Puente ip01'];
  assert.deepEqual(names.map((n, i) => epicOptionLabel(n, i + 1)), [
    'Opción 1 · Caracol TV', 'Opción 2 · Caracol', 'Opción 3 · Sport 4', 'Opción 4 · Sport 4', 'Opción 5', 'Opción 6 · HD',
    'Opción 7', 'Opción 8', 'Opción 9 · ESPN 2 HD', 'Opción 10 · Fox Sports 2', 'Opción 11', 'Opción 12'
  ]);
});

test('epicMenuPath asks the agenda in the TV zone, Bogotá when the TV does not say', () => {
  assert.match(epicMenuPath('America/Mexico_City'), /tz=America%2FMexico_City&/);
  assert.match(epicMenuPath(''), /tz=America%2FBogota&/);
  assert.match(epicMenuPath('Europe/Madrid'), /^\/menu\?all=1&recetas=aparte&agenda=propia&v=9999&/);
  assert.equal(deviceTimeZone({ DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'America/Lima' }) }) }), 'America/Lima');
  assert.equal(deviceTimeZone({ DateTimeFormat: () => ({ resolvedOptions: () => ({}) }) }), '');
  assert.equal(deviceTimeZone(null), '');
});

test('epicOptions: a DaddyLive channel listed as page and as manifest is one option, the manifest', () => {
  assert.equal(epicChannelKey('https://dlive.example/stream/stream-756.php'), 'daddylive:756');
  assert.equal(epicChannelKey('https://edge.example/premium756/index.m3u8'), 'daddylive:756');
  assert.equal(epicChannelKey('https://other.example/live.m3u8'), '');
  const opts = epicOptions({ cocinas: [
    { fuente: 'daddylive', canales: [{ publico: 'Fox Soccer Plus', url: 'https://dlive.example/stream/stream-756.php' }] },
    { fuente: 'tvlibre', canales: [{ publico: 'ESPN', url: 'https://pelota.example/e?r=1' }] },
    { fuente: 'daddylive·stream', canales: [{ publico: 'Fox Soccer Plus', url: 'https://edge.example/premium756/index.m3u8' }] }
  ] });
  assert.deepEqual(opts.map(o => [o.name, o.url, o.tokenApi]), [
    ['Opción 1 · Fox Soccer Plus', 'https://edge.example/premium756/index.m3u8', undefined],
    ['Opción 2 · ESPN', 'https://pelota.example/e?r=1', EPIC_RESOLVE]
  ]);
});

test('epicOptions: the tiktok family goes first and its first option reads Recomendada', () => {
  const opts = epicOptions({ cocinas: [
    { fuente: 'tvlibre', familia: 'tvlibre', canales: [{ publico: 'ESPN', url: 'https://pelota.example/e?r=1' }] },
    { fuente: 'daddylive', familia: 'tiktok', canales: [{ publico: 'Fox Soccer Plus', url: 'https://dlive.example/stream/stream-756.php' }] },
    { fuente: 'daddylive·stream', familia: 'tiktok', canales: [
      { publico: 'Fox Soccer Plus', url: 'https://edge.example/premium756/index.m3u8' },
      { publico: 'TUDN USA', url: 'https://edge.example/premium80/index.m3u8' }
    ] }
  ] });
  assert.deepEqual(opts.map(o => o.name), ['Opción 1 · Fox Soccer Plus · Recomendada', 'Opción 2 · TUDN', 'Opción 3 · ESPN']);
  assert.equal(opts[0].url, 'https://edge.example/premium756/index.m3u8');
  // Without that family, no option is called recommended
  assert.equal(epicOptions({ cocinas: [{ familia: 'zohan', canales: [{ publico: 'ESPN', url: 'https://z.example/1' }] }] })[0].name, 'Opción 1 · ESPN');
});
