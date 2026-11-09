import type { VodItem } from '../types/vod.ts';
import { normalizeCatalogText, parseSeason, isSeriesItem } from './catalogOrganizer.ts';

/** Placeholders are fallback-only and never count as real title artwork */
export function isPlaceholderArt(url: string | undefined | null): boolean {
  if (!url) return true;
  const s = String(url).trim();
  return !s || s.includes('placeholder_vertical') || s.includes('placeholder_landscape') || s.includes('placeholder_horizontal');
}

/** Validates that a candidate artwork string is a safe, usable URL or local asset path */
export function isUsableArtworkUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const s = url.trim();
  if (!s || isPlaceholderArt(s)) return false;
  if (/[\r\n@]/.test(s)) return false;
  return /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\/[^\s]*$/i.test(s) || /^assets\/[^\s]+$/i.test(s);
}

/** Normalizes a title for cross-referencing search results with the local catalog */
export function normalizeArtworkTitle(value: string | undefined | null): string {
  const base = parseSeason(value).title;
  return normalizeCatalogText(base);
}

function firstYear(value: string | undefined | null): string {
  const m = /^(19|20)\d{2}/.exec(String(value || '').trim());
  return m ? m[0] : '';
}

/** Deduplicates candidate image URLs in priority order, excluding empty strings and placeholders */
export function collectPosterAlternates(...candidates: Array<string | undefined | null | Array<string | undefined | null>>): string[] {
  const result: string[] = [];
  for (const entry of candidates) {
    const list = Array.isArray(entry) ? entry : [entry];
    for (const raw of list) {
      if (!isUsableArtworkUrl(raw)) continue;
      const trimmed = raw.trim();
      if (result.indexOf(trimmed) === -1) {
        result.push(trimmed);
      }
    }
  }
  return result.slice(0, 6);
}

/**
 * Enriches search or sparse portal items with verified artwork from the known catalog.
 * Matches first by content ID, then by normalized title + series/movie kind + release year.
 * Populates `posterAlternates` so cards automatically fall back if the primary URL fails on Tizen.
 */
export function enrichSearchItems(
  items: VodItem[],
  catalogPool: VodItem[],
  preferCatalogPoster = true
): VodItem[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (!Array.isArray(catalogPool) || catalogPool.length === 0) {
    return items.map(item => {
      const alternates = collectPosterAlternates(item.poster, item.posterAlternates, item.landscape, item.backdrop);
      return alternates.length
        ? {
            ...item,
            poster: isUsableArtworkUrl(item.poster) ? item.poster : alternates[0],
            posterAlternates: alternates
          }
        : item;
    });
  }

  const byId = new Map<string, VodItem>();
  const byTitle = new Map<string, VodItem[]>();

  for (const catItem of catalogPool) {
    if (!catItem) continue;
    const hasArt = isUsableArtworkUrl(catItem.poster) || isUsableArtworkUrl(catItem.landscape) || isUsableArtworkUrl(catItem.backdrop);
    if (!hasArt) continue;
    if (catItem.id) {
      byId.set(String(catItem.id), catItem);
      byId.set(String(catItem.id).toUpperCase(), catItem);
    }
    const normTitle = normalizeArtworkTitle(catItem.title);
    if (normTitle) {
      let bucket = byTitle.get(normTitle);
      if (!bucket) {
        bucket = [];
        byTitle.set(normTitle, bucket);
      }
      bucket.push(catItem);
    }
  }

  return items.map(item => {
    if (!item) return item;
    const idKey = String(item.id || '');
    let matched: VodItem | undefined = byId.get(idKey) || byId.get(idKey.toUpperCase());

    if (!matched || !isUsableArtworkUrl(matched.poster)) {
      const normTitle = normalizeArtworkTitle(item.title);
      const candidates = normTitle ? byTitle.get(normTitle) : undefined;
      if (candidates && candidates.length > 0) {
        const itemSeries = isSeriesItem(item);
        const itemYear = firstYear(item.year);
        let bestScore = -1e6;
        let bestCandidate: VodItem | undefined;

        for (const cand of candidates) {
          const candSeries = isSeriesItem(cand);
          if (itemSeries !== candSeries) continue;
          let score = 10;
          const candYear = firstYear(cand.year);
          if (itemYear && candYear && itemYear !== candYear) continue;
          if (itemYear && candYear && itemYear === candYear) score += 20;
          if (isUsableArtworkUrl(cand.landscape) || isUsableArtworkUrl(cand.backdrop)) score += 2;
          if (score > bestScore) {
            bestScore = score;
            bestCandidate = cand;
          }
        }
        if (bestCandidate) matched = bestCandidate;
      }
    }

    const savedPoster = matched && isUsableArtworkUrl(matched.poster) ? matched.poster : '';
    const savedLandscape = matched && isUsableArtworkUrl(matched.landscape) ? matched.landscape : '';
    const savedBackdrop = matched && isUsableArtworkUrl(matched.backdrop) ? matched.backdrop : '';
    const ownPoster = isUsableArtworkUrl(item.poster) ? item.poster : '';
    const ownLandscape = isUsableArtworkUrl(item.landscape) ? item.landscape : '';
    const ownBackdrop = isUsableArtworkUrl(item.backdrop) ? item.backdrop : '';

    const alternates = collectPosterAlternates(
      preferCatalogPoster ? savedPoster : ownPoster,
      preferCatalogPoster ? ownPoster : savedPoster,
      matched?.posterAlternates,
      item.posterAlternates,
      savedLandscape,
      ownLandscape,
      savedBackdrop,
      ownBackdrop
    );

    const primaryPoster = alternates[0] || item.poster || 'assets/placeholder_vertical.png';
    const primaryLandscape = (preferCatalogPoster ? (savedLandscape || ownLandscape) : (ownLandscape || savedLandscape)) || primaryPoster;
    const primaryBackdrop = (preferCatalogPoster ? (savedBackdrop || ownBackdrop) : (ownBackdrop || savedBackdrop)) || primaryLandscape;

    return {
      ...item,
      poster: primaryPoster,
      landscape: primaryLandscape,
      backdrop: primaryBackdrop,
      posterAlternates: alternates
    };
  });
}
