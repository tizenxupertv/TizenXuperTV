import React, { useEffect, useState } from 'react';
import { accountService, formatCode, LoginCode } from '../services/accountService';
import { runLoginDiagnostic, LoginDiagResult } from '../services/diagnosticService';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { BrandLogo } from '../components/common/BrandLogo';
import { QrCode } from '../components/common/QrCode';

type Phase =
  | { name: 'loading'; retryCount?: number }
  | { name: 'waiting'; login: LoginCode }
  | { name: 'expired' }
  | { name: 'error' }
  | { name: 'done'; userName: string };

/** How long the greeting stays before the app opens */
const DONE_DELAY_MS = 1500;
/** Up to 3 attempts total (initial + 2 automatic retries) */
const MAX_AUTO_RETRIES = 2;
const TOTAL_CODE_TTL_S = 300; // 5 minutes

function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const r = s % 60;
  return `${Math.floor(s / 60)}:${r < 10 ? '0' : ''}${r}`;
}

/** Bot username from the t.me deep link, for the "send the code" alternative */
function botName(url: string): string {
  const m = url.match(/t\.me\/([A-Za-z0-9_]+)/);
  return m ? m[1] : '';
}

export const LoginScreen: React.FC<{ onSignedIn: () => void }> = ({ onSignedIn }) => {
  // Support ?test=error | loading | expired | help | diag in local browser for easy visual testing
  const testParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('test') : null;

  const [phase, setPhase] = useState<Phase>(() => {
    if (testParam === 'error' || testParam === 'help' || testParam === 'diag') return { name: 'error' };
    if (testParam === 'expired') return { name: 'expired' };
    if (testParam === 'done') return { name: 'done', userName: 'Ana' };
    return { name: 'loading', retryCount: 0 };
  });
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [activeAction, setActiveAction] = useState<'retry' | 'diag' | 'help'>(() => {
    if (testParam === 'diag') return 'diag';
    if (testParam === 'help') return 'help';
    return 'retry';
  });
  const [showHelpModal, setShowHelpModal] = useState(() => testParam === 'help');
  const [showDiagModal, setShowDiagModal] = useState(() => testParam === 'diag');
  const [diagResult, setDiagResult] = useState<LoginDiagResult | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagAction, setDiagAction] = useState<'retry' | 'help' | 'close'>('retry');

  // The sign-in screen is a first screen too: a downloaded update that got this far is good (public/js/boot.js)
  useEffect(() => {
    if (window.XuperBoot) window.XuperBoot.ok();
  }, []);

  // Ask for a code with automatic retry backoff, then poll until linked
  useEffect(() => {
    // If testing forced state locally, skip API calls
    if (testParam === 'error' || testParam === 'help' || testParam === 'diag' || testParam === 'expired' || testParam === 'loading' || testParam === 'done') {
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let autoRetryTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadWithRetry(autoAttempt = 0) {
      if (cancelled) return;
      setPhase({ name: 'loading', retryCount: autoAttempt });

      try {
        const login = await accountService.startLogin();
        if (cancelled) return;
        setPhase({ name: 'waiting', login });

        const check = () => {
          accountService.poll(login).then(result => {
            if (cancelled) return;
            if (result.status === 'linked') {
              setPhase({ name: 'done', userName: result.session.name });
              setTimeout(onSignedIn, DONE_DELAY_MS);
            } else if (result.status === 'expired') {
              setPhase({ name: 'expired' });
              setActiveAction('retry');
            } else {
              pollTimer = setTimeout(check, login.interval * 1000);
            }
          }, () => {
            if (cancelled) return;
            if (Date.now() >= login.expiresAt) {
              setPhase({ name: 'expired' });
              setActiveAction('retry');
            } else {
              pollTimer = setTimeout(check, login.interval * 1000);
            }
          });
        };
        pollTimer = setTimeout(check, login.interval * 1000);
      } catch (err: any) {
        if (cancelled) return;
        if (autoAttempt < MAX_AUTO_RETRIES) {
          const delay = (autoAttempt + 1) * 2000;
          console.log(`[login] startLogin failed (${err?.message || 'err'}), auto-retrying in ${delay}ms...`);
          autoRetryTimer = setTimeout(() => loadWithRetry(autoAttempt + 1), delay);
        } else {
          console.warn('[login] All auto-retries failed. Presenting error state.');
          setPhase({ name: 'error' });
          setActiveAction('retry');
        }
      }
    }

    loadWithRetry(0);

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (autoRetryTimer) clearTimeout(autoRetryTimer);
    };
  }, [attempt, onSignedIn, testParam]);

  // Countdown of the code
  useEffect(() => {
    if (phase.name !== 'waiting') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase.name]);

  const handleOpenDiag = () => {
    setShowDiagModal(true);
    setDiagAction('retry');
    setDiagRunning(true);
    runLoginDiagnostic().then(
      res => {
        setDiagResult(res);
        setDiagRunning(false);
      },
      () => {
        setDiagResult({
          verdict: 'all-blocked',
          headline: 'Error al ejecutar el diagnóstico',
          recommendation: 'No se pudo completar el análisis de red. Revisa la conexión de la TV.',
          checks: [],
          timestamp: Date.now()
        });
        setDiagRunning(false);
      }
    );
  };

  useEffect(() => {
    if (testParam === 'diag') {
      handleOpenDiag();
    }
  }, [testParam]);

  const retry = () => {
    setActiveAction('retry');
    setShowHelpModal(false);
    setShowDiagModal(false);
    setAttempt(a => a + 1);
  };

  const canRetry = phase.name === 'expired' || phase.name === 'error';

  useScreenKeys(key => {
    if (showDiagModal) {
      if (key === 'left') {
        if (diagAction === 'close') setDiagAction('help');
        else if (diagAction === 'help') setDiagAction('retry');
      } else if (key === 'right') {
        if (diagAction === 'retry') setDiagAction('help');
        else if (diagAction === 'help') setDiagAction('close');
      } else if (key === 'enter') {
        if (diagAction === 'retry') {
          retry();
        } else if (diagAction === 'help') {
          setShowDiagModal(false);
          setShowHelpModal(true);
        } else {
          setShowDiagModal(false);
          setActiveAction('diag');
        }
      } else if (key === 'back') {
        setShowDiagModal(false);
        setActiveAction('diag');
      }
      return;
    }

    if (showHelpModal) {
      if (key === 'enter' || key === 'back') {
        setShowHelpModal(false);
        setActiveAction('retry');
      }
      return;
    }

    if (canRetry) {
      if (key === 'left') {
        if (phase.name === 'error') {
          if (activeAction === 'help') setActiveAction('diag');
          else if (activeAction === 'diag') setActiveAction('retry');
        } else {
          setActiveAction('retry');
        }
      } else if (key === 'right' && phase.name === 'error') {
        if (activeAction === 'retry') setActiveAction('diag');
        else if (activeAction === 'diag') setActiveAction('help');
      } else if (key === 'enter') {
        if (activeAction === 'help') setShowHelpModal(true);
        else if (activeAction === 'diag') handleOpenDiag();
        else retry();
      } else if (key === 'back' && window.XuperPlatform && window.XuperPlatform.exit) {
        window.XuperPlatform.exit();
      }
    } else if (key === 'back' && window.XuperPlatform && window.XuperPlatform.exit) {
      window.XuperPlatform.exit();
    }
  });

  const login = phase.name === 'waiting' ? phase.login : null;
  const bot = login ? botName(login.url) : '';

  // Progress percentage for countdown border
  const remainingMs = login ? Math.max(0, login.expiresAt - now) : 0;
  const progressPct = login ? Math.max(0, Math.min(100, (remainingMs / (TOTAL_CODE_TTL_S * 1000)) * 100)) : 0;

  return (
    <div className="tg-login">
      <div className="tg-login-brand">
        <BrandLogo />
        <span className="tg-login-version">Versión {__APP_VERSION__}</span>
      </div>
      <div className="tg-login-body">
        {/* Left Column: QR Card, Placeholder Skeleton, or Error/Expired Card */}
        <div className="tg-login-left-col">
          {phase.name === 'loading' ? (
            <>
              <div className="tg-login-placeholder-card is-loading">
                <div className="tg-login-placeholder-qr">
                  <svg viewBox="0 0 64 64" width="76" height="76" fill="none" stroke="currentColor" strokeWidth="2.5" className="tg-login-skeleton-icon">
                    <rect x="6" y="6" width="22" height="22" rx="4" />
                    <rect x="12" y="12" width="10" height="10" fill="currentColor" />
                    <rect x="36" y="6" width="22" height="22" rx="4" />
                    <rect x="42" y="12" width="10" height="10" fill="currentColor" />
                    <rect x="6" y="36" width="22" height="22" rx="4" />
                    <rect x="12" y="42" width="10" height="10" fill="currentColor" />
                    <rect x="38" y="38" width="6" height="6" fill="currentColor" />
                    <rect x="48" y="38" width="8" height="6" fill="currentColor" />
                    <rect x="38" y="48" width="10" height="8" fill="currentColor" />
                    <rect x="52" y="48" width="6" height="8" fill="currentColor" />
                  </svg>
                  <div className="tg-login-skeleton-shimmer"></div>
                </div>
                <div className="tg-login-skeleton-code">
                  <div className="tg-login-skeleton-shimmer"></div>
                </div>
              </div>
              <div className="tg-login-timer is-loading">
                <span className="tg-login-spinner"></span>
                <span>{phase.retryCount && phase.retryCount > 0 ? `Reintentando (${phase.retryCount + 1}/3)…` : 'Generando código seguro…'}</span>
              </div>
            </>
          ) : login ? (
            <>
              <div
                className="tg-login-progress-border"
                style={{
                  background: `conic-gradient(from -90deg, #38bdf8 0%, #a855f7 ${progressPct}%, rgba(255, 255, 255, 0.1) ${progressPct}% 100%)`
                }}
              >
                <div className="tg-login-card">
                  <QrCode text={login.url} size={250} />
                  <div className="tg-login-code">{formatCode(login.code)}</div>
                </div>
              </div>
              <div className="tg-login-timer">
                <span className="tg-login-timer-icon">⏱</span>
                <span>El código vence en <b>{countdown(remainingMs)}</b></span>
              </div>
            </>
          ) : phase.name === 'done' ? (
            <>
              <div className="tg-login-placeholder-card is-done">
                <div className="tg-login-placeholder-qr is-done">
                  <svg viewBox="0 0 64 64" width="88" height="88" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="32" cy="32" r="26" />
                    <path d="M20 33l8 8 16-17" />
                  </svg>
                </div>
                <div className="tg-login-placeholder-label is-done">TV vinculada</div>
              </div>
              <div className="tg-login-timer is-done">
                <span className="tg-login-spinner"></span>
                <span>Abriendo TizenXuper TV…</span>
              </div>
            </>
          ) : (
            <>
              <div className={`tg-login-placeholder-card ${phase.name === 'expired' ? 'is-expired' : 'is-error'}`}>
                <div className={`tg-login-placeholder-qr ${phase.name === 'expired' ? 'is-expired' : 'is-error'}`}>
                  {phase.name === 'expired' ? (
                    <svg viewBox="0 0 64 64" width="76" height="76" fill="none" stroke="currentColor" strokeWidth="2.5" className="tg-login-expired-icon">
                      <rect x="6" y="6" width="22" height="22" rx="4" />
                      <rect x="12" y="12" width="10" height="10" fill="currentColor" opacity="0.3" />
                      <rect x="36" y="6" width="22" height="22" rx="4" />
                      <rect x="42" y="12" width="10" height="10" fill="currentColor" opacity="0.3" />
                      <rect x="6" y="36" width="22" height="22" rx="4" />
                      <rect x="12" y="42" width="10" height="10" fill="currentColor" opacity="0.3" />
                      <circle cx="46" cy="46" r="14" fill="#1b1410" stroke="#fb923c" strokeWidth="2.5" />
                      <path d="M46 40v6l4 2.5" stroke="#fb923c" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 64 64" width="76" height="76" fill="none" stroke="currentColor" strokeWidth="2.5" className="tg-login-error-icon">
                      <rect x="6" y="6" width="22" height="22" rx="4" />
                      <rect x="12" y="12" width="10" height="10" fill="currentColor" opacity="0.3" />
                      <rect x="36" y="6" width="22" height="22" rx="4" />
                      <rect x="42" y="12" width="10" height="10" fill="currentColor" opacity="0.3" />
                      <rect x="6" y="36" width="22" height="22" rx="4" />
                      <rect x="12" y="42" width="10" height="10" fill="currentColor" opacity="0.3" />
                      <circle cx="46" cy="46" r="14" fill="#1b121e" stroke="#fb7185" strokeWidth="2.5" />
                      <path d="M46 39v8M46 51v1.5" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  )}
                </div>
                <div className={`tg-login-placeholder-label ${phase.name === 'expired' ? 'is-expired' : 'is-error'}`}>
                  {phase.name === 'expired' ? 'Código caducado' : 'Código no disponible'}
                </div>
              </div>
              <div className={`tg-login-timer ${phase.name === 'expired' ? 'is-expired' : 'is-error'}`}>
                <span className="tg-login-timer-icon">{phase.name === 'expired' ? '⏱' : '⚠️'}</span>
                <span>{phase.name === 'expired' ? 'Código vencido' : 'Sin conexión con el servidor'}</span>
              </div>
            </>
          )}
        </div>

        {/* Right Column: Title, Timeline Stepper, 2-line alternative, and Actions */}
        <div className="tg-login-info">
          <h1 className="tg-login-title">Inicia sesión con Telegram</h1>
          <p className="tg-login-lead">
            Para usar TizenXuper TV, vincula esta TV con tu cuenta de Telegram. Es gratis y solo se hace una vez.
          </p>

          {/* Timeline Stepper */}
          <div className="tg-login-timeline">
            <div className="tg-login-timeline-item">
              <div className="tg-login-timeline-marker">
                <div className="tg-login-timeline-dot">1</div>
                <div className="tg-login-timeline-line"></div>
              </div>
              <div className="tg-login-timeline-content">
                <div className="tg-login-timeline-title">Escanea el código QR</div>
                <div className="tg-login-timeline-sub">Abre la cámara de tu teléfono y apunta al código en pantalla.</div>
              </div>
            </div>

            <div className="tg-login-timeline-item">
              <div className="tg-login-timeline-marker">
                <div className="tg-login-timeline-dot">2</div>
                <div className="tg-login-timeline-line"></div>
              </div>
              <div className="tg-login-timeline-content">
                <div className="tg-login-timeline-title">Confirma en Telegram</div>
                <div className="tg-login-timeline-sub">Se abrirá el bot: toca <b>Iniciar</b> si aparece y luego <b>Sí, iniciar sesión en la TV</b>.</div>
              </div>
            </div>

            <div className="tg-login-timeline-item is-last">
              <div className="tg-login-timeline-marker">
                <div className="tg-login-timeline-dot">3</div>
              </div>
              <div className="tg-login-timeline-content">
                <div className="tg-login-timeline-title">¡Listo para ver!</div>
                <div className="tg-login-timeline-sub">La app confirmará la vinculación y se abrirá sola en unos segundos.</div>
              </div>
            </div>
          </div>

          {/* Unified Clean 2-Line Notification Banner for every state */}
          {phase.name === 'loading' && (
            <div className="tg-login-notice-box is-loading">
              <div className="tg-login-notice-content">
                <div className="tg-login-notice-title">Conectando con el servidor…</div>
                <div className="tg-login-notice-desc">
                  {phase.retryCount && phase.retryCount > 0
                    ? `Intento de conexión ${phase.retryCount + 1} de ${MAX_AUTO_RETRIES + 1}…`
                    : 'Generando un código seguro de vinculación temporal.'}
                </div>
              </div>
            </div>
          )}

          {login && bot && (
            <div className="tg-login-notice-box is-info">
              <div className="tg-login-notice-content">
                <div className="tg-login-notice-title">¿No puedes escanear con la cámara?</div>
                <div className="tg-login-notice-desc">
                  <span>Abre <b>@{bot}</b> en Telegram y envíale el código:</span>
                  <span className="tg-login-alt-code-badge">{formatCode(login.code)}</span>
                </div>
              </div>
            </div>
          )}

          {phase.name === 'error' && (
            <div className="tg-login-notice-box is-error">
              <div className="tg-login-notice-content">
                <div className="tg-login-notice-title">No se pudo conectar con el servidor</div>
                <div className="tg-login-notice-desc">
                  Revisa la conexión a internet de la TV o consulta las soluciones sugeridas.
                </div>
              </div>
            </div>
          )}

          {phase.name === 'expired' && (
            <div className="tg-login-notice-box is-expired">
              <div className="tg-login-notice-content">
                <div className="tg-login-notice-title">El código ha caducado por seguridad</div>
                <div className="tg-login-notice-desc">
                  Los códigos duran 5 minutos. Pulsa el botón para generar uno nuevo.
                </div>
              </div>
            </div>
          )}

          {phase.name === 'done' && (
            <div className="tg-login-notice-box is-done">
              <div className="tg-login-notice-content">
                <div className="tg-login-notice-title">¡Vinculación confirmada!</div>
                <div className="tg-login-notice-desc">
                  ¡Hola{phase.userName ? `, ${phase.userName}` : ''}! Abriendo TizenXuper TV…
                </div>
              </div>
            </div>
          )}

          {login && (
            <div className="tg-login-status is-waiting">
              <span className="tg-login-pulse-dot"></span>
              <span>Esperando la confirmación en Telegram…</span>
            </div>
          )}

          {canRetry && (
            <div className="tg-login-btn-row">
              <div
                className={`pf-btn tg-login-btn ${activeAction === 'retry' ? 'is-focused' : ''}`}
                onClick={retry}
              >
                {phase.name === 'expired' ? 'Generar nuevo código' : 'Reintentar'}
              </div>
              {phase.name === 'error' && (
                <>
                  <div
                    className={`pf-btn tg-login-btn tg-login-btn-diag ${activeAction === 'diag' ? 'is-focused' : ''}`}
                    onClick={handleOpenDiag}
                  >
                    Diagnosticar red
                  </div>
                  <div
                    className={`pf-btn tg-login-btn tg-login-btn-help ${activeAction === 'help' ? 'is-focused' : ''}`}
                    onClick={() => setShowHelpModal(true)}
                  >
                    ¿Cómo solucionarlo?
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showDiagModal && (
        <div className="tg-login-diag-overlay">
          <div className="tg-login-diag-card">
            <div className="tg-login-diag-header">
              <div className="tg-login-diag-badge">DIAGNÓSTICO DE RED EN TIEMPO REAL</div>
              <h2 className="tg-login-diag-title">¿Por qué no carga el código QR?</h2>
              <p className="tg-login-diag-desc">
                Análisis automático del enlace local, sincronización de fecha SSL y servidores de Telegram.
              </p>
            </div>

            <div className="tg-login-diag-checks">
              {diagRunning && !diagResult ? (
                <div className="tg-login-diag-check-item">
                  <div className="tg-login-diag-check-status is-loading">
                    <span className="tg-login-spinner"></span>
                  </div>
                  <div className="tg-login-diag-check-info">
                    <div className="tg-login-diag-check-name">Analizando conexión del televisor…</div>
                    <div className="tg-login-diag-check-detail">Probando interfaz local, resolución DNS y servidores.</div>
                  </div>
                </div>
              ) : (
                (diagResult?.checks || []).map(check => (
                  <div key={check.id} className="tg-login-diag-check-item">
                    <div className={`tg-login-diag-check-status is-${check.status}`}>
                      {check.status === 'ok' && (
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      {check.status === 'warn' && (
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      )}
                      {check.status === 'error' && (
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="15" y1="9" x2="9" y2="15" />
                          <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                      )}
                    </div>
                    <div className="tg-login-diag-check-info">
                      <div className="tg-login-diag-check-title-row">
                        <span className="tg-login-diag-check-name">{check.name}</span>
                        {check.latencyMs !== undefined && (
                          <span className="tg-login-diag-check-latency">{check.latencyMs} ms</span>
                        )}
                      </div>
                      <span className="tg-login-diag-check-detail">{check.detail}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {diagResult && (
              <div className={`tg-login-diag-verdict-box is-${diagResult.verdict === 'ok' ? 'ok' : (diagResult.verdict === 'relay-only' ? 'warn' : 'error')}`}>
                <div className="tg-login-diag-verdict-title">
                  {diagResult.verdict === 'ok' && 'Todo listo para conectar'}
                  {diagResult.verdict === 'clock-wrong' && 'Atención: Fecha y hora desfasadas'}
                  {diagResult.verdict === 'no-internet' && 'Sin conexión a internet'}
                  {diagResult.verdict === 'relay-only' && 'Servidor principal filtrado (Relay listo)'}
                  {diagResult.verdict === 'all-blocked' && 'Bloqueo DNS detectado'}
                  {diagResult.verdict === 'workers-blocked' && 'Filtro DNS en red'}
                </div>
                <div className="tg-login-diag-verdict-desc">
                  {diagResult.recommendation}
                </div>
              </div>
            )}

            <div className="tg-login-diag-footer">
              <div
                className={`pf-btn tg-login-diag-btn ${diagAction === 'retry' ? 'is-focused' : ''}`}
                onClick={() => {
                  setShowDiagModal(false);
                  retry();
                }}
              >
                Reintentar conexión
              </div>
              <div
                className={`pf-btn tg-login-diag-btn tg-login-btn-help ${diagAction === 'help' ? 'is-focused' : ''}`}
                onClick={() => {
                  setShowDiagModal(false);
                  setShowHelpModal(true);
                }}
              >
                ¿Cómo solucionarlo?
              </div>
              <div
                className={`pf-btn tg-login-diag-btn ${diagAction === 'close' ? 'is-focused' : ''}`}
                onClick={() => {
                  setShowDiagModal(false);
                  setActiveAction('diag');
                }}
              >
                Cerrar
              </div>
            </div>
          </div>
        </div>
      )}

      {showHelpModal && (
        <div className="tg-login-help-overlay">
          <div className="tg-login-help-card">
            <div className="tg-login-help-header">
              <div className="tg-login-help-badge">DIAGNÓSTICO Y SOLUCIONES</div>
              <h2 className="tg-login-help-title">¿Cómo solucionar el problema de conexión?</h2>
              <p className="tg-login-help-desc">
                Si tu TV tiene internet pero no carga el código QR, sigue estas recomendaciones:
              </p>
            </div>
            <div className="tg-login-help-steps">
              <div className="tg-login-help-item">
                <div className="tg-login-help-num">1</div>
                <div className="tg-login-help-info">
                  <div className="tg-login-help-name">Fija la IP y el DNS en 1.1.1.1 o 8.8.8.8 (Recomendado)</div>
                  <div className="tg-login-help-sub">
                    Muchos operadores de internet bloquean dominios de video o Cloudflare.
                    En tu TV ve a: <b>Configuración › General › Red › Estado de la red › Configuración de IP</b>,
                    pasa la IP y la <b>Configuración de DNS</b> a <b>Ingresar manualmente</b> y escribe <b>1.1.1.1</b> o <b>8.8.8.8</b>.
                  </div>
                </div>
              </div>
              <div className="tg-login-help-item">
                <div className="tg-login-help-num">2</div>
                <div className="tg-login-help-info">
                  <div className="tg-login-help-name">Prueba compartiendo datos desde tu celular</div>
                  <div className="tg-login-help-sub">
                    Activa la <b>Zona Wi-Fi personal</b> de tu teléfono celular y conecta la TV temporalmente. Si el código carga de inmediato, el bloqueo proviene de tu módem o proveedor de internet de hogar.
                  </div>
                </div>
              </div>
              <div className="tg-login-help-item">
                <div className="tg-login-help-num">3</div>
                <div className="tg-login-help-info">
                  <div className="tg-login-help-name">Verifica la hora y fecha del televisor</div>
                  <div className="tg-login-help-sub">
                    Si el reloj de la TV está desfasado, los certificados de seguridad SSL serán rechazados. Ve a: <b>Configuración › General › Administrador del sistema › Hora › Reloj</b> y asegúrate de que esté en automático o con la fecha actual.
                  </div>
                </div>
              </div>
            </div>
            <div className="tg-login-help-footer">
              <div
                className="pf-btn is-focused tg-login-help-close"
                onClick={() => {
                  setShowHelpModal(false);
                  setActiveAction('retry');
                }}
              >
                Entendido
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
