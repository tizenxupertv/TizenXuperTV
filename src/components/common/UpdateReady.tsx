import React, { useEffect, useRef } from 'react';

// While the notice is open it takes every key: only OK does something (restart). Registered when this module loads
// (before the screens add their own capture listeners), so it always runs first and nothing behind it reacts.
let handleKey: ((e: KeyboardEvent) => void) | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    e => {
      if (!handleKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      handleKey(e);
    },
    { capture: true }
  );
}

/**
 * A downloaded update is ready (services/updateService.ts): the app has to restart to go on. Restarting is reloading
 * the page: public/js/boot.js then starts the downloaded version. Never shown while a video plays (App decides).
 */
export const UpdateReady: React.FC<{ version: string; onRestart: () => void }> = ({ version, onRestart }) => {
  const restart = useRef(onRestart);
  restart.current = onRestart;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.repeat && e.keyCode === 13) restart.current();
    };
    handleKey = onKey;
    return () => {
      if (handleKey === onKey) handleKey = null;
    };
  }, []);

  return (
    <div className="upd-ready" role="alertdialog" aria-modal="true" aria-labelledby="upd-ready-title">
      <div className="upd-ready-card">
        <img className="upd-ready-logo" src="assets/logo_3d.png" alt="" />
        <div className="upd-ready-title" id="upd-ready-title">Nueva versión {version}</div>
        <div className="upd-ready-desc">
          La actualización ya está descargada. Reinicia la app para continuar; tu sesión, tu lista y tus ajustes se conservan.
        </div>
        <div className="pf-btn is-focused upd-ready-btn" onClick={onRestart}>Reiniciar ahora</div>
      </div>
    </div>
  );
};
