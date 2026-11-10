/**
 * Which cards of a grid load their poster: the rows around the focused one. A grid that loaded every poster kept all
 * of them decoded (posters come at up to 2000x3000; 60 results were about 106 MB, 120 about twice that), enough to
 * get the app closed on a TV with 1 GB. Cards outside the window keep their place and show the placeholder.
 */
export const POSTER_ROWS_BEFORE = 2;
export const POSTER_ROWS_AFTER = 3;

export function posterInWindow(index: number, focusIndex: number, cols: number): boolean {
  const perRow = Math.max(1, Math.floor(cols) || 1);
  const row = Math.floor(index / perRow);
  const focusRow = Math.floor(Math.max(0, focusIndex) / perRow);
  return row >= focusRow - POSTER_ROWS_BEFORE && row <= focusRow + POSTER_ROWS_AFTER;
}
