import { applyCopy, buildCopy, hasUserData, readCopy } from '../lib/cloudBackup';
import { accountService } from './accountService';
import { historyService } from './historyService';
import { favoritesService } from './favoritesService';

/** A change is sent this long after the last one (several titles watched in a row make one save) */
const SAVE_DELAY_MS = 60_000;
/** Live favourites and settings change without an event: the copy is compared this often */
const CHECK_EVERY_MS = 5 * 60_000;
/** The first save waits for the app to settle after start */
const FIRST_SAVE_MS = 30_000;
/** Set for the reload that follows a restore, so a restore that wrote nothing new cannot loop */
const RESTORED_FLAG = 'xuper_cloud_restored';

let started = false;
let lastSent = '';
let timer: ReturnType<typeof setTimeout> | null = null;

function save(): void {
  timer = null;
  if (!accountService.isSignedIn()) return;
  let copy;
  try { copy = buildCopy(localStorage); } catch (e) { return; }
  // A TV with nothing yet never replaces the account's copy with an empty one
  if (!hasUserData(localStorage)) return;
  const text = JSON.stringify(copy);
  if (text === lastSent) return;
  accountService.saveUserData(copy).then(ok => { if (ok) lastSent = text; });
}

function schedule(delay = SAVE_DELAY_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(save, delay);
}

/**
 * Keeps the user's lists, history, profiles and live favourites in their Telegram account (bot /tv/data), and
 * puts them back on a TV that has none after signing in (a reinstall, a new TV). Called once the TV is signed in.
 */
export const cloudBackupService = {
  start(): void {
    if (started || !accountService.isSignedIn()) return;
    started = true;
    let empty = false;
    try { empty = !hasUserData(localStorage); } catch (e) {}
    let restoredBefore = false;
    try { restoredBefore = sessionStorage.getItem(RESTORED_FLAG) === '1'; } catch (e) {}
    if (empty && !restoredBefore) {
      accountService.getUserData().then(data => {
        const copy = readCopy(data);
        let written = 0;
        try { if (copy) written = applyCopy(localStorage, copy); } catch (e) {}
        if (written > 0) {
          // The services read their data when they load: start again with it
          try { sessionStorage.setItem(RESTORED_FLAG, '1'); } catch (e) {}
          window.location.reload();
          return;
        }
        this.watch();
      });
      return;
    }
    this.watch();
  },

  watch(): void {
    historyService.subscribe(() => schedule());
    favoritesService.subscribe(() => schedule());
    setInterval(() => schedule(1000), CHECK_EVERY_MS);
    schedule(FIRST_SAVE_MS);
  }
};
