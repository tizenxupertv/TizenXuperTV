import React, { useMemo } from 'react';
import { VodItem } from '../../types/vod';
import { historyService } from '../../services/historyService';
import { formatDuration, getResumeTarget } from '../../lib/vodResume';
import { formatQualityTag, firstQuality } from '../../lib/subtitles';
import { useTitleMeta } from '../../lib/titleMetaCache';
import { isLightCopy } from '../../services/catalogService';

interface HeroShowcaseProps {
  item: VodItem;
  totalItems: number;
  activeIndex: number;
  focusedButton: 'play' | 'fav' | null;
  isFavorite: boolean;
  isDimmed?: boolean;
  onPlay: (item: VodItem) => void;
  onToggleFav: (item: VodItem) => void;
}

const HeroShowcaseComponent: React.FC<HeroShowcaseProps> = ({
  item,
  totalItems,
  activeIndex,
  focusedButton,
  isFavorite,
  isDimmed,
  onPlay,
  onToggleFav
}) => {
  const cachedMeta = useTitleMeta(item?.id);
  const qualityTag = item ? formatQualityTag(firstQuality(item.qualities, item.quality, cachedMeta?.qualities, cachedMeta?.quality), item.category) : '';
  const hasCC = item ? Boolean((item as any).moreSubtitle || (item as any).subtitles?.length || cachedMeta?.hasCC) : false;
  const year = (item?.year && item.year !== '—' ? item.year : '') || cachedMeta?.year || '';
  const rawDuration = (item?.duration && item.duration !== '—' ? item.duration : '') || cachedMeta?.duration || '';
  const durationStr = rawDuration ? (formatDuration(rawDuration) || rawDuration) : '';
  const rawActors = (item?.actors && item.actors !== '—' ? item.actors : '') || cachedMeta?.actors || '';
  const actorsStr = rawActors ? rawActors.split(',').slice(0, 3).map(s => s.trim()).filter(Boolean).join(', ') : '';
  const directorStr = (item?.director && item.director !== '—' ? item.director : '') || cachedMeta?.director || '';

  const historyEntry = useMemo(() => (item?.id ? historyService.getEntry(item.id) : null), [item?.id]);
  const resumeTarget = useMemo(
    () => (item ? getResumeTarget(item, item.seasons || [], historyEntry) : { startAt: 0, progressPercent: 0, remainingText: '' }),
    [item, historyEntry]
  );

  if (!item) return null;

  // The catalog's light copy (~150 KB) wins over the title details' backdrop, the portal original of 2-4 MB
  const lightBackdrop = isLightCopy(item.backdrop) ? item.backdrop : '';
  const rawBg = lightBackdrop || cachedMeta?.backdrop || item.backdrop || item.landscape || item.poster || 'assets/placeholder_landscape.png';
  const isLocal = typeof window !== 'undefined' && (
    import.meta.env.DEV ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
  const bgUrl = isLocal && /^https?:/.test(rawBg)
    ? `${location.origin}/stream-proxy?url=${encodeURIComponent(rawBg)}`
    : rawBg;

  // Only what the catalog knows about the title
  const genresList = item.genres && item.genres.length ? item.genres.slice(0, 3) : [];
  const score = item.score && item.score !== '0' && item.score !== '—' ? item.score : '';
  const synopsis = item.synopsis || item.tagline || '';

  const hasProgress = resumeTarget.startAt > 10 && (resumeTarget.progressPercent || 0) > 0;

  return (
    <div className={`home-showcase apple-showcase ${isDimmed ? 'is-dimmed' : ''}`}>
      <div
        className="showcase-bg"
        // The tiny preview sits under the real backdrop: it shows at once, the backdrop covers it when it arrives
        style={{ backgroundImage: item.backdropThumb ? `url('${bgUrl}'), url('${item.backdropThumb}')` : `url('${bgUrl}')` }}
      />
      <div className="showcase-gradient" />

      <div className="showcase-content">
        <h1 className="showcase-title">{item.title || 'Sin título'}</h1>

        {/* Apple TV Line 1: Type · Genres */}
        <div className="hero-type-genres">
          <span>{item.isSeries ? 'Programa de TV' : 'Película'}</span>
          {genresList.map((g, i) => (
            <React.Fragment key={i}>
              <span className="hero-meta-sep">·</span>
              <span>{g}</span>
            </React.Fragment>
          ))}
        </div>

        {/* Apple TV Line 2: Compact 2-line synopsis */}
        {synopsis && <p className="showcase-synopsis">{synopsis}</p>}

        {/* Apple TV Line 3: Year · Duration · Score · Technical Badges (4K/FHD/CC) */}
        {(year || durationStr || score || qualityTag || hasCC) && (
          <div className="showcase-meta apple-meta">
            {year && <span>{year}</span>}
            {year && durationStr && <span className="hero-meta-sep">·</span>}
            {durationStr && <span>{durationStr}</span>}
            {score && (
              <>
                {(year || durationStr) && <span className="hero-meta-sep">·</span>}
                <span>★ {score}</span>
              </>
            )}
            {qualityTag && (
              <span className={`hero-solid-badge ${qualityTag === '4K' ? 'is-4k' : ''}`}>
                {qualityTag}
              </span>
            )}
            {hasCC && <span className="hero-outline-badge">CC</span>}
          </div>
        )}

        {/* Action Buttons */}
        <div className="showcase-actions">
          <button
            className={`showcase-btn play-btn-apple ${hasProgress ? 'has-progress' : ''} ${focusedButton === 'play' ? 'is-focused' : ''}`}
            onClick={() => onPlay(item)}
          >
            <span className="play-triangle">▶</span>
            {hasProgress ? (
              <span className="hero-btn-progress-wrap">
                <span className="hero-btn-progress-track">
                  <span className="hero-btn-progress-fill" style={{ width: `${Math.min(100, Math.max(8, resumeTarget.progressPercent || 0))}%` }} />
                </span>
                <span className="hero-btn-remaining">{resumeTarget.remainingText || 'Continuar'}</span>
              </span>
            ) : (
              <span>Reproducir</span>
            )}
          </button>

          <button
            className={`showcase-btn icon-btn-apple ${focusedButton === 'fav' ? 'is-focused' : ''} ${isFavorite ? 'is-fav' : ''}`}
            onClick={() => onToggleFav(item)}
            title={isFavorite ? 'En Mi Lista' : 'Añadir a Mi Lista'}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isFavorite ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M12 5v14M5 12h14" />}
            </svg>
          </button>
        </div>
      </div>

      {/* Bottom-right Cast & Director block */}
      {(actorsStr || directorStr) && (
        <div className="showcase-credits">
          {actorsStr && (
            <div className="showcase-credit-line">
              <span className="credit-label">Reparto</span>{' '}
              <span className="credit-value">{actorsStr}</span>
            </div>
          )}
          {directorStr && (
            <div className="showcase-credit-line">
              <span className="credit-label">Director</span>{' '}
              <span className="credit-value">{directorStr}</span>
            </div>
          )}
        </div>
      )}

      {/* Centered/Right carousel dots at bottom */}
      <div className="showcase-dots apple-dots">
        {Array.from({ length: Math.min(10, totalItems) }).map((_, idx) => (
          <div
            key={idx}
            className={`showcase-dot ${idx === activeIndex ? 'is-active' : ''}`}
          />
        ))}
      </div>
    </div>
  );
};

export const HeroShowcase = React.memo<HeroShowcaseProps>(
  HeroShowcaseComponent,
  (prev, next) => {
    return (
      prev.item?.id === next.item?.id &&
      prev.activeIndex === next.activeIndex &&
      prev.totalItems === next.totalItems &&
      prev.focusedButton === next.focusedButton &&
      prev.isFavorite === next.isFavorite &&
      prev.isDimmed === next.isDimmed
    );
  }
);
