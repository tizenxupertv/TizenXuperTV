import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
// First, so its key listener runs before any screen's
import { UpdatedNotice, UpdateNotice } from './components/common/UpdateNotice';
import { App } from './App';
import { LoginScreen } from './screens/LoginScreen';
import { accountService, type UpdateInfo } from './services/accountService';
import { updateService } from './services/updateService';
import './styles/index.css';
import './styles/textSize.css';
import { installTvDebug } from './debug/tvDebug';

installTvDebug();

/** The saved session is confirmed once the first screen has loaded */
const VERIFY_DELAY_MS = 8000;

/** Sign-in with Telegram is required: the app only mounts with a session */
const Root: React.FC = () => {
  const [signedIn, setSignedIn] = useState(() => accountService.isSignedIn());
  // A newer version announced by the server, shown once per version
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  // The version this launch runs, when the app updated itself to it (shown once)
  const [updatedTo, setUpdatedTo] = useState<string | null>(() =>
    // ?test=updated previews the notice in the browser (dev only)
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('test') === 'updated'
      ? '1.10.3'
      : updateService.updatedNotice());
  const [, setTick] = useState(0);

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
    (import.meta.env.DEV && testParam === 'updated');

  if (!signedIn && !isTestingWelcome) return <LoginScreen onSignedIn={() => setSignedIn(true)} />;
  return (
    <>
      <App />
      {updatedTo
        ? <UpdatedNotice version={updatedTo} onClose={closeUpdated} />
        : manualUpdate && <UpdateNotice info={manualUpdate} current={accountService.deviceInfo().version} onClose={closeUpdate} />}
    </>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<Root />);
}
