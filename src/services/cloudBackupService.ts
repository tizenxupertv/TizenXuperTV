import { applyCopy, buildCopy, copyFingerprint, hasUserData, readCopy, shouldSave } from '../lib/cloudBackup';
import { accountService } from './accountService';
import { updateService } from './updateService';

/** Whether to save is decided this often, on the TV only (no request unless lib/cloudBackup shouldSave says so) */
const CHECK_EVERY_MS = 15 * 60_000;
/** The first check waits for the app to settle after start */
const FIRST_CHECK_MS = 60_000;
/** Set for the reload that follows a restore, so a restore that wrote nothing new cannot loop */
const RESTORED_FLAG = 'xuper_cloud_restored';
/** When the last copy was saved and its fingerprint, kept on the TV */
const SAVED_KEY = 'xuper_cloud_saved_v1';

let started = false;
let saving = false;

function savedInfo(): { at: number; fp: string } {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) || 'null');
    if (v && typeof v.at === 'number' && typeof v.fp === 'string') return v;
  } catch (e) {}
  return { at: 0, fp: '' };
}

function newVersionReady(): boolean {
  const st = updateService.status();
  return !!st.downloaded || !!st.needsReinstall;
}

/** Sends the copy when lib/cloudBackup shouldSave allows it: changed, and once a day or before a new version */
function check(): void {
  if (saving || !accountService.isSignedIn()) return;
  let text = '';
  let copy;
  try {
    // A TV with nothing yet never replaces the account's copy with an empty one
    if (!hasUserData(localStorage)) return;
    copy = buildCopy(localStorage);
    text = JSON.stringify(copy);
  } catch (e) {
    return;
  }
  const fp = copyFingerprint(text);
  const last = savedInfo();
  if (!shouldSave({ changed: fp !== last.fp, savedAt: last.at, now: Date.now(), newVersion: newVersionReady() })) return;
  saving = true;
  accountService.saveUserData(copy).then(ok => {
    saving = false;
    if (ok) {
      try { localStorage.setItem(SAVED_KEY, JSON.stringify({ at: Date.now(), fp })); } catch (e) {}
    }
  });
}

/**
 * Keeps the user's lists, history, profiles and live favourites in their Telegram account (bot /tv/data), and
 * puts them back on a TV that has none after signing in (a reinstall, a new TV). Light on the server: a copy is
 * sent only when it changed, once a day at most, and at once when a new version is ready (before the restart
 * or the reinstall it needs). Called once the TV is signed in.
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
    // A new version found by the update check: save right away if the copy changed
    updateService.subscribe(() => { if (newVersionReady()) check(); });
    setInterval(check, CHECK_EVERY_MS);
    setTimeout(check, FIRST_CHECK_MS);
  }
};
