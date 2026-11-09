import React, { useState, useEffect, useRef } from 'react';
import { PinMode } from '../lib/screenStack';
import { parentalService } from '../services/parentalService';
import { useScreenKeys } from '../hooks/useScreenKeys';

type Step = 'current' | 'new' | 'confirm';

interface PinDialogProps {
  mode: PinMode;
  isTop: boolean;
  onSuccess?: () => void;
  onCancel?: () => void;
  onClose: () => void;
}

const PAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['del', '0', 'cancel']
];

const TITLES: Record<Step, string> = {
  current: 'Introduce tu PIN',
  new: 'Crea un PIN de 4 dígitos',
  confirm: 'Confirma el PIN'
};

export const PinDialog: React.FC<PinDialogProps> = ({ mode, isTop, onSuccess, onCancel, onClose }) => {
  const firstStep: Step = mode === 'create' ? 'new' : 'current';
  const [step, setStep] = useState<Step>(firstStep);
  const [digits, setDigits] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [shake, setShake] = useState<boolean>(false);
  const [pos, setPos] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const newPinRef = useRef<string>('');
  const stateRef = useRef({ step, digits });
  stateRef.current = { step, digits };

  const cancel = () => {
    onClose();
    if (onCancel) onCancel();
  };

  const finish = () => {
    onClose();
    if (onSuccess) onSuccess();
  };

  const fail = (text: string) => {
    setMessage(text);
    setShake(true);
    setDigits('');
    setTimeout(() => setShake(false), 400);
  };

  const submit = (pin: string) => {
    const current = stateRef.current.step;
    if (current === 'current') {
      const res = parentalService.verify(pin);
      if (res === 'cooldown') {
        fail(`Demasiados intentos. Espera ${parentalService.cooldownSeconds()} s`);
        return;
      }
      if (res === 'bad') {
        const curAttempt = parentalService.failedAttempts();
        const maxAtt = parentalService.maxAttempts();
        fail(curAttempt > 0 ? `PIN incorrecto (intento ${curAttempt} de ${maxAtt})` : 'PIN incorrecto');
        return;
      }
      if (mode === 'change') {
        setStep('new');
        setDigits('');
        setMessage('');
        return;
      }
      if (mode === 'disable') parentalService.clear();
      finish();
      return;
    }
    if (current === 'new') {
      newPinRef.current = pin;
      setStep('confirm');
      setDigits('');
      setMessage('');
      return;
    }
    if (pin !== newPinRef.current) {
      setStep('new');
      fail('Los PIN no coinciden. Inténtalo de nuevo');
      return;
    }
    parentalService.setPin(pin);
    finish();
  };

  const pushDigit = (d: string) => {
    const next = (stateRef.current.digits + d).slice(0, 4);
    setDigits(next);
    setMessage('');
    if (next.length === 4) {
      // let the 4th box render before moving on
      setTimeout(() => submit(next), 120);
    }
  };

  const pressPad = (cell: string) => {
    if (cell === 'del') setDigits(prev => prev.slice(0, -1));
    else if (cell === 'cancel') cancel();
    else pushDigit(cell);
  };

  useScreenKeys((key, e) => {
    if (/^[0-9]$/.test(e.key)) {
      pushDigit(e.key);
      return;
    }
    if (key === 'back') {
      if (stateRef.current.digits.length > 0) setDigits(prev => prev.slice(0, -1));
      else cancel();
      return;
    }
    if (key === 'up') setPos(p => ({ ...p, r: Math.max(0, p.r - 1) }));
    else if (key === 'down') setPos(p => ({ ...p, r: Math.min(PAD.length - 1, p.r + 1) }));
    else if (key === 'left') setPos(p => ({ ...p, c: Math.max(0, p.c - 1) }));
    else if (key === 'right') setPos(p => ({ ...p, c: Math.min(2, p.c + 1) }));
    else if (key === 'enter') pressPad(PAD[pos.r][pos.c]);
  }, isTop);

  useEffect(() => {
    const t = setInterval(() => {
      if (parentalService.cooldownSeconds() === 0) return;
      setMessage(`Demasiados intentos. Espera ${parentalService.cooldownSeconds()} s`);
    }, 1000);
    const onVisChange = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, []);

  return (
    <div className="pin-overlay">
      <div className="pin-dialog">
        <div className="pin-lock-icon">
          <svg viewBox="0 0 32 32" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="7" y="14" width="18" height="14" rx="2" />
            <path d="M11 14V10a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="pin-title">{TITLES[step]}</h2>
        <p className="pin-subtitle">
          {mode === 'unlock' && 'Este contenido está protegido'}
          {mode === 'disable' && 'Se quitará el bloqueo de todas las categorías'}
          {mode === 'change' && (step === 'current' ? 'Primero confirma tu PIN actual' : 'Elige tu nuevo PIN')}
          {mode === 'create' && 'Lo pedirá para abrir las categorías que bloquees'}
        </p>
        <div className={`pin-boxes ${shake ? 'is-shake' : ''}`}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`pin-box ${i < digits.length ? 'is-filled' : ''}`}>
              {i < digits.length ? '●' : ''}
            </div>
          ))}
        </div>
        <div className="pin-message">{message}</div>
        <div className="pin-pad">
          {PAD.map((row, r) =>
            row.map((cell, c) => (
              <div
                key={cell}
                className={`pin-key ${pos.r === r && pos.c === c ? 'is-focused' : ''}`}
                onClick={() => pressPad(cell)}
              >
                {cell === 'del' ? '⌫' : cell === 'cancel' ? '✕' : cell}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
