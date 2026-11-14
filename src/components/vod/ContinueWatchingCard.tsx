import React, { useState, useEffect } from 'react';
import { HistoryItem } from '../../types/history';
import { isImagePrecached, markImageLoaded, markImageFailed } from '../../lib/imageCache';
import { useCardImage } from '../../lib/useCardImage';

interface ContinueWatchingCardProps {
  item: HistoryItem;
  isFocused: boolean;
  onActivate: (item: HistoryItem) => void;
  onOptions?: (item: HistoryItem) => void;
}

const ContinueWatchingCardComponent: React.FC<ContinueWatchingCardProps> = ({
  item,
  isFocused,
  onActivate,
  onOptions
}) => {
  const posterUrl = item.poster || 'assets/placeholder_landscape.png';
  const cardSrc = useCardImage(posterUrl, 392, 221);

  const isCached = !!cardSrc && isImagePrecached(cardSrc);
  const [imgLoaded, setImgLoaded] = useState(isCached);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
    setImgLoaded(!!cardSrc && isImagePrecached(cardSrc));
  }, [cardSrc]);

  const handleImgLoad = () => {
    if (cardSrc) markImageLoaded(cardSrc);
    setImgLoaded(true);
  };

  const handleImgError = () => {
    if (cardSrc) markImageFailed(cardSrc);
    setImgLoaded(false);
    setImgFailed(true);
  };

  const pct = item.duration > 0
    ? Math.min(100, Math.max(5, Math.round((item.position / item.duration) * 100)))
    : 45;

  const remainingMin = item.duration > item.position
    ? Math.max(1, Math.round((item.duration - item.position) / 60))
    : 38;

  const episodeBadge = item.series && item.episodeNumber
    ? `T1:E${item.episodeNumber}`
    : 'Continuar';

  const infoText = `${episodeBadge} · ${remainingMin} min restantes`;

  return (
    <div
      className={`cw-card apple-cw-card ${isFocused ? 'is-focused' : ''}`}
      onClick={() => onActivate(item)}
    >
      <div className="cw-card-img">
        <img
          className="poster-card-placeholder-img"
          src="assets/placeholder_landscape.png"
          alt=""
          loading="eager"
        />
        {cardSrc && !imgFailed && (
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
        <div className="poster-brand-badge">
          <span>tv</span>
        </div>
        <div className="cw-bottom-gradient">
          <div className="cw-title-row">{item.title || 'Contenido'}</div>
          <div className="cw-footer-row">
            <div className="cw-footer-left">
              <span className="cw-mini-play">▶</span>
              <span className="cw-info-text">{infoText}</span>
            </div>
            <div
              className="cw-more-dots"
              onClick={(e) => {
                e.stopPropagation();
                if (onOptions) onOptions(item);
              }}
              title="Opciones"
            >
              ···
            </div>
          </div>
          <div className="cw-progress-track">
            <div className="cw-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
};

export const ContinueWatchingCard = React.memo<ContinueWatchingCardProps>(
  ContinueWatchingCardComponent,
  (prev, next) => {
    return (
      prev.isFocused === next.isFocused &&
      prev.item.id === next.item.id &&
      prev.item.position === next.item.position &&
      prev.item.duration === next.item.duration
    );
  }
);
