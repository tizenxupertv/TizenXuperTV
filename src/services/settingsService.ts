const KEY = 'xuper_global_playback_v1';

export interface PlaybackSettings {
  display: number;   // 0 = fit (letterbox), 1 = fullscreen, 2 = auto
  audio: number;     // 0 = Español, 1 = Portugués, 2 = Inglés
  subtitle: boolean;
  subLang: number;
  size: number;      // 0 = Normal, 1 = Grande, 2 = Pequeño
  style: number;
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
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) {}
    return { ...DEFAULTS };
  }

  public set(patch: Partial<PlaybackSettings>): PlaybackSettings {
    const next = { ...this.get(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) {}
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
