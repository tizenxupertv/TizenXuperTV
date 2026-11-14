import { test } from 'node:test';
import assert from 'node:assert/strict';
import CryptoJS from 'crypto-js';
import { loadPortalClient } from './helpers/portalClient.ts';

const PORTAL_KEY_HEX = 'e7af1ed7de1ffddd7bd3fe37ebdffde9ef3fe1ae39edfeb8';

function decodePortalBody(hex?: string): Record<string, any> | null {
  if (!hex) return null;
  let b64 = '';
  for (let i = 0; i < hex.length; i += 2) {
    b64 += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  const key = CryptoJS.enc.Hex.parse(PORTAL_KEY_HEX);
  const dec = CryptoJS.TripleDES.decrypt(b64, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7
  });
  return JSON.parse(dec.toString(CryptoJS.enc.Utf8));
}

function createMockPortal(startPlayHandler: (payload: Record<string, any>) => any) {
  const startPlayPayloads: Record<string, any>[] = [];
  const harness = loadPortalClient(req => {
    const endpoint = req.url.split('/api/portalCore/')[1] || '';
    if (endpoint === 'v3/snToken') {
      req.respond(200, JSON.stringify({ returnCode: '0', data: { snToken: 'sn_tok_1', sn: 'sn_1' } }));
      return;
    }
    if (endpoint === 'v8/active') {
      req.respond(200, JSON.stringify({ returnCode: '0', data: { userId: 'user_1', userToken: 'tok_secret_1' } }));
      return;
    }
    if (endpoint === 'v15/getSlbInfo') {
      req.respond(200, JSON.stringify({
        returnCode: '0',
        data: {
          cdn_list: [{
            tag: 'vod',
            main_addr: 'cdn.example.invalid',
            url_list: [{ tag: 'free', sign_type: 'cfl', url: '?sign_type=cfl&token=0123456789abcdef0123456789abcdef' }]
          }]
        }
      }));
      return;
    }
    if (endpoint === 'v10/startPlayVOD') {
      const decoded = decodePortalBody(req.body);
      if (decoded) startPlayPayloads.push(decoded);
      req.respond(200, JSON.stringify({ returnCode: '0', data: startPlayHandler(decoded || {}) }));
      return;
    }
    req.fail();
  });

  const pump = () => {
    for (let i = 0; i < 15; i++) harness.advance(300);
  };

  return { ...harness, startPlayPayloads, pump };
}

test('a session start that fails reports the error, and the next call starts over instead of hanging', () => {
  // No host answers: every request fails as a network error
  const { client, requests, advance } = loadPortalClient(req => req.fail());

  const first: any[] = [];
  client.ensureSession((err: any) => first.push(err));
  advance(5000);
  assert.equal(first.length, 1, 'the caller gets an answer');
  assert.match(String(first[0] && first[0].message), /v3\/snToken: el portal no respondió/);
  assert.equal(requests.length, 8, 'one try per host, and no second round for a network failure');
  assert.ok(requests.every(r => /\/api\/portalCore\/v3\/snToken$/.test(r.url)));

  // The app asks again later (the Wi-Fi is back, or not): a new attempt starts and answers too
  const second: any[] = [];
  client.ensureSession((err: any) => second.push(err));
  advance(5000);
  assert.equal(second.length, 1, 'not left waiting for the first attempt');
  assert.equal(requests.length, 16);
});

test('callers that arrive while the session is starting all get the same answer', () => {
  const { client, advance } = loadPortalClient(req => req.fail());
  const answers: string[] = [];
  client.ensureSession((err: any) => answers.push('a:' + !!err));
  client.ensureSession((err: any) => answers.push('b:' + !!err));
  advance(5000);
  assert.deepEqual(answers, ['a:true', 'b:true']);
});

test('a host that sends nothing is left after 8 s', () => {
  const { client, requests, advance } = loadPortalClient(() => {});
  client.ensureSession(() => {});
  advance(100);
  assert.equal(requests.length, 1);
  advance(7800);
  assert.equal(requests.length, 1, 'still inside the 8 s');
  advance(300);
  assert.equal(requests.length, 2, 'next host');
  assert.equal(requests[0].aborted, true, 'the silent request is closed');
});

test('a host that keeps sending is not cut at 8 s, only at 30 s', () => {
  const { client, requests, advance } = loadPortalClient(() => {});
  client.ensureSession(() => {});
  advance(100);
  // A large answer arriving slowly: some bytes every 5 s
  for (let t = 0; t < 5; t++) {
    advance(5000);
    requests[0].progress();
  }
  assert.equal(requests.length, 1, '25 s in and still downloading from the first host');
  assert.equal(requests[0].aborted, false);
  advance(6000);
  assert.equal(requests[0].aborted, true, 'the 30 s limit per host');
  assert.equal(requests.length, 2);
});

