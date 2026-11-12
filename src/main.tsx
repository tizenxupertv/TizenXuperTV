import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
// First, so its key listener runs before any screen's
import { DonateMomentNotice, UpdatedNotice, UpdateNotice } from './components/common/UpdateNotice';
import { markAsked, onDonateMoment, touch as touchDonateMoment } from './lib/donateMoment';
import { App } from './App';
import { LoginScreen } from './screens/LoginScreen';
import { ProfilePickerScreen } from './screens/ProfilePickerScreen';
import { localProfiles } from './lib/localProfiles';
import { accountService, type UpdateInfo } from './services/accountService';
import { updateService } from './services/updateService';
import './styles/index.css';
import './styles/textSize.css';
import { installTvDebug } from './debug/tvDebug';
import { logPlayback } from './lib/playbackLog';
import { getTvProfile } from './lib/tvProfile';

installTvDebug();

// One profile for the whole app (lib/tvProfile.ts): scripts and CSS read window.XuperEnv / the html classes
{
  const env = getTvProfile();
  (window as any).XuperEnv = env;
  document.documentElement.classList.add('tv-' + env.tier);
  // Tizen 6.0 and older: plain live preview box (html.legacy-video in index.css)
  if (env.legacyVideo) document.documentElement.classList.add('legacy-video');
}

// Each launch opens a new stretch of the playback log: a launch right after a video means the app closed or crashed
{
  const st = updateService.status();
  const installed = st.packaged && st.running && st.packaged !== st.running ? ` (instalada ${st.packaged})` : '';
  logPlayback({ kind: 'info', player: 'App', detail: `inicio ${__APP_VERSION__}${installed}` });
}

/** The saved session is confirmed once the first screen has loaded */
const VERIFY_DELAY_MS = 8000;

/** Sign-in with Telegram is required: the app only mounts with a session */
const Root: React.FC = () => {
  const [signedIn, setSignedIn] = useState(() => accountService.isSignedIn());
  // "¿Quién está viendo?" before the app, when the TV has two or more local profiles
  const [picking, setPicking] = useState(() => localProfiles.needsPicker());
  // A newer version announced by the server, shown once per version
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  // The version this launch runs, when the app updated itself to it (shown once)
  const [updatedTo, setUpdatedTo] = useState<string | null>(() =>
    // ?test=updated previews the notice in the browser (dev only)
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('test') === 'updated'
      ? '1.10.3'
      : updateService.updatedNotice());
  const [, setTick] = useState(0);
  const [donateMoment, setDonateMoment] = useState<boolean>(() =>
    // ?test=donate previews the request in the browser (dev only)
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('test') === 'donate');

  // The donation request: asked for after a title ended and the player closed (lib/donateMoment)
  useEffect(() => {
    touchDonateMoment();
    return onDonateMoment(() => {
      markAsked();
      setDonateMoment(true);
    });
  }, []);

  // Self-update checks run in the background, signed in or not (public/js/boot.js, services/updateService.ts)
  useEffect(() => {
    updateService.start();
    return updateService.subscribe(() => setTick(t => t + 1));
  }, []);

  // A session revoked on the server (TV unlinked) restarts the app at the sign-in screen;
  // without a connection the saved session keeps working
  useEffect(() => {
    if (!signedIn) return;
    const t = setTimeout(() => {
      accountService.verify().then(result => {
        if (result === 'revoked') {
          window.location.reload();
          return;
        }
        if (result === 'ok') setUpdate(accountService.pendingUpdate());
      });
    }, VERIFY_DELAY_MS);
    return () => clearTimeout(t);
    // Only the session found at startup; a new sign-in was just confirmed by the server
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeUpdate = useCallback(() => {
    if (update) accountService.markUpdateSeen(update.version);
    setUpdate(null);
  }, [update]);
  const closeUpdated = useCallback(() => {
    if (updatedTo) updateService.markUpdatedSeen(updatedTo);
    setUpdatedTo(null);
  }, [updatedTo]);

  // The Apps2Samsung notice only where the app cannot update itself (older engine, or a release that needs a new package)
  const status = updateService.status();
  const manualUpdate = update && (!status.canSelfUpdate || status.needsReinstall) ? update : null;

  // Local testing support for WelcomeModal via ?test=welcome or ?test=welcome2
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const testParam = urlParams?.get('test');
  const isTestingWelcome = testParam === 'welcome' || testParam === 'welcome1' || testParam === 'welcome2' ||
    (import.meta.env.DEV && (testParam === 'updated' || testParam === 'donate'));

  if (!signedIn && !isTestingWelcome) {
    return (
      <LoginScreen
        onSignedIn={() => {
          localProfiles.unmarkChosen();
          setSignedIn(true);
          setPicking(true);
        }}
      />
    );
  }
  if (picking) return <ProfilePickerScreen onDone={() => setPicking(false)} />;
  return (
    <>
      <App />
      {updatedTo
        ? <UpdatedNotice version={updatedTo} onClose={closeUpdated} />
        : manualUpdate
          ? <UpdateNotice info={manualUpdate} current={accountService.deviceInfo().version} cleanInstall={status.needsReinstall} onClose={closeUpdate} />
          : donateMoment && <DonateMomentNotice onClose={() => setDonateMoment(false)} />}
    </>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<Root />);
}
