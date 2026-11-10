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

/** First launch after the app updated itself: once per version. Same look as the restart dialog (UpdateReady) */
export const UpdatedNotice: React.FC<{ version: string; onClose: () => void }> = ({ version, onClose }) => {
  useNoticeKeys(onClose);
  return (
    <div className="upd-ready" role="dialog" aria-modal="true" aria-labelledby="upd-done-title">
      <div className="upd-ready-card is-wide">
        <div className="upd-done-badge">Actualizada</div>
        <div className="upd-ready-title" id="upd-done-title">Ya tienes la versión {version}</div>
        <div className="upd-ready-desc">Tu sesión, tu lista y tus ajustes siguen igual.</div>
        <div className="upd-done-cards">
          <div className="upd-done-news">
            <div className="upd-done-qr"><QrCode text={NEWS_URL} size={132} /></div>
            <div className="upd-done-news-text">
              <div className="upd-done-news-title">Novedades</div>
              <div>Mira qué hay de nuevo en esta versión.</div>
            </div>
          </div>
          <div className="upd-done-news">
            <div className="upd-done-qr">
              <img className="upd-done-qr-img" src="assets/paypal-donation-qr.png" alt="Código QR de donación PayPal" />
            </div>
            <div className="upd-done-news-text">
              <div className="upd-done-news-title">Apoya el proyecto</div>
              <div>Una donación por PayPal nos ayuda a seguir mejorando.</div>
            </div>
          </div>
        </div>
        <div className="upd-done-hint">Escanea los códigos con la cámara del móvil.</div>
        <div className="pf-btn is-focused upd-ready-btn" onClick={onClose}>Continuar</div>
      </div>
    </div>
  );
};

/**
 * The donation request, shown after a title ended and the player closed (lib/donateMoment decides when). OK or Back
 * closes it: there is nothing to choose on the TV, the donation happens on the phone
 */
export const DonateMomentNotice: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useNoticeKeys(onClose);
  return (
    <div className="upd-ready" role="dialog" aria-modal="true" aria-labelledby="donate-moment-title">
      <div className="upd-ready-card">
        <div className="upd-ready-title" id="donate-moment-title">¿Te gusta TizenXuper TV?</div>
        <div className="upd-ready-desc">
          Es un proyecto independiente y gratuito. Si te resulta útil, una donación voluntaria ayuda a mantenerlo y a seguir mejorándolo.
        </div>
        <div className="upd-done-news">
          <div className="upd-done-qr">
            <img className="upd-done-qr-img" src="assets/paypal-donation-qr.png" alt="Código QR de donación PayPal" />
          </div>
          <div className="upd-done-news-text">
            <div className="upd-done-news-title">Apoya el proyecto</div>
            <div>Escanea el código con la cámara del móvil para donar por PayPal.</div>
          </div>
        </div>
        <div className="upd-done-hint">Puedes hacerlo cuando quieras en Ajustes › Apoyo y Donaciones.</div>
        <div className="pf-btn is-focused upd-ready-btn" onClick={onClose}>Ahora no</div>
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
            <div className="upd-notice-step"><span className="tg-login-num">1</span><span>Descarga <b>TizenXuperTV.wgt</b> del bot de Telegram (<b>Última versión</b>)</span></div>
            <div className="upd-notice-step"><span className="tg-login-num">2</span><span>Instálalo con Apps2Samsung encima de la que tienes</span></div>
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
