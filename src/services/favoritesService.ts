import { withoutFavorite } from '../lib/profileHistory.ts';
import { pk } from '../lib/localProfiles.ts';
import { isAdultItem } from '../lib/catalogOrganizer.ts';
import { historyService } from './historyService.ts';
import { readStoredJson } from '../lib/storedJson.ts';

const PROFILE_KEY = pk('xuper_local_profile_v1');

export interface FavoriteInfo {
  title: string;
  poster: string;
  series: boolean;
}

/** What a favorite keeps from the title (a VodItem or the portal's detail) */
export interface FavoriteSource {
  id?: string | number;
  title?: string;
  poster?: string;
  landscape?: string;
  backdrop?: string;
  isSeries?: boolean;
  kind?: string;
  category?: string;
  restricted?: boolean;
  privateContent?: boolean;
}

function infoOf(item: FavoriteSource): FavoriteInfo {
  return {
    title: item.title || '',
    poster: item.poster || item.landscape || item.backdrop || '',
    series: !!(item.isSeries || item.kind === 'serie')
  };
}

class FavoritesService {
  private listeners: Array<() => void> = [];
  private migrationChecked = false;

  /**
   * The profile for reading only: parsed once per stored text (lib/storedJson.ts). getProfile() parses a copy of its
   * own for the code that edits and saves it, and copies the main profile's favourites into a new profile; that check
   * runs once per start here, not on every read. Never change what this returns
   */
  private readProfile(): any {
    if (!this.migrationChecked) {
      this.migrationChecked = true;
      return this.getProfile();
    }
    return readStoredJson(PROFILE_KEY) || { favs: {} };
  }

  private getProfile(): any {
    try {
      let raw = localStorage.getItem(PROFILE_KEY);
      if (PROFILE_KEY !== 'xuper_local_profile_v1') {
        const mainRaw = localStorage.getItem('xuper_local_profile_v1');
        if (mainRaw) {
          try {
            const mainParsed = JSON.parse(mainRaw);
            if (mainParsed && mainParsed.favs && Object.keys(mainParsed.favs).length > 0) {
              const currentParsed = raw ? JSON.parse(raw) : null;
              const favMigrationFlag = `${PROFILE_KEY}_migrated_favs_v1`;
              if (!localStorage.getItem(favMigrationFlag)) {
                localStorage.setItem(favMigrationFlag, '1');
                const mergedProfile = {
                  ...currentParsed,
                  favs: { ...mainParsed.favs, ...((currentParsed && currentParsed.favs) || {}) }
                };
                localStorage.setItem(PROFILE_KEY, JSON.stringify(mergedProfile));
                return mergedProfile;
              }
            }
          } catch (mErr) {}
        }
      }

      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { favs: {} };
  }

  public isFavorite(id: string | number): boolean {
    if (historyService.isRestricted({ id })) return false;
    const profile = this.readProfile();
    return !!(profile.favs && profile.favs[String(id)]);
  }

  /**
   * Adds or removes a title from Mi lista. With the item, its title and poster are kept with it, so Mi lista can show
   * titles that are not in the loaded catalog (older favorites saved only `true`)
   */
  public toggleFavorite(id: string | number, item?: FavoriteSource): boolean {
    const key = String(id);
    if (
      historyService.isRestricted({ id: key, ...(item || {}) }) ||
      (item && (isAdultItem(item as any) || item.restricted || item.privateContent))
    ) {
      historyService.markPrivate({ id: key });
      const profile = this.getProfile();
      if (profile.favs && profile.favs[key]) {
        delete profile.favs[key];
        try {
          localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
        } catch (e) {}
        this.notify();
      }
      return false;
    }
    const profile = this.getProfile();
    if (!profile.favs) profile.favs = {};
    const newState = !profile.favs[key];
    if (newState) {
      profile.favs[key] = item ? infoOf(item) : true;
    } else {
      delete profile.favs[key];
    }
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (e) {}
    this.notify();
    return newState;
  }

  /** Removes one favorite. False if it could not be saved. */
  public removeFavorite(id: string | number): boolean {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(withoutFavorite(this.getProfile(), id)));
    } catch (e) {
      return false;
    }
    this.notify();
    return true;
  }

  /** Title, poster and kind saved with a favorite, when known */
  public getFavoriteInfo(id: string | number): FavoriteInfo | null {
    const v = this.readProfile().favs?.[String(id)];
    return v && typeof v === 'object' && v.title ? (v as FavoriteInfo) : null;
  }

  /** Saves what is known about a favorite that was stored without it */
  public setFavoriteInfo(id: string | number, item: FavoriteSource): void {
    const profile = this.getProfile();
    const key = String(id);
    if (!profile.favs || !profile.favs[key]) return;
    profile.favs[key] = infoOf(item);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (e) {}
    this.notify();
  }

  public getFavoriteIds(): string[] {
    const profile = this.readProfile();
    return profile.favs
      ? Object.keys(profile.favs).filter(k => {
          const val = profile.favs[k];
          if (!val) return false;
          if (typeof val === 'object') return !historyService.isRestricted({ id: k, ...val });
          return !historyService.isRestricted({ id: k });
        })
      : [];
  }

  public subscribe(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  private notify() {
    this.listeners.forEach(cb => {
      try { cb(); } catch (e) {}
    });
  }
}

export const favoritesService = new FavoritesService();
