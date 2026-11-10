import React, { useState, useEffect } from 'react';

const STORAGE_KEY = 'xuper_welcome_shown_v2';

/**
 * First start: how to move around with the remote. It no longer asks for a donation: that request comes later, once
 * the viewer has used the app (lib/donateMoment)
 */
export const WelcomeModal: React.FC = () => {
  const urlParam = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('test')
    : null;
  // ?test=welcome previews it in the browser
  const isTest = urlParam === 'welcome' || urlParam === 'welcome1' || urlParam === 'welcome2';

  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (isTest) return true;
    try {
      return !localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return false;
    }
  });

  const close = () => {
    if (!isTest) {
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch (_) {}
    }
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Enter (13), Space (32), Back (461, 10009, 27, 8): all of them close it
      if ([13, 32, 461, 10009, 27, 8].indexOf(e.keyCode) >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="welcome-modal-overlay">
      <div className="welcome-modal-card">
        {/* Remote control navigation guide */}
        <div className="welcome-modal-header">
          <div className="welcome-modal-logo-wrap">
            <img src="assets/logo_3d.png" alt="TizenXuper TV" className="welcome-modal-logo" />
          </div>
          <div className="welcome-modal-badge">Guía de Control Remoto</div>
          <h1 className="welcome-modal-title">Bienvenido a TizenXuper TV</h1>
          <p className="welcome-modal-subtitle">
            Una interfaz hecha para el control remoto de tu televisor Samsung: rápida, ordenada y fácil de usar.
          </p>
        </div>

        {/* 3 Remote Navigation Feature Cards */}
        <div className="welcome-modal-cards-grid">
          <div className="welcome-nav-card">
            <div className="welcome-key-chip">◀ ▲ ▼ ▶</div>
            <div className="welcome-card-title">Navegación</div>
            <p className="welcome-card-desc">
              Explora categorías, sintoniza canales y navega entre filas con las flechas del control.
            </p>
          </div>

          <div className="welcome-nav-card welcome-nav-highlight">
            <div className="welcome-key-chip welcome-key-ok">OK</div>
            <div className="welcome-card-title">Seleccionar y Ver</div>
            <p className="welcome-card-desc">
              Pulsa OK para reproducir a pantalla completa, abrir la ficha de un título o buscar.
            </p>
          </div>

          <div className="welcome-nav-card">
            <div className="welcome-key-chip">Atrás</div>
            <div className="welcome-card-title">Volver</div>
            <p className="welcome-card-desc">
              Regresa en cualquier momento a la pantalla o sección anterior sin perder tu lugar.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="welcome-modal-footer">
          <p className="welcome-modal-privacy">
            🔒 Tus favoritos, canales bloqueados y preferencias se guardan de forma privada en este televisor.
          </p>

          <button className="welcome-modal-btn is-focused" onClick={close} autoFocus>
            Comenzar
          </button>
        </div>
      </div>
    </div>
  );
};
