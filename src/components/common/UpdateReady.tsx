import React, { useEffect, useRef, useState } from 'react';

// While the notice is open it takes every key: ◄ ► choose, OK acts, Back is "Más tarde". Registered when this module
// loads (before the screens add their own capture listeners), so it always runs first.
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
 * A downloaded update is ready (services/updateService.ts): restart now, or later. Restarting is reloading the page:
 * public/js/boot.js then starts the downloaded version. Never shown while a video plays (App decides).
 */
export const UpdateReady: React.FC<{ version: string; onRestart: () => void; onLater: () => void }> = ({ version, onRestart, onLater }) => {
  const [choice, setChoice] = useState<0 | 1>(0);
  const latest = useRef({ choice, onRestart, onLater });
  latest.current = { choice, onRestart, onLater };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const code = e.keyCode;
      if (code === 37) setChoice(0);
      else if (code === 39) setChoice(1);
      else if (code === 13) (latest.current.choice === 0 ? latest.current.onRestart : latest.current.onLater)();
      else if (code === 10009 || code === 27 || code === 461 || code === 8) latest.current.onLater();
    };
    handleKey = onKey;
    return () => {
      if (handleKey === onKey) handleKey = null;
    };
  }, []);

  return (
    <div className="upd-ready" role="dialog" aria-live="polite">
      <div className="upd-ready-text">
        <div className="upd-ready-title">Versión {version} lista</div>
        <div className="upd-ready-desc">Reinicia la app para estrenarla. Tu sesión, tu lista y tus ajustes se conservan.</div>
      </div>
      <div className="upd-ready-actions">
        <div className={`pf-btn ${choice === 0 ? 'is-focused' : ''}`} onClick={onRestart}>Reiniciar ahora</div>
        <div className={`pf-btn ${choice === 1 ? 'is-focused' : ''}`} onClick={onLater}>Más tarde</div>
      </div>
    </div>
  );
};