test('a request gives up after 64 s in all, even with hosts left', () => {
  const { client, requests, advance } = loadPortalClient(() => {});
  const answers: any[] = [];
  client.ensureSession((err: any) => answers.push(err));
  for (let second = 1; second <= 100 && !answers.length; second++) {
    advance(1000);
    // Every open host sends some bytes every 5 s, so each one lasts until its own 30 s limit
    if (second % 5 === 0) requests.filter(r => !r.aborted).forEach(r => r.progress());
  }
  assert.equal(answers.length, 1);
  assert.match(String(answers[0].message), /el portal no respondió/);
  assert.equal(requests.length, 3, 'three hosts at 30 s each pass the 64 s: the other five are not tried');
});

test('collectTracks and getLastStartPlayDiag preserve all multi-codec variants and omit secrets', () => {
  const { client, pump } = createMockPortal(() => ({
    name: 'Spider-Man: Un nuevo día',
    episodeList: [{
      contentId: '808605510',
      totalMovieList: [
        {
          quality: '1080P',
          movieList: [
            { contentId: '808605510_hevc', encodeFormat: 'H265', videoFormat: 'ts', audioInfo: 'SPA,SPA,ENG', licenseList: [{ license: 'lic_1080_hevc' }] },
            { contentId: '808605510_avc', encodeFormat: 'H264', videoFormat: 'mp4', audioInfo: 'SPA,SPA,ENG', licenseList: [{ license: 'lic_1080_avc' }] }
          ]
        },
        {
          quality: '720P',
          movieList: [
            { contentId: '808605510_720', encodeFormat: 'H265', videoFormat: 'ts', audioInfo: 'SPA,SPA,ENG', licenseList: [{ license: 'lic_720' }] }
          ]
        },
        {
          quality: '480P',
          movieList: [
            { contentId: '808605510_480', encodeFormat: 'H264', videoFormat: 'mp4', audioInfo: 'SPA,SPA,ENG', licenseList: [{ license: 'lic_480' }] }
          ]
        }
      ]
    }]
  }));

  let result: any = null;
  let error: any = null;
  client.resolve('808605510', null, { trackIndex: 0 }, (err: any, res: any) => {
    error = err;
    result = res;
  });
  pump();

  assert.equal(error, null);
  assert.ok(result);
  assert.equal(result.tracks.length, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tracks.map((t: any) => t.quality))), ['1080P', '1080P', '720P', '480P']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tracks.map((t: any) => t.codec))), ['H265', 'H264', 'H265', 'H264']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.tracks.map((t: any) => t.format))), ['TS', 'MP4', 'TS', 'MP4']);

  const diag = client.getLastStartPlayDiag();
  assert.ok(diag);
  const serialized = JSON.stringify(diag);
  assert.equal(diag.contentId, '808605510');
  assert.equal(diag.episodeCount, 1);
  assert.equal(diag.beforeCollectTracks.length, 4);
  assert.equal(diag.afterCollectTracks.length, 4);
  assert.equal(diag.selectedIndex, 0);
  assert.equal(serialized.includes('lic_'), false);
  assert.equal(serialized.includes('tok_secret'), false);
  assert.equal(serialized.includes('http'), false);
});

test('series resolve sends episodeNumberList and picks matching episode from episodeList', () => {
  const { client, startPlayPayloads, pump } = createMockPortal(() => ({
    name: 'Homeland',
    episodeList: [
      {
        episodeNumber: 1,
        totalMovieList: [{
          quality: '720P',
          movieList: [{ contentId: 'ep1_trk', encodeFormat: 'H265', videoFormat: 'ts', audioInfo: 'SPA', licenseList: [{ license: 'lic_ep1' }] }]
        }]
      },
      {
        episodeNumber: 2,
        totalMovieList: [{
          quality: '1080P',
          movieList: [{ contentId: 'ep2_trk', encodeFormat: 'H265', videoFormat: 'ts', audioInfo: 'ENG', licenseList: [{ license: 'lic_ep2' }] }]
        }]
      }
    ]
  }));

  let result: any = null;
  let error: any = null;
  client.resolve('3080004_e2', '3080004', { episodeNumber: 2, trackIndex: 0 }, (err: any, res: any) => {
    error = err;
    result = res;
  });
  pump();

  assert.equal(error, null);
  assert.equal(startPlayPayloads.length, 1);
  assert.deepEqual(startPlayPayloads[0].episodeNumberList, [2]);
  assert.equal(result.quality, '1080P');
  assert.equal(result.audio, 'ENG');
  const diag = client.getLastStartPlayDiag();
  assert.equal(diag.episodeNumber, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(diag.afterCollectTracks.map((t: any) => t.contentId))), ['ep2_trk']);
});

