import React, { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { accountService, formatCode, LoginCode } from '../services/accountService';
import { useScreenKeys } from '../hooks/useScreenKeys';
import { BrandLogo } from '../components/common/BrandLogo';

type Phase =
  | { name: 'loading' }
  | { name: 'waiting'; login: LoginCode }
  | { name: 'expired' }
  | { name: 'error' }
  | { name: 'done'; userName: string };

/** How long the greeting stays before the app opens */
const DONE_DELAY_MS = 1500;

/** QR code as one SVG path (crisp at any size); the white card around it is the quiet zone */
const QrCode: React.FC<{ text: string; size: number }> = ({ text, size }) => {
  const { d, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { d: path, count: n };
  }, [text]);
  return (
    <svg className="tg-login-qr" viewBox={`0 0 ${count} ${count}`} width={size} height={size} shapeRendering="crispEdges">
      <path d={d} fill="#000" />
    </svg>
  );
};

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

/**
 * Required sign-in before the app: a QR code that opens the TizenXuper bot in Telegram.
 * Drawn above the splash screen, which keeps loading underneath and shows once the user is in.
 */
export const LoginScreen: React.FC<{ onSignedIn: () => void }> = ({ onSignedIn }) => {
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Ask for a code, then check every few seconds whether the user confirmed it in the bot
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setPhase({ name: 'loading' });

    accountService.startLogin().then(login => {
      if (cancelled) return;
      setPhase({ name: 'waiting', login });
      const check = () => {
        accountService.poll(login).then(result => {
          if (cancelled) return;
          if (result.status === 'linked') {
            setPhase({ name: 'done', userName: result.session.name });
            timer = setTimeout(onSignedIn, DONE_DELAY_MS);
          } else if (result.status === 'expired') {
            setPhase({ name: 'expired' });
          } else {
            timer = setTimeout(check, login.interval * 1000);
          }
        }, () => {
          // A failed check (network hiccup) is retried until the code expires
          if (cancelled) return;
          if (Date.now() >= login.expiresAt) setPhase({ name: 'expired' });
          else timer = setTimeout(check, login.interval * 1000);
        });
      };
      timer = setTimeout(check, login.interval * 1000);
    }, () => {
      if (!cancelled) setPhase({ name: 'error' });
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [attempt]);

  // Countdown of the code
  useEffect(() => {
    if (phase.name !== 'waiting') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase.name]);

  const retry = () => setAttempt(a => a + 1);
  const canRetry = phase.name === 'expired' || phase.name === 'error';

  useScreenKeys(key => {
    if (key === 'enter' && canRetry) retry();
    else if (key === 'back' && window.XuperPlatform && window.XuperPlatform.exit) window.XuperPlatform.exit();
  });

  const login = phase.name === 'waiting' ? phase.login : null;
  const bot = login ? botName(login.url) : '';

  return (
    <div className="tg-login">
      <div className="tg-login-brand"><BrandLogo /></div>
      <div className="tg-login-body">
        <div className={`tg-login-card ${login ? '' : 'is-empty'}`}>
          {login ? (
            <>
              <QrCode text={login.url} size={260} />
              <div className="tg-login-code">{formatCode(login.code)}</div>
            </>
          ) : (
            <div className="tg-login-card-msg">
              {phase.name === 'done' ? '✓' : phase.name === 'loading' ? 'Generando código…' : 'Código no disponible'}
            </div>
          )}
        </div>

        <div className="tg-login-info">
          <h1 className="tg-login-title">Inicia sesión con Telegram</h1>
          <p className="tg-login-lead">
            Para usar TizenXuper TV, vincula esta TV con tu cuenta de Telegram. Es gratis y solo se hace una vez.
          </p>
          <div className="tg-login-steps">
            <div className="tg-login-step"><span className="tg-login-num">1</span><span>Abre la cámara de tu teléfono y escanea el código QR.</span></div>
            <div className="tg-login-step"><span className="tg-login-num">2</span><span>Se abrirá Telegram: toca <b>Iniciar</b> si aparece y luego <b>Sí, iniciar sesión en la TV</b>.</span></div>
            <div className="tg-login-step"><span className="tg-login-num">3</span><span>Listo: la app se abrirá sola en unos segundos.</span></div>
          </div>
          {login && bot && (
            <p className="tg-login-alt">
              ¿No puedes escanear? Abre <b>@{bot}</b> en Telegram y envíale el código <b>{formatCode(login.code)}</b>.
            </p>
          )}

          <div className={`tg-login-status is-${phase.name}`}>
            {phase.name === 'loading' && 'Conectando…'}
            {phase.name === 'waiting' && `Esperando la confirmación en Telegram · el código vence en ${countdown(phase.login.expiresAt - now)}`}
            {phase.name === 'expired' && 'El código venció.'}
            {phase.name === 'error' && 'No se pudo conectar con el servidor. Revisa la conexión a internet de la TV.'}
            {phase.name === 'done' && `¡Hola${phase.userName ? `, ${phase.userName}` : ''}! Abriendo TizenXuper TV…`}
          </div>
          {canRetry && (
            <div className="pf-btn is-focused tg-login-retry" onClick={retry}>
              {phase.name === 'expired' ? 'Generar nuevo código' : 'Reintentar'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
