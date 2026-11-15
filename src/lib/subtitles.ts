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
  if (!raw) return 'Original';

  // Support comma-separated language codes, e.g. "SPA,SPA,ENG"
  if (raw.includes(',')) {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    const names: string[] = [];
    for (const p of parts) {
      const n = languageName(p);
      if (n && n !== 'Original' && !names.includes(n)) {
        names.push(n);
      }
    }
    if (names.length > 0) return names.join(', ');
  }

  const c = raw.toLowerCase();

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
  if (code && code.includes(',')) {
    return code.split(',').some(part => sameLanguage(part.trim(), pref));
  }
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

/**
 * Whether subtitles in `pref` would repeat the audio: true only when the audio that plays is in that language.
 * The title's whole audio list (e.g. "SPA,ENG") is used just when the playing track is unknown: asked first, it
 * said yes for any title that merely carries the language, so English audio started without Spanish subtitles.
 */
export function audioCoversSubtitles(
  playing: { label?: string; lang?: string } | undefined,
  titleAudio: string | undefined,
  pref: string
): boolean {
  if (playing && (playing.label || playing.lang)) return sameLanguage(playing.label || playing.lang, pref);
  return sameLanguage(titleAudio, pref);
}

/** Whether a title starts with subtitles: off, always, or only when the audio that plays is in another language */
export function subtitlesWanted(st: { subtitle: boolean; subAlways?: boolean }, audioInSubtitleLanguage: boolean): boolean {
  if (!st.subtitle) return false;
  return !!st.subAlways || !audioInSubtitleLanguage;
}

/**
 * Formats a list of raw audio language codes (e.g. ['SPA', 'SPA', 'ENG'] or ['SPA,SPA,ENG'])
 * into user-friendly distinct labels (e.g. ['Español (Latino)', 'Español (España)', 'Inglés']).
 */
export function formatAudioTrackList(langs: (string | undefined)[]): { lang: string; label: string }[] {
  const expanded: string[] = [];
  for (const l of langs) {
    const str = String(l || '').trim();
    if (str.includes(',')) {
      expanded.push(...str.split(',').map(s => s.trim()).filter(Boolean));
    } else if (str) {
      expanded.push(str);
    }
  }
  if (expanded.length === 0) return [{ lang: '', label: 'Original' }];

  let spanishCount = 0;
  for (const l of expanded) {
    const norm = l.toLowerCase();
    if (norm.startsWith('es') || norm.startsWith('spa') || norm.startsWith('esp')) {
      spanishCount++;
    }
  }

  let spanishSeen = 0;
  return expanded.map(raw => {
    const norm = raw.toLowerCase();
    const isSpanish = norm.startsWith('es') || norm.startsWith('spa') || norm.startsWith('esp');
    if (isSpanish && !norm.includes('lat') && !norm.includes('es-') && !norm.includes('cast')) {
      spanishSeen++;
      if (spanishCount > 1) {
        return {
          lang: raw,
          label: spanishSeen === 1 ? 'Español (Latino)' : 'Español (España)'
        };
      }
      return { lang: raw, label: 'Español (Latino)' };
    }
    return { lang: raw, label: languageName(raw) };
  });
}

/** Formats raw video dimensions (e.g. 1920×800) or quality string into a standard player badge (e.g. 1080p, 4K) */
export function formatResolutionBadge(dimensions?: string, quality?: string): string {
  const m = String(dimensions || '').match(/(\d+)\s*[×x]\s*(\d+)/);
  if (m) {
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (w >= 3800 || h >= 2000) return '4K';
    if (w >= 1900 || h >= 1000) return '1080p';
    if (w >= 1200 || h >= 700) return '720p';
    if (w >= 640 || h >= 400) return '480p';
  }
  const s = String(quality || '').toLowerCase();
  if (s.includes('4k') || s.includes('2160')) return '4K';
  if (s.includes('1080') || s.includes('fhd')) return '1080p';
  if (s.includes('720') || s.includes('hd')) return '720p';
  if (s.includes('480') || s.includes('sd')) return '480p';
  return quality || dimensions || '';
}

/**
 * Normalizes quality definitions into short standard tags: '4K', 'FHD', 'HD', 'SD'.
 * Handles strings like '1080p', '1080P', '4K', '2160p', 'HD', 'FHD', 'UHD', arrays or comma-separated lists.
 */
/**
 * The first candidate that really names a quality. A catalog title often carries an empty list, which `||` takes
 * as present and so hid the qualities already known from the cache.
 */
export function firstQuality(...candidates: Array<string | string[] | null | undefined>): string | string[] | undefined {
  for (const c of candidates) {
    if (Array.isArray(c) ? c.some(q => String(q || '').trim()) : String(c || '').trim()) return c as string | string[];
  }
  return undefined;
}

export function formatQualityTag(quality?: string | string[], category?: string): string {
  if (!quality && category) {
    const cat = String(category).toLowerCase();
    if (cat.includes('uhd') || cat.includes('4k')) return '4K';
  }
  if (!quality) return '';
  const list: string[] = Array.isArray(quality)
    ? quality
    : String(quality).split(',').map(s => s.trim()).filter(Boolean);

  let bestRank = 0;
  let bestTag = '';

  for (const item of list) {
    const s = String(item || '').toLowerCase().trim();
    if (!s) continue;
    if (s.includes('4k') || s.includes('2160') || s.includes('uhd')) {
      if (bestRank < 4) { bestRank = 4; bestTag = '4K'; }
    } else if (s.includes('1080') || s.includes('fhd')) {
      if (bestRank < 3) { bestRank = 3; bestTag = 'FHD'; }
    } else if (s.includes('720') || s.includes('hd')) {
      if (bestRank < 2) { bestRank = 2; bestTag = 'HD'; }
    } else if (s.includes('480') || s.includes('sd')) {
      if (bestRank < 1) { bestRank = 1; bestTag = 'SD'; }
    }
  }

  return bestTag;
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
    const isLocal = typeof window !== 'undefined' && (
      import.meta.env.DEV ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
    if (!isLocal) throw e;
    const res = await fetch(`/stream-proxy?url=${encodeURIComponent(url)}`);
    return parseSubtitles(await res.text());
  }
}
