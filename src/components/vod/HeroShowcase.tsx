import React from 'react';
import { VodItem } from '../../types/vod';

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
  if (!item) return null;

  const rawBg = item.backdrop || item.landscape || item.poster || 'assets/placeholder_landscape.png';
  const bgUrl = import.meta.env.DEV && /^https?:/.test(rawBg)
    ? `${location.origin}/stream-proxy?url=${encodeURIComponent(rawBg)}`
    : rawBg;
  const genres = item.genres && item.genres.length ? item.genres.slice(0, 3).join(' · ') : 'Película · Acción · Aventura';
  const year = item.year && item.year !== '—' ? item.year : '2024';
  const ratingBadge = 'Sin Calificación';
  const synopsis = item.synopsis || 'La realidad no es lo que parece cuando se enfrenta a los alucinantes poderes de fuerzas desconocidas.';

  return (
    <div className={`home-showcase apple-showcase ${isDimmed ? 'is-dimmed' : ''}`}>
      <div
        className="showcase-bg"
        style={{ backgroundImage: `url('${bgUrl}')` }}
      />
      <div className="showcase-gradient" />

      <div className="showcase-content">
        <div className="hero-kicker">
          <span className="badge-tag brand-pill">XUPER ORIGINAL</span>
          <span className="hero-kicker-tag">{item.isSeries ? 'SERIE DESTACADA' : 'ESTRENO EXCLUSIVO'}</span>
        </div>

        <h1 className="showcase-title">{item.title || 'Sin título'}</h1>

        <div className="showcase-meta apple-meta">
          <span className="badge-tag brand-pill">4K HDR</span>
          <span>{genres}</span>
          <span className="badge-tag">{ratingBadge}</span>
          {year && <span>{year}</span>}
        </div>

        <p className="showcase-synopsis">{synopsis}</p>

        <div className="showcase-actions">
          <button
            className={`showcase-btn play-btn-apple ${focusedButton === 'play' ? 'is-focused' : ''}`}
            onClick={() => onPlay(item)}
          >
            <span className="play-triangle">▶</span> Reproducir
          </button>

          <button
            className={`showcase-btn icon-btn-apple ${focusedButton === 'fav' ? 'is-focused' : ''} ${isFavorite ? 'is-fav' : ''}`}
            onClick={() => onToggleFav(item)}
            title={isFavorite ? 'En Mi Lista' : 'Añadir a Mi Lista'}
          >
            {isFavorite ? '✓' : '＋'}
          </button>
        </div>
      </div>

      {/* Centered carousel dots at bottom */}
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
