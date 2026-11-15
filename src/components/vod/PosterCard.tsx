import React, { useRef, useEffect, useState, useMemo } from 'react';
import { VodItem } from '../../types/vod';
import { isImagePrecached, markImageLoaded, markImageFailed } from '../../lib/imageCache';
import { useCardImage } from '../../lib/useCardImage';
import { collectPosterAlternates } from '../../lib/searchArtwork';
import { startImageTracking } from '../../lib/perfMonitor';
import { formatQualityTag, firstQuality } from '../../lib/subtitles';
import { useTitleMeta } from '../../lib/titleMetaCache';
import { historyService } from '../../services/historyService';
import { isFinished } from '../../lib/vodResume';

interface PosterCardProps {
  item: VodItem;
  isFocused: boolean;
  rank?: number; // 1-10 for Top 10 rows
  isWide?: boolean; // 4:3 / landscape card (e.g. Colección Destacada)
  /** False until the card is near the screen: its image is not downloaded or decoded before */
  showImage?: boolean;
  onActivate: (item: VodItem) => void;
}

const PosterCardComponent: React.FC<PosterCardProps> = ({
  item,
  isFocused,
  rank,
  isWide,
  showImage = true,
  onActivate
}) => {
  const candidates = useMemo(() => {
    return isWide
      ? collectPosterAlternates(item.landscape, item.backdrop, item.poster, item.posterAlternates)
      : collectPosterAlternates(item.poster, item.posterAlternates, item.landscape, item.backdrop);
  }, [isWide, item.poster, item.landscape, item.backdrop, item.posterAlternates]);

  const [altIndex, setAltIndex] = useState(0);
  const [allFailed, setAllFailed] = useState(false);

  useEffect(() => {
    setAltIndex(0);
    setAllFailed(false);
  }, [item.id, isWide, candidates]);

  const activeRawUrl = !allFailed && candidates.length > 0
    ? candidates[Math.min(altIndex, candidates.length - 1)]
    : '';

  // Card-size copy of the portal image; the placeholder shows under it until it is ready
  const placeholder = isWide ? 'assets/placeholder_landscape.png' : 'assets/placeholder_vertical.png';
  const cardSrc = useCardImage(activeRawUrl, isWide ? 484 : 230, isWide ? 340 : 340, showImage && !!activeRawUrl);

  const isCached = !!cardSrc && isImagePrecached(cardSrc);
  const [imgLoaded, setImgLoaded] = useState(isCached);

  useEffect(() => {
    setImgLoaded(!!cardSrc && isImagePrecached(cardSrc));
  }, [cardSrc]);

  const trackingRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (showImage && cardSrc && !trackingRef.current) {
      trackingRef.current = startImageTracking();
    }
  }, [showImage, cardSrc]);

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const imgEl = e.currentTarget;
    if (imgEl && imgEl.naturalWidth === 0) {
      handleImgError();
      return;
    }
    if (cardSrc) markImageLoaded(cardSrc);
    setImgLoaded(true);
    if (trackingRef.current) {
      trackingRef.current();
      trackingRef.current = null;
    }
  };

  const handleImgError = () => {
    if (cardSrc) markImageFailed(cardSrc);
    if (altIndex + 1 < candidates.length) {
      setImgLoaded(false);
      setAltIndex(prev => prev + 1);
      return;
    }
    setImgLoaded(false);
    setAllFailed(true);
    if (trackingRef.current) {
      trackingRef.current();
      trackingRef.current = null;
    }
  };

  const cachedMeta = useTitleMeta(item.id);

  const qualityTag = useMemo(() => {
    return formatQualityTag(
      firstQuality(item.qualities, item.quality, cachedMeta?.qualities, cachedMeta?.quality),
      item.category
    );
  }, [item.quality, item.qualities, cachedMeta?.quality, cachedMeta?.qualities, item.category]);

  const episodeInfo = useMemo(() => {
    if (!item.isSeries && item.kind !== 'serie' && item.kind !== 'anime') return null;
    const update = item.updateCount || 0;
    const total = item.volumeCount || 0;

    // Enfoque 1 + C: Series finalizadas/completas NO llevan badge (carátula 100% limpia)
    if (total > 0 && update >= total) {
      return null;
    }

    // Solo series en emisión activa muestran el badge superior: T{temporada} · E{episodio}
    if (update > 0) {
      let seasonNum = 1;
      const seasonMatch = item.title && item.title.match(/(?:temporada|temp\.?|t)\s*(\d+)/i);
      if (seasonMatch && seasonMatch[1]) {
        seasonNum = parseInt(seasonMatch[1], 10) || 1;
      } else if (item.seasons && item.seasons.length > 0 && item.seasons[0].number) {
        seasonNum = item.seasons[0].number;
      }
      return { label: `T${seasonNum} · E${update}`, isComplete: false };
    }

    return null;
  }, [item.isSeries, item.kind, item.updateCount, item.volumeCount, item.title, item.seasons]);

  const categoryName = item.isSeries ? 'Programa de TV' : 'Película';
  // Only what the catalog knows: score, year, genres, category
  const genresStr = item.genres && item.genres.length ? item.genres.slice(0, 2).join(' · ') : (item.category || '');
  const wideSubtitle = [categoryName, genresStr].filter(Boolean).join(' · ');
  const knownScore = item.score && item.score !== '0' ? item.score : '';
  const knownYear = item.year && item.year !== '—' ? item.year : '';
  const wideTagline = [knownScore && `★ ${knownScore}`, knownYear].filter(Boolean).join(' · ');

  const metaSubtitle = [knownScore && `★ ${knownScore}`, knownYear].filter(Boolean).join(' · ')
    || (item.genres && item.genres[0]) || (item.category ? item.category.toUpperCase() : '');

  const [watchProgress, setWatchProgress] = useState<number>(() => {
    const entry = historyService.getEntry(item.id);
    if (!entry || !(entry.duration > 0) || entry.position <= 10 || isFinished(entry.position, entry.duration)) {
      return 0;
    }
    return Math.min(100, Math.max(0, Math.round((entry.position / entry.duration) * 100)));
  });

  useEffect(() => {
    const updateProgress = () => {
      const entry = historyService.getEntry(item.id);
      if (!entry || !(entry.duration > 0) || entry.position <= 10 || isFinished(entry.position, entry.duration)) {
        setWatchProgress(0);
        return;
      }
      setWatchProgress(Math.min(100, Math.max(0, Math.round((entry.position / entry.duration) * 100))));
    };
    updateProgress();
    return historyService.subscribe(updateProgress);
  }, [item.id]);

  return (
    <div
      className={`poster-card apple-poster-card ${isWide ? 'is-wide-card' : ''} ${rank ? 'has-rank' : ''} ${isFocused ? 'is-focused' : ''}`}
      onClick={() => onActivate(item)}
    >
      <div className="poster-card-img">
        <img
          className="poster-card-placeholder-img"
          src={placeholder}
          alt=""
          loading="eager"
        />
        {showImage && cardSrc && !allFailed && (
          <img
            className={`poster-card-img-element ${imgLoaded ? 'is-loaded' : ''}`}
            src={cardSrc}
            decoding="async"
            loading="lazy"
            onLoad={handleImgLoad}
            onError={handleImgError}
            alt=""
          />
        )}
        {/* Top 10 Rank Number in clean Apple TV typography */}
        {rank !== undefined && rank > 0 && !isWide && (
          <div className="poster-rank-badge">{rank}</div>
        )}

        {/* Episode status badge for series / anime */}
        {episodeInfo && !rank && !isWide && (
          <div className={`poster-episode-badge ${episodeInfo.isComplete ? 'is-complete' : 'is-airing'}`}>
            {episodeInfo.label}
          </div>
        )}

        {/* Quality Tag (4K, FHD, HD) in top-right corner */}
        {qualityTag && !isWide && (
          <div className={`poster-quality-badge ${qualityTag === '4K' ? 'is-4k' : ''}`}>
            {qualityTag}
          </div>
        )}

        {/* Wide Card top-right translucent action circle */}
        {isWide && (
          <div className="wide-top-circle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
              <circle cx="5" cy="12" r="1.5" />
            </svg>
          </div>
        )}

        {/* Bottom Vignette with Title & Metadata */}
        {isWide ? (
          <div className="poster-bottom-vignette wide-vignette">
            <div className="wide-vignette-title">{item.title || 'Sin título'}</div>
            <div className="wide-vignette-sub">
              <span className="wide-tv-badge">tv</span>
              <span className="wide-sub-text">{wideSubtitle}</span>
            </div>
            <div className="wide-vignette-tagline">{wideTagline}</div>
          </div>
        ) : (
          <div className="poster-bottom-vignette">
            <div className="poster-vignette-title">{item.title || 'Sin título'}</div>
            <div className="poster-vignette-genre">{metaSubtitle}</div>
          </div>
        )}

        {/* Watch Progress Bar */}
        {watchProgress > 0 && (
          <div className="poster-progress-track">
            <div
              className="poster-progress-fill"
              style={{ width: `${watchProgress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export const PosterCard = React.memo<PosterCardProps>(
  PosterCardComponent,
  (prev, next) => {
    return (
      prev.isFocused === next.isFocused &&
      prev.item.id === next.item.id &&
      prev.rank === next.rank &&
      prev.isWide === next.isWide &&
      prev.showImage === next.showImage
    );
  }
);
