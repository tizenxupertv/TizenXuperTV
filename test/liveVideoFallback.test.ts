import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoCodecRejected, directManifestBlocked, shouldMoveLiveToAvPlay } from '../src/lib/liveVideoFallback.ts';

// What hls.js 1.6 sends when the TV's MediaSource refuses the video SourceBuffer: it drops the track,
// keeps playing the audio and reports it as a non-fatal error
const hevcRejected = {
  type: 'mediaError',
  details: 'bufferAddCodecError',
  fatal: false,
  sourceBufferName: 'video',
  mimeType: 'video/mp4;codecs=hvc1.1.6.L93.B0'
};

test('videoCodecRejected: the video SourceBuffer the TV refused', () => {
  assert.equal(videoCodecRejected(hevcRejected), 'video/mp4;codecs=hvc1.1.6.L93.B0');
  assert.equal(videoCodecRejected({ ...hevcRejected, sourceBufferName: 'audiovideo', mimeType: '' }), 'audiovideo');
});

test('videoCodecRejected: anything else is not a lost picture', () => {
  assert.equal(videoCodecRejected({ ...hevcRejected, sourceBufferName: 'audio', mimeType: 'audio/mp4;codecs=ac-3' }), '');
  assert.equal(videoCodecRejected({ ...hevcRejected, details: 'bufferStalledError' }), '');
  assert.equal(videoCodecRejected(null), '');
  assert.equal(videoCodecRejected(undefined), '');
});

test('shouldMoveLiveToAvPlay: once per channel, only on a TV with AVPlay', () => {
  const tv = { hasAvPlay: true, code: '101', triedCode: '' };
  assert.equal(shouldMoveLiveToAvPlay(hevcRejected, tv), true);
  // AVPlay already failed for this channel (its fallback brought it back to hls.js): keep the sound, no loop
  assert.equal(shouldMoveLiveToAvPlay(hevcRejected, { ...tv, triedCode: '101' }), false);
  // Another channel later gets its own try
  assert.equal(shouldMoveLiveToAvPlay(hevcRejected, { ...tv, triedCode: '55' }), true);
  // Browser or a TV without AVPlay: nothing to move to
  assert.equal(shouldMoveLiveToAvPlay(hevcRejected, { ...tv, hasAvPlay: false }), false);
  // No channel playing
  assert.equal(shouldMoveLiveToAvPlay(hevcRejected, { ...tv, code: '' }), false);
  // An audio codec the TV refused does not cost the picture
  assert.equal(shouldMoveLiveToAvPlay({ ...hevcRejected, sourceBufferName: 'audio' }, tv), false);
});

const directCorsBlocked = {
  type: 'networkError',
  details: 'manifestLoadError',
  fatal: true,
  response: { code: 0 }
};

test('directManifestBlocked: fatal manifestLoadError/TimeOut with HTTP 0 or 403 on direct streams', () => {
  assert.equal(directManifestBlocked(directCorsBlocked, true), true);
  assert.equal(directManifestBlocked({ ...directCorsBlocked, details: 'manifestLoadTimeOut', response: { code: 403 } }, true), true);
  assert.equal(directManifestBlocked({ ...directCorsBlocked, response: { code: 404 } }, true), false);
  assert.equal(directManifestBlocked({ ...directCorsBlocked, fatal: false }, true), false);
  assert.equal(directManifestBlocked(directCorsBlocked, false), false);
  assert.equal(directManifestBlocked({ ...directCorsBlocked, details: 'fragLoadError' }, true), false);
});

test('shouldMoveLiveToAvPlay: rescues CORS-blocked direct channels on TV with AVPlay once', () => {
  const tvDirect = { hasAvPlay: true, code: 'iptv:test', triedCode: '', isDirect: true };
  assert.equal(shouldMoveLiveToAvPlay(directCorsBlocked, tvDirect), true);
  assert.equal(shouldMoveLiveToAvPlay(directCorsBlocked, { ...tvDirect, isDirect: false }), false);
  assert.equal(shouldMoveLiveToAvPlay(directCorsBlocked, { ...tvDirect, triedCode: 'iptv:test' }), false);
  assert.equal(shouldMoveLiveToAvPlay(directCorsBlocked, { ...tvDirect, hasAvPlay: false }), false);
});
