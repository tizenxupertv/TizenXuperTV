import React from 'react';

// Keys are either a literal character or one of: shift | mode | space | del | clear | ok
export type KbKey = string;
export type KbMode = 'abc' | '123' | 'acc';

export interface KbState {
  mode: KbMode;
  caps: boolean; // one-shot shift: the next letter is uppercase
  r: number;
  c: number;
}

export const KB_INITIAL: KbState = { mode: 'abc', caps: false, r: 0, c: 0 };

const ACTIONS: KbKey[] = ['shift', 'mode', 'space', 'del', 'clear', 'ok'];

const LETTERS = [
  ['a', 'b', 'c', 'd', 'e', 'f'],
  ['g', 'h', 'i', 'j', 'k', 'l'],
  ['m', 'n', 'o', 'p', 'q', 'r'],
  ['s', 't', 'u', 'v', 'w', 'x'],
  ['y', 'z', 'ñ', '.', '-', "'"]
];

const NUMBERS = [
  ['1', '2', '3', '4', '5', '6'],
  ['7', '8', '9', '0', '.', ','],
  ['-', '_', '&', '+', '!', '?'],
  ['@', '#', '$', '%', '(', ')'],
  [':', ';', '/', "'", '"', '*']
];

const ACCENTS = [
  ['á', 'é', 'í', 'ó', 'ú', 'ü'],
  ['ñ', 'ç', '¿', '¡', 'ã', 'õ'],
  ['à', 'è', 'ì', 'ò', 'ù', 'ï'],
  ['â', 'ê', 'î', 'ô', 'û', 'ä']
];

export function kbRows(mode: KbMode, caps: boolean): KbKey[][] {
  const base = mode === 'abc' ? LETTERS : mode === '123' ? NUMBERS : ACCENTS;
  const body = caps ? base.map(row => row.map(k => k.toUpperCase())) : base;
  return [...body, ACTIONS];
}

const NEXT_MODE: Record<KbMode, KbMode> = { abc: '123', '123': 'acc', acc: 'abc' };
const MODE_LABEL: Record<KbMode, string> = { abc: '123', '123': 'áñ', acc: 'abc' };

/** Applies a pressed key to the text and the keyboard state. */
export function pressKey(
  key: KbKey,
  query: string,
  st: KbState,
  max: number = 40
): { query: string; state: KbState; ok?: boolean } {
  switch (key) {
    case 'ok':
      return { query, state: st, ok: true };
    case 'del':
      return { query: query.slice(0, -1), state: st };
    case 'clear':
      return { query: '', state: st };
    case 'space':
      return { query: (query + ' ').slice(0, max), state: st };
    case 'shift':
      return { query, state: { ...st, caps: !st.caps } };
    case 'mode': {
      const mode = NEXT_MODE[st.mode];
      const rows = kbRows(mode, st.caps);
      const r = Math.min(st.r, rows.length - 1);
      return { query, state: { ...st, mode, r, c: Math.min(st.c, rows[r].length - 1) } };
    }
    default:
      return { query: (query + key).slice(0, max), state: { ...st, caps: false } };
  }
}

/** Moves the cursor; returns null when it would leave the keyboard to the right. */
export function moveCursor(st: KbState, dir: 'up' | 'down' | 'left' | 'right'): KbState | null {
  const rows = kbRows(st.mode, st.caps);
  let r = st.r;
  let c = st.c;
  if (dir === 'up') r = Math.max(0, r - 1);
  if (dir === 'down') r = Math.min(rows.length - 1, r + 1);
  if (dir === 'left') c = Math.max(0, c - 1);
  if (dir === 'right') {
    if (c >= rows[r].length - 1) return null;
    c += 1;
  }
  return { ...st, r, c: Math.min(c, rows[r].length - 1) };
}

export function keyAt(st: KbState): KbKey {
  const rows = kbRows(st.mode, st.caps);
  const r = Math.min(st.r, rows.length - 1);
  return rows[r][Math.min(st.c, rows[r].length - 1)];
}

interface OnScreenKeyboardProps {
  state: KbState;
  focused: boolean;
  onPress?: (key: KbKey) => void;
  okLabel?: string;
}

export const OnScreenKeyboard: React.FC<OnScreenKeyboardProps> = ({ state, focused, onPress, okLabel = 'Buscar' }) => {
  const rows = kbRows(state.mode, state.caps);
  const label = (k: KbKey): string => {
    if (k === 'shift') return state.caps ? '⇩' : '⇧';
    if (k === 'mode') return MODE_LABEL[state.mode];
    if (k === 'space') return '␣';
    if (k === 'del') return '⌫';
    if (k === 'clear') return '✕';
    if (k === 'ok') return okLabel;
    return k;
  };
  return (
    <div className="osk">
      {rows.map((row, r) => (
        <div key={r} className="osk-row">
          {row.map((k, c) => {
            const isAction = ACTIONS.indexOf(k) !== -1;
            return (
              <div
                key={k + c}
                className={`osk-key ${isAction ? 'is-action' : ''} ${k === 'shift' && state.caps ? 'is-on' : ''} ${
                  focused && state.r === r && state.c === c ? 'is-focused' : ''
                }`}
                onClick={() => onPress && onPress(k)}
              >
                {label(k)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};
