import React from 'react';

// Keys are either a literal character or one of: mode | space | del | clear | ok
export type KbKey = string;
export type KbMode = 'abc' | '123';

export interface KbState {
  mode: KbMode;
  r: number;
  c: number;
}

/** Starts on "A" (row 0 holds the actions) */
export const KB_INITIAL: KbState = { mode: 'abc', r: 1, c: 0 };

/** A key and how many of the 7 columns it takes */
interface KbCell {
  k: KbKey;
  w: number;
}

const COLS = 7;
const ACTION_KEYS: KbKey[] = ['mode', 'clear', 'del', 'ok', 'space'];

const one = (keys: string[]): KbCell[] => keys.map(k => ({ k, w: 1 }));

// Same order as the official Xuper TV keyboard: actions on top, accented letters next to their base
const ACTIONS: KbCell[] = [{ k: 'mode', w: 2 }, { k: 'clear', w: 1 }, { k: 'del', w: 2 }, { k: 'ok', w: 2 }];

const LETTERS: KbCell[][] = [
  ACTIONS,
  one(['A', 'Á', 'B', 'C', 'D', 'E', 'É']),
  one(['F', 'G', 'H', 'I', 'Í', 'J', 'K']),
  one(['L', 'M', 'N', 'Ñ', 'O', 'Ó', 'P']),
  one(['Q', 'R', 'S', 'T', 'U', 'Ú', 'Ü']),
  [...one(['V', 'W', 'X', 'Y', 'Z']), { k: 'space', w: 2 }]
];

const NUMBERS: KbCell[][] = [
  ACTIONS,
  one(['1', '2', '3', '4', '5', '6', '7']),
  one(['8', '9', '0', '.', ',', '-', "'"]),
  one(['&', '!', '?', ':', ';', '/', '@']),
  one(['(', ')', '+', '_', '#', '"', '*']),
  [...one(['¿', '¡', '%', '$', '=']), { k: 'space', w: 2 }]
];

function grid(mode: KbMode): KbCell[][] {
  return mode === 'abc' ? LETTERS : NUMBERS;
}

/** Keys of each row (without widths) */
export function kbRows(mode: KbMode): KbKey[][] {
  return grid(mode).map(row => row.map(cell => cell.k));
}

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
    case 'mode':
      // Both layouts share their shape, so the cursor stays where it is
      return { query, state: { ...st, mode: st.mode === 'abc' ? '123' : 'abc' } };
    default:
      // Keys show capitals; the text is typed in lowercase (search ignores case)
      return { query: (query + key.toLocaleLowerCase('es')).slice(0, max), state: st };
  }
}

/** Column span [start, end) of a key */
function span(row: KbCell[], c: number): [number, number] {
  let start = 0;
  for (let i = 0; i < c; i++) start += row[i].w;
  return [start, start + row[c].w];
}

/** Key of `row` under the column `col` */
function cellAt(row: KbCell[], col: number): number {
  let start = 0;
  for (let i = 0; i < row.length; i++) {
    if (col < start + row[i].w) return i;
    start += row[i].w;
  }
  return row.length - 1;
}

/** Moves the cursor; returns null when it would leave the keyboard to the right. */
export function moveCursor(st: KbState, dir: 'up' | 'down' | 'left' | 'right'): KbState | null {
  const rows = grid(st.mode);
  const row = rows[st.r];
  if (dir === 'left') return { ...st, c: Math.max(0, st.c - 1) };
  if (dir === 'right') return st.c >= row.length - 1 ? null : { ...st, c: st.c + 1 };
  const r = dir === 'up' ? Math.max(0, st.r - 1) : Math.min(rows.length - 1, st.r + 1);
  if (r === st.r) return st;
  // Wide keys: go to the key under the middle of the current one
  const [a, b] = span(row, st.c);
  return { ...st, r, c: cellAt(rows[r], Math.min(COLS - 1, Math.floor((a + b - 1) / 2))) };
}

export function keyAt(st: KbState): KbKey {
  const rows = grid(st.mode);
  const row = rows[Math.min(st.r, rows.length - 1)];
  return row[Math.min(st.c, row.length - 1)].k;
}

interface OnScreenKeyboardProps {
  state: KbState;
  focused: boolean;
  onPress?: (key: KbKey) => void;
  okLabel?: string;
}

const TrashIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-label="Borrar todo">
    <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h1.6v-8H10zm3.4 0v8H15v-8h-1.6z" />
  </svg>
);

const BackspaceIcon = (
  <svg width="26" height="20" viewBox="0 0 26 20" fill="currentColor" aria-label="Borrar">
    <path d="M8 1h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8L1 10 8 1zm5.3 4.9L11.9 7.3 14.6 10l-2.7 2.7 1.4 1.4L16 11.4l2.7 2.7 1.4-1.4-2.7-2.7 2.7-2.7-1.4-1.4L16 8.6l-2.7-2.7z" />
  </svg>
);

export const OnScreenKeyboard: React.FC<OnScreenKeyboardProps> = ({ state, focused, onPress, okLabel = 'Buscar' }) => {
  const label = (k: KbKey): React.ReactNode => {
    if (k === 'mode') return state.mode === 'abc' ? '123' : 'ABC';
    if (k === 'clear') return TrashIcon;
    if (k === 'del') return BackspaceIcon;
    if (k === 'space') return <span className="osk-space-bar" />;
    if (k === 'ok') return okLabel;
    return k;
  };
  return (
    <div className="osk">
      {grid(state.mode).map((row, r) => (
        <div key={r} className="osk-row">
          {row.map((cell, c) => (
            <div
              key={cell.k + c}
              className={`osk-key ${ACTION_KEYS.indexOf(cell.k) !== -1 ? 'is-action' : ''} ${cell.k === 'ok' ? 'is-ok' : ''} ${
                focused && state.r === r && state.c === c ? 'is-focused' : ''
              }`}
              style={{ flex: `${cell.w} ${cell.w} 0%`, minWidth: 0, ...(cell.w > 1 ? { gridColumn: `span ${cell.w}` } : {}) }}
              onClick={() => onPress && onPress(cell.k)}
            >
              {label(cell.k)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
