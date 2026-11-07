import React, { useEffect } from 'react';
import type { UpdateInfo } from '../../services/accountService';
import { QrCode } from './QrCode';

// While the notice is open it takes every key: OK or Back closes it, nothing reaches the screen behind.
// The listener is registered when this module loads, before any screen adds its own capture listener,
// so it always runs first.
let closeOpenNotice: (() => void) | null = null;
const CLOSE_KEYS = [13, 10009, 27, 461, 8];
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    e => {
      if (!closeOpenNotice) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (CLOSE_KEYS.indexOf(e.keyCode) >= 0 && !e.repeat) closeOpenNotice();
    },
    { capture: true }
  );
}

/** The open notice takes every key while it is shown */
function useNoticeKeys(onClose: () => void): void {
  useEffect(() => {
    closeOpenNotice = onClose;
    return () => {
      if (closeOpenNotice === onClose) closeOpenNotice = null;
    };
  }, [onClose]);
}

/** Novedades page on Telegraph (created by the bot repo's `npm run guide`) */
const NEWS_URL = 'https://telegra.ph/Novedades-de-TizenXuper-TV-11-07';

/** First launch after the app updated itself: once per version */
export const UpdatedNotice: React.FC<{ version: string; onClose: () => void }> = ({ version, onClose }) => {
  useNoticeKeys(onClose);
  return (
    <div className="upd-notice" role="dialog" aria-modal="true">
      <div className="upd-notice-card">
        <div className="upd-notice-qr">
          <QrCode text={NEWS_URL} size={200} />
          <div className="upd-notice-qr-caption">Novedades</div>
        </div>
        <div className="upd-notice-info">
          <div className="upd-notice-badge">✅ Actualizada</div>
          <h1 className="upd-notice-title">TizenXuper TV se actualizó a la {version}</h1>
          <p className="upd-notice-lead">
            La app se actualizó sola, sin Apps2Samsung. Tus favoritos, tu perfil y tu sesión siguen igual.
            Escanea el código para ver qué hay de nuevo.
          </p>
          <div className="upd-notice-ok">
            <span className="upd-notice-key">OK</span><span>Continuar</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/** "New version" notice, shown once per version after the session check: how to update, and a QR to the guide */
export const UpdateNotice: React.FC<{ info: UpdateInfo; current: string; onClose: () => void }> = ({ info, current, onClose }) => {
  useNoticeKeys(onClose);

  return (
    <div className="upd-notice" role="dialog" aria-modal="true">
      <div className="upd-notice-card">
        <div className="upd-notice-qr">
          <QrCode text={info.guide} size={200} />
          <div className="upd-notice-qr-caption">Guía con capturas</div>
        </div>
        <div className="upd-notice-info">
          <div className="upd-notice-badge">🆕 Versión nueva</div>
          <h1 className="upd-notice-title">Ya salió TizenXuper TV {info.version}</h1>
          <p className="upd-notice-lead">
            Tienes la {current}. Actualízala para tener las últimas mejoras y correcciones.
          </p>
          <div className="upd-notice-steps">
            <div className="upd-notice-step"><span className="tg-login-num">1</span><span>En Apps2Samsung, abre la pestaña <b>On the TV</b></span></div>
            <div className="upd-notice-step"><span className="tg-login-num">2</span><span>Pulsa <b>Update</b> en TizenXuper TV</span></div>
            <div className="upd-notice-step"><span className="tg-login-num">3</span><span>Tu lista, tus canales favoritos y tu sesión se conservan</span></div>
          </div>
          <div className="upd-notice-ok">
            <span className="upd-notice-key">OK</span><span>Continuar</span>
          </div>
        </div>
      </div>
    </div>
  );
};
