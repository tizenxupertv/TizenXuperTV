import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveredQualities, effectiveChoice, ownAudioName, qualityMatches, titleChoices, trackForQuality } from '../src/lib/titleOptions.ts';

import { PREF_LANG_CODES, languageName, sameLanguage, audioCoversSubtitles, subtitlesWanted, formatAudioTrackList, formatResolutionBadge, formatQualityTag, firstQuality } from '../src/lib/subtitles.ts';

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

test('formatAudioTrackList formats multi-audio tracks into distinct readable labels', () => {
  const result = formatAudioTrackList(['SPA', 'SPA', 'ENG']);
  assert.deepEqual(result, [
    { lang: 'SPA', label: 'Español (Latino)' },
    { lang: 'SPA', label: 'Español (España)' },
    { lang: 'ENG', label: 'Inglés' }
  ]);

  const commaSeparated = formatAudioTrackList(['SPA,SPA,ENG']);
  assert.deepEqual(commaSeparated, [
    { lang: 'SPA', label: 'Español (Latino)' },
    { lang: 'SPA', label: 'Español (España)' },
    { lang: 'ENG', label: 'Inglés' }
  ]);

  const singleSpanish = formatAudioTrackList(['SPA', 'ENG']);
  assert.deepEqual(singleSpanish, [
    { lang: 'SPA', label: 'Español (Latino)' },
    { lang: 'ENG', label: 'Inglés' }
  ]);
});

test('formatResolutionBadge normalizes aspect-ratio dimensions and quality keys to standard badges', () => {
  assert.equal(formatResolutionBadge('1920×800', '1080p'), '1080p');
  assert.equal(formatResolutionBadge('1920×1080', '1080p'), '1080p');
  assert.equal(formatResolutionBadge('3840×1600', '4k'), '4K');
  assert.equal(formatResolutionBadge('1280×536', '720p'), '720p');
  assert.equal(formatResolutionBadge('854×480', '480p'), '480p');
  assert.equal(formatResolutionBadge('', '1080p'), '1080p');
  assert.equal(formatResolutionBadge('', '4K Ultra HD'), '4K');
});

test('formatQualityTag returns 4K, FHD, HD or SD according to option A', () => {
  assert.equal(formatQualityTag('4k'), '4K');
  assert.equal(formatQualityTag('2160p'), '4K');
  assert.equal(formatQualityTag('UHD'), '4K');
  assert.equal(formatQualityTag('1080p'), 'FHD');
  assert.equal(formatQualityTag('1080P'), 'FHD');
  assert.equal(formatQualityTag('FHD'), 'FHD');
  assert.equal(formatQualityTag('720p'), 'HD');
  assert.equal(formatQualityTag('HD'), 'HD');
  assert.equal(formatQualityTag('480p'), 'SD');
  assert.equal(formatQualityTag(['720p', '1080p']), 'FHD');
  assert.equal(formatQualityTag(['1080p', '4k']), '4K');
  assert.equal(formatQualityTag('', 'uhd,gratis'), '4K');
  assert.equal(formatQualityTag(''), '');
  assert.equal(formatQualityTag(undefined), '');
});

test('firstQuality skips empty lists and blank texts, so a known quality is not hidden', () => {
  assert.deepEqual(firstQuality([], '', ['720p', '1080p']), ['720p', '1080p']);
  assert.equal(firstQuality([], '1080p', ['480p']), '1080p');
  assert.equal(firstQuality(undefined, null, [], '  '), undefined);
  assert.equal(formatQualityTag(firstQuality([], undefined, ['720p', '1080p', '480p'])), 'FHD');
});

test('audioCoversSubtitles: decided by the audio that plays, not by the list of the title', () => {
  // English plays on a title that also carries Spanish: Spanish subtitles are wanted
  assert.equal(audioCoversSubtitles({ label: 'Inglés', lang: 'ENG' }, 'SPA,ENG', 'es-es'), false);
  // Spanish plays: subtitles in Spanish would repeat it
  assert.equal(audioCoversSubtitles({ label: 'Español (España)', lang: 'SPA' }, 'SPA,ENG', 'es-es'), true);
  // Unknown playing track: the title's audio decides
  assert.equal(audioCoversSubtitles(undefined, 'ENG', 'es-es'), false);
  assert.equal(audioCoversSubtitles(undefined, 'SPA', 'es-lat'), true);
});

test('subtitlesWanted: off, only for another language (default), or always', () => {
  assert.equal(subtitlesWanted({ subtitle: false, subAlways: true }, false), false);
  // Default: shown for audio in another language, skipped when the audio is already in that language
  assert.equal(subtitlesWanted({ subtitle: true }, false), true);
  assert.equal(subtitlesWanted({ subtitle: true }, true), false);
  // Siempre: shown even over audio in the same language
  assert.equal(subtitlesWanted({ subtitle: true, subAlways: true }, true), true);
});
