import React from 'react';
import { HistoryItem } from '../../types/history';
import { formatRemaining } from '../../lib/vodResume';

interface ContinueWatchingOptionsModalProps {
  item: HistoryItem;
  focusIndex: number;
  onSelectIndex: (idx: number) => void;
  onRemove: () => void;
  onDetails: () => void;
  onClose: () => void;
}

export const ContinueWatchingOptionsModal: React.FC<ContinueWatchingOptionsModalProps> = ({
  item,
  focusIndex,
  onSelectIndex,
  onRemove,
  onDetails,
  onClose
}) => {
  const posterUrl = item.poster || 'assets/placeholder_landscape.png';
  const pct = item.duration > 0
    ? Math.min(100, Math.max(5, Math.round((item.position / item.duration) * 100)))
    : 45;

  const remainingText = item.duration > item.position
    ? formatRemaining(item.position, item.duration)
    : '';

  const badgeText = item.series && item.episodeNumber
    ? `T1:E${item.episodeNumber}`
    : 'Película';

  return (
    <div className="pf-confirm cw-options-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="pf-confirm-card cw-options-card" onClick={e => e.stopPropagation()}>
        <div className="cw-options-header">
          <img className="cw-options-thumb" src={posterUrl} alt="" />
          <div className="cw-options-info">
            <h2 className="cw-options-title">{item.title || 'Contenido'}</h2>
            <div className="cw-options-meta">
              <span>{badgeText}</span>
              {remainingText && (
                <>
                  <span className="cw-options-dot">·</span>
                  <span>{remainingText}</span>
                </>
              )}
            </div>
            <div className="cw-options-progress-track">
              <div className="cw-options-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        <div className="cw-options-actions">
          <button
            type="button"
            className={`cw-options-btn ${focusIndex === 0 ? 'is-focused' : ''}`}
            onClick={onRemove}
            onMouseEnter={() => onSelectIndex(0)}
          >
            Quitar de Seguir viendo
          </button>

          <button
            type="button"
            className={`cw-options-btn ${focusIndex === 1 ? 'is-focused' : ''}`}
            onClick={onDetails}
            onMouseEnter={() => onSelectIndex(1)}
          >
            Ver detalles
          </button>

          <button
            type="button"
            className={`cw-options-btn ${focusIndex === 2 ? 'is-focused' : ''}`}
            onClick={onClose}
            onMouseEnter={() => onSelectIndex(2)}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};
