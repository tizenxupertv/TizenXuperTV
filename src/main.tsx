import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
// First, so its key listener runs before any screen's
import { UpdateNotice } from './components/common/UpdateNotice';
import { App } from './App';
import { LoginScreen } from './screens/LoginScreen';
import { accountService, type UpdateInfo } from './services/accountService';
import './styles/index.css';
import { installTvDebug } from './debug/tvDebug';

installTvDebug();

/** The saved session is confirmed once the first screen has loaded */
const VERIFY_DELAY_MS = 8000;

/** Sign-in with Telegram is required: the app only mounts with a session */
const Root: React.FC = () => {
  const [signedIn, setSignedIn] = useState(() => accountService.isSignedIn());
  // A newer version announced by the server, shown once per version
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  // A session revoked on the server (TV unlinked) restarts the app at the sign-in screen;
  // without a connection the saved session keeps working
  useEffect(() => {
    if (!signedIn) return;
    const t = setTimeout(() => {
      accountService.verify().then(result => {
        if (result === 'revoked') window.location.reload();
        else if (result === 'ok') setUpdate(accountService.pendingUpdate());
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

  if (!signedIn) return <LoginScreen onSignedIn={() => setSignedIn(true)} />;
  return (
    <>
      <App />
      {update && <UpdateNotice info={update} current={accountService.deviceInfo().version} onClose={closeUpdate} />}
    </>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<Root />);
}
