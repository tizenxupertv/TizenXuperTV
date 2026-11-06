import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { LoginScreen } from './screens/LoginScreen';
import { accountService } from './services/accountService';
import './styles/index.css';
import { installTvDebug } from './debug/tvDebug';

installTvDebug();

/** The saved session is confirmed once the first screen has loaded */
const VERIFY_DELAY_MS = 8000;

/** Sign-in with Telegram is required: the app only mounts with a session */
const Root: React.FC = () => {
  const [signedIn, setSignedIn] = useState(() => accountService.isSignedIn());

  // A session revoked on the server (TV unlinked) restarts the app at the sign-in screen;
  // without a connection the saved session keeps working
  useEffect(() => {
    if (!signedIn) return;
    const t = setTimeout(() => {
      accountService.verify().then(result => {
        if (result === 'revoked') window.location.reload();
      });
    }, VERIFY_DELAY_MS);
    return () => clearTimeout(t);
    // Only the session found at startup; a new sign-in was just confirmed by the server
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return signedIn ? <App /> : <LoginScreen onSignedIn={() => setSignedIn(true)} />;
};

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<Root />);
}