test('subtitleList prefers srt/vtt over other formats, falls back to play.subtitleList, and deduplicates URLs', () => {
  const { client, pump } = createMockPortal(() => ({
    name: 'Subtitle Test',
    subtitleList: [
      {
        language: 'en',
        file: [{ fileType: 'srt', url: 'https://sub.example.invalid/en.srt' }]
      }
    ],
    episodeList: [{
      episodeNumber: 1,
      movieList: [
        { contentId: 'vid1', quality: '720P', encodeFormat: 'H265', videoFormat: 'ts', audioInfo: 'ENG', licenseList: [{ license: 'lic_s' }] }
      ],
      subtitleList: [
        {
          language: 'es',
          file: [
            { fileType: 'ass', url: 'https://sub.example.invalid/es.ass' },
            { fileType: 'vtt', url: 'https://sub.example.invalid/es.vtt' }
          ]
        },
        {
          language: 'es',
          file: [
            { fileType: 'vtt', url: 'https://sub.example.invalid/es.vtt' }
          ]
        }
      ]
    }]
  }));

  let result: any = null;
  let error: any = null;
  client.resolve('vid1', 'ser1', { episodeNumber: 1, trackIndex: 0 }, (err: any, res: any) => {
    error = err;
    result = res;
  });
  pump();

  assert.equal(error, null);
  assert.deepEqual(JSON.parse(JSON.stringify(result.subtitles)), [
    { lang: 'es', url: 'https://sub.example.invalid/es.vtt', format: 'vtt' },
    { lang: 'en', url: 'https://sub.example.invalid/en.srt', format: 'srt' }
  ]);
});

test('vodCdns filters out sign_type cs (Android Ranger) and selects goog and cfl CDNs', () => {
  const { client } = loadPortalClient(() => {});
  const slbMock = {
    cdn_list: [
      {
        tag: 'vod',
        main_addr: 'xauf.z4tkqzx5z0.com',
        url_list: [{ tag: 'free', sign_type: 'cs', url: '?sign_type=cs&token=cs_token' }]
      },
      {
        tag: 'vod',
        main_addr: 'schh.g65q0w35v.com',
        url_list: [{ tag: 'free', sign_type: 'cs', url: '?sign_type=cs&token=cs_token2' }]
      },
      {
        tag: 'vod',
        main_addr: 'ptccloud.lsdwedsfsc.site',
        spared_addr: 'ptccloud-bk.lsdwedsfsc.site',
        url_list: [{ tag: 'free', sign_type: 'goog', url: '?sign_type=goog&token=goog_token' }]
      },
      {
        tag: 'vod',
        main_addr: 'cflcdn.example.com',
        url_list: [{ tag: 'free', sign_type: 'cfl', url: '?sign_type=cfl&token=cfl_token' }]
      }
    ]
  };

  const picked = client.vodCdns(slbMock);
  assert.equal(picked.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(picked[0].bases)), ['http://ptccloud.lsdwedsfsc.site', 'http://ptccloud-bk.lsdwedsfsc.site']);
  assert.equal(picked[0].auth, '?sign_type=goog&token=goog_token');
  assert.deepEqual(JSON.parse(JSON.stringify(picked[1].bases)), ['http://cflcdn.example.com']);
  assert.equal(picked[1].auth, '?sign_type=cfl&token=cfl_token');
});

test('client identity and startPlayVOD payload send masmobile profile with 60291 and loginType 3', () => {
  const { client, startPlayPayloads, pump } = createMockPortal(() => ({
    name: 'Spider-Man: Un nuevo día',
    episodeList: [{
      contentId: '808605510',
      totalMovieList: [{
        quality: '1080P',
        movieList: [{ contentId: '808605510_1080', encodeFormat: 'H265', videoFormat: 'ts', audioInfo: 'SPA', licenseList: [{ license: 'lic_1' }] }]
      }]
    }]
  }));

  let result: any = null;
  client.resolve('808605510', null, { trackIndex: 0 }, (_err: any, res: any) => {
    result = res;
  });
  pump();

  assert.ok(result);
  assert.equal(startPlayPayloads.length, 1);
  const p = startPlayPayloads[0];
  assert.equal(p.portalCode, 'masmobile');
  assert.equal(p.appId, 'com.msandroid.mobile');
  assert.equal(p.apkVersion, '60291');
  assert.equal(p.sysVersion, '15');
  assert.equal(p.loginType, '3');
  assert.equal(p.model, 'SM-G998B');
  assert.equal(p.hardwareInfo, 'exynos2100');
});
