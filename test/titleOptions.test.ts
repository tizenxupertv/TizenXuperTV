import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveredQualities, effectiveChoice, ownAudioName, qualityMatches, titleChoices, trackForQuality } from '../src/lib/titleOptions.ts';

import { PREF_LANG_CODES, languageName, sameLanguage } from '../src/lib/subtitles.ts';

const QUALITY = ['Auto', '1080p', '720p', '480p'];
const lang = { matches: (label: string, i: number) => sameLanguage(label, PREF_LANG_CODES[i]), name: languageName };
const LANGS = 4; // Español (Latino), Español (España), Portugués, Inglés

test('while the tracks are unknown every option is offered', () => {
  assert.deepEqual(titleChoices(null, LANGS, QUALITY, lang), { audio: [0, 1, 2, 3], subs: [0, 1, 2, 3, 4], quality: [0, 1, 2, 3] });
});

test('audio, subtitles and quality list only what the title has', () => {
  const c = titleChoices({ audios: ['Portugués', 'Inglés'], qualities: ['1080P', 'HD'], subtitles: ['en', 'pt'] }, LANGS, QUALITY, lang);
  assert.deepEqual(c.audio, [2, 3]);
  assert.deepEqual(c.subs, [0, 3, 4], 'off, Portugués, Inglés');
  assert.deepEqual(c.quality, [0, 1], 'Auto and 1080p');
});

test('a title with generic Spanish offers both Spanish options; a title with nothing known offers only Auto and off', () => {
  assert.deepEqual(titleChoices({ audios: ['Español'], qualities: [], subtitles: [] }, LANGS, QUALITY, lang), { audio: [0, 1], subs: [0], quality: [0] });
  assert.deepEqual(titleChoices({ audios: ['Francés'], qualities: ['HD'], subtitles: [] }, LANGS, QUALITY, lang).audio, []);
});

test('quality labels match their option, not other numbers', () => {
  assert.equal(qualityMatches('FHD 1080P', '1080p'), true);
  assert.equal(qualityMatches('720', '720p'), true);
  assert.equal(qualityMatches('480P', '720p'), false);
  assert.equal(qualityMatches('HD', 'Auto'), false, 'Auto is never matched by a label: titleChoices always allows it');
});

test('the effective choice is the profile one when available, else the first allowed one', () => {
  assert.equal(effectiveChoice([2, 3], 3), 3);
  assert.equal(effectiveChoice([2, 3], 0), 2);
  assert.equal(effectiveChoice([], 0), -1);
});

test("the title's own language names the audio when no preference exists in it", () => {
  assert.equal(ownAudioName({ audios: ['Francés'], qualities: [], subtitles: [] }, lang), 'FRANCÉS');
  assert.equal(ownAudioName(null, lang), '');
});

test('the quality menu offers Auto and only what the tracks deliver', () => {
  const QUALITY_OPTIONS = ['Auto', '1080p', '720p', '480p'];
  assert.deepEqual(deliveredQualities(['720p'], QUALITY_OPTIONS), [0, 2]);
  assert.deepEqual(deliveredQualities(['1080P', '720p'], QUALITY_OPTIONS), [0, 1, 2]);
  assert.deepEqual(deliveredQualities([], QUALITY_OPTIONS), [0]);
});

test('choosing a quality switches to its track in the same audio, when there is one', () => {
  const tracks = [
    { index: 0, audio: 'spa', quality: '720p' },
    { index: 1, audio: 'eng', quality: '1080p' },
    { index: 2, audio: 'spa', quality: '1080p' }
  ];
  assert.equal(trackForQuality(tracks, 0, '1080p'), 2);
  assert.equal(trackForQuality(tracks, 0, '720p'), -1);
  assert.equal(trackForQuality(tracks, 0, '480p'), -1);
  assert.equal(trackForQuality([{ index: 0, audio: 'spa', quality: '720p' }], 0, '1080p'), -1);
});
