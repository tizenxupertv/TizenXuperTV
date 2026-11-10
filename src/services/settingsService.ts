import { pk } from '../lib/localProfiles';
import { readStoredJson } from '../lib/storedJson';
const KEY = pk('xuper_global_playback_v1');

export interface PlaybackSettings {
  display: number;   // 0 = fit (letterbox), 1 = fullscreen, 2 = auto
  autoNext?: boolean;// true = auto play next episode on finish
  audio: number;     // 0 = Español, 1 = Portugués, 2 = Inglés
  subtitle: boolean;
  subLang: number;
  size: number;      // 0 = Normal, 1 = Grande, 2 = Pequeño
  style: number;
  textSize?: number; // 0 = Normal, 1 = Mediano, 2 = Grande (styles/textSize.css)
  quality: number;   // index in QUALITY_OPTIONS (0 = Automática)
}

/** "Resolución" of the detail: preferred quality among the portal's tracks of a title */
export const QUALITY_OPTIONS = ['Auto', '1080p', '720p', '480p'];

const DEFAULTS: PlaybackSettings = {
  display: 0,
  audio: 0,
  subtitle: true,
  subLang: 0,
  size: 0,
  style: 0,
  quality: 0
};

class SettingsService {
  private listeners: Array<() => void> = [];

  public get(): PlaybackSettings {
    // Read on every render of the players: parsed once per stored text (lib/storedJson.ts)
    const stored = readStoredJson<Partial<PlaybackSettings>>(KEY);
    return stored && typeof stored === 'object' ? { ...DEFAULTS, ...stored } : { ...DEFAULTS };
  }

  public set(patch: Partial<PlaybackSettings>): PlaybackSettings {
    const next = { ...this.get(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) {}
    applyTextSize(next);
    this.listeners.forEach(cb => {
      try { cb(); } catch (e) {}
    });
    return next;
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }
}

export const settingsService = new SettingsService();

/** "Tamaño del texto": the class on <html> that styles/textSize.css reads */
function applyTextSize(st: PlaybackSettings): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('text-md', st.textSize === 1);
  document.documentElement.classList.toggle('text-lg', st.textSize === 2);
}
applyTextSize(settingsService.get());

/** Row of each setting in the detail's settings list (Audio, Subtítulos, Resolución) */
export const SETTINGS_ROW: Record<'audio' | 'subs' | 'quality', number> = { audio: 0, subs: 1, quality: 2 };

/** Applies option `index` of a setting of the detail's settings list */
export function applySettingChoice(col: 'audio' | 'subs' | 'quality', index: number): void {
  if (col === 'audio') settingsService.set({ audio: index });
  else if (col === 'subs') applySubtitleChoice(index);
  else settingsService.set({ quality: index });
}

/** Language codes in the same order as the audio / subtitle language options of the profile */
export const PREFERRED_LANGUAGES = ['Español (Latino)', 'Español (España)', 'Portugués', 'Inglés'];

/** Subtitle options of the detail modal: "Desactivados" followed by the languages */
export const SUBTITLE_CHOICES = ['Desactivados', ...PREFERRED_LANGUAGES];

export function subtitleChoiceIndex(st: PlaybackSettings): number {
  return st.subtitle ? st.subLang + 1 : 0;
}

export function applySubtitleChoice(idx: number): void {
  if (idx <= 0) settingsService.set({ subtitle: false });
  else settingsService.set({ subtitle: true, subLang: idx - 1 });
}
