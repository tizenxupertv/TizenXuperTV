export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleTrack {
  lang: string;
  url: string;
  format?: string;
}

const LANG_NAMES: Record<string, string> = {
  es: 'Español', spa: 'Español', esp: 'Español',
  en: 'Inglés', eng: 'Inglés',
  pt: 'Portugués', por: 'Portugués', pob: 'Portugués',
  fr: 'Francés', fre: 'Francés', fra: 'Francés',
  it: 'Italiano', ita: 'Italiano',
  de: 'Alemán', ger: 'Alemán', deu: 'Alemán',
  ja: 'Japonés', jpn: 'Japonés',
  ko: 'Coreano', kor: 'Coreano',
  zh: 'Chino', chi: 'Chino', zho: 'Chino',
  ru: 'Ruso', rus: 'Ruso',
  tr: 'Turco', tur: 'Turco'
};

/** Distinguishes Spanish dialects (Latino vs España / Castellano) and languages */
export function languageName(code: string | undefined): string {
  const raw = String(code || '').trim();
  const c = raw.toLowerCase();
  if (!c) return 'Original';

  // Explicit Latin American Spanish variants
  if (/latino|latam|latin|419|es[-_]419|es[-_]la|es[-_]mx|es[-_]ar|es[-_]co|spa[-_]lat/i.test(c)) {
    return 'Español (Latino)';
  }
  // Explicit Spain / Castilian variants
  if (/castellano|castilian|es[-_]es|spa[-_]es|españa|espana|iberian/i.test(c)) {
    return 'Español (España)';
  }

  // Base code check
  const base = c.split(/[-_]/)[0];
  if (base === 'es' || base === 'spa' || base === 'esp') {
    if (c.includes('419') || c.includes('mx') || c.includes('ar') || c.includes('co') || c.includes('cl') || c.includes('lat')) {
      return 'Español (Latino)';
    }
    if (c.includes('es')) {
      return 'Español (España)';
    }
    return 'Español';
  }

  const known = LANG_NAMES[c] || LANG_NAMES[base];
  if (known) return known;

  // Already human-readable formatted names
  if (c.startsWith('español (latino)') || c.startsWith('espanol (latino)')) return 'Español (Latino)';
  if (c.startsWith('español (españa)') || c.startsWith('espanol (espana)') || c.startsWith('español (castellano)')) return 'Español (España)';
  if (c.startsWith('español') || c.startsWith('espanol')) return 'Español';
  if (c.startsWith('inglés') || c.startsWith('ingles')) return 'Inglés';
  if (c.startsWith('portugués') || c.startsWith('portugues')) return 'Portugués';

  return raw.toUpperCase();
}

/** Order of the language preference stored in the profile settings */
export const PREF_LANG_CODES = ['es-lat', 'es-es', 'pt', 'en'];

export function sameLanguage(code: string | undefined, pref: string): boolean {
  const trackLang = languageName(code);
  const prefLang = languageName(pref);

  // Exact match
  if (trackLang === prefLang) return true;

  // Dialect preference matching with generic fallback
  if (pref === 'es-lat' || prefLang === 'Español (Latino)') {
    if (trackLang === 'Español (Latino)') return true;
    if (trackLang === 'Español') return true; // generic Spanish is acceptable fallback
    return false;
  }
  if (pref === 'es-es' || prefLang === 'Español (España)') {
    if (trackLang === 'Español (España)') return true;
    if (trackLang === 'Español') return true; // generic Spanish fallback
    return false;
  }
  if (pref === 'es' || prefLang === 'Español') {
    if (trackLang.startsWith('Español')) return true;
  }

  return trackLang === prefLang;
}

function toSeconds(stamp: string): number {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(stamp.trim());
  if (!m) return 0;
  return (parseInt(m[1] || '0', 10) * 3600) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
}

/** Parses SRT and WebVTT text into cues */
export function parseSubtitles(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const timing = lines.findIndex(l => l.indexOf('-->') !== -1);
    if (timing === -1) continue;
    const [a, b] = lines[timing].split('-->');
    const body = lines.slice(timing + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
    if (body) cues.push({ start: toSeconds(a), end: toSeconds(b), text: body });
  }
  return cues;
}

export function cueAt(cues: SubtitleCue[], t: number): string {
  for (const c of cues) {
    if (t >= c.start && t <= c.end) return c.text;
  }
  return '';
}

/** Downloads a subtitle file (the dev server proxy is used when the browser blocks it) */
export async function loadSubtitle(url: string): Promise<SubtitleCue[]> {
  try {
    const res = await fetch(url);
    return parseSubtitles(await res.text());
  } catch (e) {
    if (!import.meta.env.DEV) throw e;
    const res = await fetch(`/stream-proxy?url=${encodeURIComponent(url)}`);
    return parseSubtitles(await res.text());
  }
}
