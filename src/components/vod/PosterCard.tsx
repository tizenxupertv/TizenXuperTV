import React, { useRef, useEffect, useState } from 'react';
import { VodItem } from '../../types/vod';
import { useCardImage, isImagePrecached, markImageLoaded } from '../../lib/imageCache';
import { startImageTracking } from '../../lib/perfMonitor';

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
  const posterUrl = isWide
    ? (item.landscape || item.backdrop || item.poster || 'assets/placeholder_landscape.png')
    : (item.poster || item.landscape || item.backdrop || 'assets/placeholder_vertical.png');

  // Card-size copy of the portal image; the placeholder shows under it until it is ready
  const placeholder = isWide ? 'assets/placeholder_landscape.png' : 'assets/placeholder_vertical.png';
  const cardSrc = useCardImage(posterUrl, isWide ? 484 : 230, isWide ? 340 : 340, showImage);

  const isCached = !!cardSrc && isImagePrecached(cardSrc);
  const [imgLoaded, setImgLoaded] = useState(isCached);

  useEffect(() => {
    if (cardSrc && isImagePrecached(cardSrc)) {
      setImgLoaded(true);
    }
  }, [cardSrc]);

  const trackingRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (showImage && cardSrc && !trackingRef.current) {
      trackingRef.current = startImageTracking();
    }
  }, [showImage, cardSrc]);

  const handleImgDone = () => {
    if (cardSrc) markImageLoaded(cardSrc);
    setImgLoaded(true);
    if (trackingRef.current) {
      trackingRef.current();
      trackingRef.current = null;
    }
  };

  const categoryName = item.isSeries ? 'Programa de TV' : 'Película';
  // Only what the catalog knows: score, year, genres, category
  const genresStr = item.genres && item.genres.length ? item.genres.slice(0, 2).join(' · ') : (item.category || '');
  const wideSubtitle = [categoryName, genresStr].filter(Boolean).join(' · ');
  const knownScore = item.score && item.score !== '0' ? item.score : '';
  const knownYear = item.year && item.year !== '—' ? item.year : '';
  const wideTagline = [knownScore && `★ ${knownScore}`, knownYear].filter(Boolean).join(' · ');

  const metaSubtitle = [knownScore && `★ ${knownScore}`, knownYear].filter(Boolean).join(' · ')
    || (item.genres && item.genres[0]) || (item.category ? item.category.toUpperCase() : '');

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
        {showImage && cardSrc && (
          <img
            className={`poster-card-img-element ${imgLoaded ? 'is-loaded' : ''}`}
            src={cardSrc}
            decoding="async"
            loading="lazy"
            onLoad={handleImgDone}
            onError={handleImgDone}
            alt=""
          />
        )}
        {/* Top 10 Rank Number in clean Apple TV typography */}
        {rank !== undefined && rank > 0 && !isWide && (
          <div className="poster-rank-badge">{rank}</div>
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
