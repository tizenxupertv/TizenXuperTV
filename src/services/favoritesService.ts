import { withoutFavorite } from '../lib/profileHistory';
import { pk } from '../lib/localProfiles';

const PROFILE_KEY = pk('xuper_local_profile_v1');

class FavoritesService {
  private listeners: Array<() => void> = [];

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
    const profile = this.getProfile();
    return !!(profile.favs && profile.favs[String(id)]);
  }

  public toggleFavorite(id: string | number): boolean {
    const profile = this.getProfile();
    if (!profile.favs) profile.favs = {};
    const key = String(id);
    const newState = !profile.favs[key];
    if (newState) {
      profile.favs[key] = true;
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

  public getFavoriteIds(): string[] {
    const profile = this.getProfile();
    return profile.favs ? Object.keys(profile.favs).filter(k => profile.favs[k]) : [];
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
