/**
 * What the detail's settings list (Audio / Subtítulos / Resolución) offers for one title: only the languages and
 * qualities its tracks really have. Each result is a list of indices into the usual option lists (the profile's
 * preferences keep their meaning); the first entry of subtitles ("Desactivados") and of quality ("Auto") is always there.
 * While the title's tracks are unknown (`null`) every option is offered, as before.
 * Imports only other pure files, so test/titleOptions.test.ts can load this one in Node.
 */
import { PREF_LANG_CODES, languageName, sameLanguage } from './subtitles';

/** What the portal says a title has (MagisClient.mediaOptions) */
export interface TitleMedia {
  audios: string[];
  qualities: string[];
  subtitles: string[];
}

export interface TitleChoices {
  /** Indices of PREFERRED_LANGUAGES present in the title's audio */
  audio: number[];
  /** Indices of SUBTITLE_CHOICES: 0 = off, then the languages present in its subtitles */
  subs: number[];
  /** Indices of QUALITY_OPTIONS: 0 = Auto, then the qualities present ("1080p" matches "1080", "FHD 1080P"…) */
  quality: number[];
}

const range = (n: number, from = 0) => Array.from({ length: n - from }, (_, i) => i + from);

/** Does a track quality label ("1080P", "FHD") match an option ("1080p")? */
export function qualityMatches(label: string, option: string): boolean {
  const wanted = option.replace(/p$/i, '');
  return !!wanted && String(label || '').indexOf(wanted) !== -1;
}

export function titleChoices(media: TitleMedia | null, languageCount: number, qualityOptions: string[]): TitleChoices {
  if (!media) {
    return { audio: range(languageCount), subs: range(languageCount + 1), quality: range(qualityOptions.length) };
  }
  const audio = range(languageCount).filter(i => media.audios.some(a => sameLanguage(a, PREF_LANG_CODES[i])));
  const subs = [0, ...range(languageCount).filter(i => media.subtitles.some(s => sameLanguage(s, PREF_LANG_CODES[i]))).map(i => i + 1)];
  const quality = [0, ...range(qualityOptions.length, 1).filter(i => media.qualities.some(q => qualityMatches(q, qualityOptions[i])))];
  return { audio, subs, quality };
}

/**
 * The option index that will really apply: the profile's choice when the title has it, else what the player falls back
 * to (audio: the title's first language, shown by name through `audioFallback`; quality: Auto; subtitles: off).
 * Returns -1 for audio with no matching language, so the caller shows the title's own language.
 */
export function effectiveChoice(allowed: number[], preferred: number): number {
  if (allowed.indexOf(preferred) !== -1) return preferred;
  return allowed.length ? allowed[0] : -1;
}

/** Name of the title's own first audio language, for when none of the four preferences exists in it */
export function ownAudioName(media: TitleMedia | null): string {
  return media && media.audios.length ? languageName(media.audios[0]) : '';
}
