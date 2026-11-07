import React, { useState, useEffect } from 'react';

const STORAGE_KEY = 'xuper_welcome_shown_v2';

export interface WelcomeModalProps {
  forceStep?: 1 | 2;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ forceStep }) => {
  const urlParam = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('test')
    : null;

  const isTest = Boolean(forceStep || urlParam === 'welcome' || urlParam === 'welcome1' || urlParam === 'welcome2');
  const initialStep: 1 | 2 = forceStep || (urlParam === 'welcome2' ? 2 : 1);

  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (isTest) return true;
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      return !seen;
    } catch (_) {
      return false;
    }
  });
  const [step, setStep] = useState<1 | 2>(initialStep);

  useEffect(() => {
    if (isTest) {
      setIsOpen(true);
      setStep(initialStep);
      return;
    }
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        setIsOpen(true);
      }
    } catch (_) {}
  }, [isTest, initialStep]);

  const close = () => {
    if (!isTest) {
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch (_) {}
    }
    setIsOpen(false);
  };

  const handleNext = () => {
    if (step === 1) {
      setStep(2);
    } else {
      close();
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Enter (13), Space (32)
      if (e.keyCode === 13 || e.keyCode === 32) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleNext();
        return;
      }
      // Back (461, 10009, 27, 8)
      if (e.keyCode === 461 || e.keyCode === 10009 || e.keyCode === 27 || e.keyCode === 8) {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, step]);

  if (!isOpen) return null;

  return (
    <div className="welcome-modal-overlay">
      <div className="welcome-modal-card">
        {step === 1 ? (
          <>
            {/* Step 1: Remote Control Navigation Guide */}
            <div className="welcome-modal-header">
              <div className="welcome-modal-logo-wrap">
                <img src="assets/logo_3d.png" alt="TizenXuper TV" className="welcome-modal-logo" />
              </div>
              <div className="welcome-modal-badge">Paso 1 de 2 · Guía de Control Remoto</div>
              <h1 className="welcome-modal-title">Bienvenido a TizenXuper TV</h1>
              <p className="welcome-modal-subtitle">
                Canales de televisión en vivo, miles de películas, series completas y anime, optimizado para el control remoto de tu televisor Samsung.
              </p>
            </div>

            {/* 3 Remote Navigation Feature Cards */}
            <div className="welcome-modal-cards-grid">
              <div className="welcome-nav-card">
                <div className="welcome-key-chip">◄ ▲ ▼ ►</div>
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

            {/* Step 1 Footer */}
            <div className="welcome-modal-footer">
              <p className="welcome-modal-privacy">
                🔒 Tus favoritos, canales bloqueados y preferencias se guardan de forma privada en este televisor.
              </p>

              <button className="welcome-modal-btn is-focused" onClick={handleNext} autoFocus>
                Continuar al paso 2
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Step 2: Project Support & Donation QR */}
            <div className="welcome-modal-header">
              <div className="welcome-modal-badge">Paso 2 de 2 · Apoyo al Proyecto</div>
              <h1 className="welcome-modal-title">Apoya el Desarrollo de TizenXuper TV</h1>
              <p className="welcome-modal-subtitle">
                TizenXuper TV es un desarrollo comunitario independiente. Tu aporte voluntario nos permite costear servidores, listas actualizadas y seguir agregando mejoras continuas.
              </p>
            </div>

            {/* Donation Content with Clean Square QR & Timeline Stepper */}
            <div className="welcome-donate-content">
              <div className="welcome-donate-qr-card">
                <div className="welcome-donate-qr-frame">
                  <img
                    src="assets/paypal-donation-qr.png"
                    alt="Código QR de Donación PayPal"
                    className="welcome-donate-qr-img"
                  />
                </div>
                <div className="welcome-donate-badge">PayPal Oficial</div>
              </div>

              <div className="welcome-donate-info">
                {/* Timeline Stepper matching Login Screen */}
                <div className="welcome-timeline">
                  <div className="welcome-timeline-item">
                    <div className="welcome-timeline-marker">
                      <div className="welcome-timeline-dot">1</div>
                      <div className="welcome-timeline-line"></div>
                    </div>
                    <div className="welcome-timeline-content">
                      <div className="welcome-timeline-title">Escanea el código QR</div>
                      <div className="welcome-timeline-sub">Abre la app de cámara o lector QR en tu teléfono móvil.</div>
                    </div>
                  </div>

                  <div className="welcome-timeline-item">
                    <div className="welcome-timeline-marker">
                      <div className="welcome-timeline-dot">2</div>
                      <div className="welcome-timeline-line"></div>
                    </div>
                    <div className="welcome-timeline-content">
                      <div className="welcome-timeline-title">Ingresa a PayPal</div>
                      <div className="welcome-timeline-sub">Apunta directamente al código QR para abrir el enlace seguro.</div>
                    </div>
                  </div>

                  <div className="welcome-timeline-item is-last">
                    <div className="welcome-timeline-marker">
                      <div className="welcome-timeline-dot">3</div>
                    </div>
                    <div className="welcome-timeline-content">
                      <div className="welcome-timeline-title">Apoya el proyecto</div>
                      <div className="welcome-timeline-sub">Contribuye con el aporte voluntario que desees para sostener el servicio.</div>
                    </div>
                  </div>
                </div>

                <div className="welcome-donate-note">
                  <span className="welcome-donate-note-icon">💡</span>
                  <div className="welcome-donate-note-text">
                    <b>Nota:</b> Siempre podrás volver a ver este código QR o realizar donaciones desde <b>Ajustes &gt; Apoyo y Donaciones</b>.
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2 Footer */}
            <div className="welcome-modal-footer">
              <button className="welcome-modal-btn is-focused" onClick={close} autoFocus>
                Comenzar a disfrutar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
