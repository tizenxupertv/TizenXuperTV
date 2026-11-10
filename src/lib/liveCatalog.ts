/**
 * What to do with a live catalog that was just downloaded, one list per root (null: that root's request failed).
 *
 * A root that timed out used to count as an empty one: the rest still added up to more than the minimum, the partial
 * catalog replaced the complete saved copy as if it were fresh, and that tab stayed cut short until the next refresh.
 */
export type LiveCatalogSave = 'save' | 'save-retry-soon' | 'keep-saved';

/** A saved copy older than this is replaced even by a partial download (a root may be gone for good) */
export const KEEP_SAVED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * - every root answered → 'save'
 * - a root failed and the saved copy is recent → 'keep-saved' (it stays; the next refresh tries again)
 * - a root failed and there is no saved copy, or an old one → 'save-retry-soon' (better than nothing, due again soon)
 * `savedAgeMs`: age of the saved copy, null when there is none
 */
export function liveCatalogSave(roots: Array<unknown[] | null>, savedAgeMs: number | null): LiveCatalogSave {
  if (roots.every(r => r !== null)) return 'save';
  if (savedAgeMs !== null && savedAgeMs < KEEP_SAVED_MAX_AGE_MS) return 'keep-saved';
  return 'save-retry-soon';
}
