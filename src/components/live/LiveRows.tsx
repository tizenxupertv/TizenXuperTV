import React from 'react';
import { LiveChannel, LiveCategory } from '../../types/channel';

interface ChannelRowProps {
  ch: LiveChannel;
  idx: number;
  focused: boolean;
  tuned: boolean;
  fav: boolean;
  onTune: (ch: LiveChannel) => void;
  onFullscreen: (ch: LiveChannel) => void;
}

/** One channel of the live list. Memoized: a key press only re-renders the rows whose state changed */
export const ChannelRow = React.memo<ChannelRowProps>(({ ch, idx, focused, tuned, fav, onTune, onFullscreen }) => {
  const initials = String(ch.name || 'TV').trim().slice(0, 2).toUpperCase();
  const subtitle = ch.now || (/espn/i.test(ch.name) ? 'Señal experimental · Beta' : undefined);
  return (
    <div
      className={`live-channel-card ${focused ? 'is-focused' : ''} ${tuned ? 'is-active-channel' : ''}`}
      onClick={() => (tuned ? onFullscreen(ch) : onTune(ch))}
    >
      <div className="live-ch-num">{idx + 1 < 10 ? `0${idx + 1}` : idx + 1}</div>
      {ch.logo ? (
        <img
          className="live-ch-logo"
          src={ch.logo}
          alt={ch.name}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
            const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
            if (fallback) fallback.style.display = 'flex';
          }}
        />
      ) : null}
      <div className="live-ch-avatar" style={{ display: ch.logo ? 'none' : 'flex' }}>
        {initials}
      </div>
      <div className="live-ch-info">
        <div className="live-ch-title">
          <span className="live-ch-name">{ch.name}</span>
          {tuned && <span className="live-playing-badge">▶ EN VIVO</span>}
          {fav && <span className="live-fav-icon">★</span>}
        </div>
        {subtitle && <div className="live-ch-now">{subtitle}</div>}
      </div>
    </div>
  );
});

interface CategoryRowProps {
  cat: LiveCategory;
  idx: number;
  active: boolean;
  cursor: boolean;
  onSelect?: (idx: number) => void;
}

/** One category of the live list (memoized like ChannelRow) */
export const CategoryRow = React.memo<CategoryRowProps>(({ cat, idx, active, cursor, onSelect }) => (
  <div
    className={`live-cat-vrow ${active ? 'is-active-cat' : ''} ${cursor ? 'is-focused' : ''}`}
    onClick={() => onSelect && onSelect(idx)}
  >
    <span className="live-cat-vname">{cat.name}</span>
    {cat.badge && <span className="beta-pill live-cat-badge">{cat.badge}</span>}
  </div>
));
