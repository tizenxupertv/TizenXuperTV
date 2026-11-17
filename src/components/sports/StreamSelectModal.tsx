import React, { useEffect, useRef, useState } from 'react';
import type { SportsEvent, SportsStream } from '../../types/sports.ts';
import { MatchHeader } from './MatchHeader.tsx';
import '../../styles/streamSelectModal.css';

export interface StreamSelectModalProps {
  event: SportsEvent;
  streams: SportsStream[];
  loading?: boolean;
  error?: string | null;
  errorTitle?: string;
  hint?: string;
  currentStreamIdx?: number;
  failedStreams?: Set<number>;
  initialFocus?: number;
  onSelectStream: (index: number) => void;
  onOpenDetails?: () => void;
  onClose: () => void;
}

export const StreamSelectModal: React.FC<StreamSelectModalProps> = ({
  event,
  streams,
  loading = false,
  error = null,
  errorTitle,
  hint,
  currentStreamIdx,
  failedStreams,
  initialFocus = 0,
  onSelectStream,
  onOpenDetails,
  onClose
}) => {
  const [focusIdx, setFocusIdx] = useState<number>(initialFocus);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFocusIdx(initialFocus);
  }, [initialFocus]);

  // Keep focused stream inside visible area
  useEffect(() => {
    if (containerRef.current) {
      const el = containerRef.current.querySelector('.is-focused') as HTMLElement | null;
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusIdx, streams]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const k = e.key;
      const isBack = k === 'Escape' || k === 'Backspace' || k === 'Back' || k === 'Return' || (e as any).keyCode === 10009 || (e as any).keyCode === 461;
      if (isBack) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }

      const N = streams.length;
      const hasDetails = Boolean(onOpenDetails);
      const detailsIdx = N;

      if (N === 1) {
        if (k === 'ArrowDown') {
          e.preventDefault();
          if (focusIdx === 0 && hasDetails) setFocusIdx(detailsIdx);
        } else if (k === 'ArrowUp') {
          e.preventDefault();
          if (focusIdx === detailsIdx) setFocusIdx(0);
        } else if (k === 'Enter') {
          e.preventDefault();
          if (focusIdx === 0 && streams[0]) onSelectStream(0);
          else if (focusIdx === detailsIdx && onOpenDetails) onOpenDetails();
        }
        return;
      }

      if (k === 'ArrowLeft') {
        e.preventDefault();
        if (focusIdx < N && focusIdx % 2 === 1) {
          setFocusIdx(i => i - 1);
        }
      } else if (k === 'ArrowRight') {
        e.preventDefault();
        if (focusIdx < N && focusIdx % 2 === 0 && focusIdx + 1 < N) {
          setFocusIdx(i => i + 1);
        }
      } else if (k === 'ArrowUp') {
        e.preventDefault();
        if (focusIdx === detailsIdx) {
          if (N > 0) setFocusIdx(N - 1);
        } else if (focusIdx >= 2) {
          setFocusIdx(i => i - 2);
        }
      } else if (k === 'ArrowDown') {
        e.preventDefault();
        if (focusIdx < N) {
          if (focusIdx + 2 < N) {
            setFocusIdx(i => i + 2);
          } else if (hasDetails) {
            setFocusIdx(detailsIdx);
          }
        }
      } else if (k === 'Enter') {
        e.preventDefault();
        if (focusIdx < N && streams[focusIdx]) {
          onSelectStream(focusIdx);
        } else if (focusIdx === detailsIdx && onOpenDetails) {
          onOpenDetails();
        }
      }
    };

    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [streams, focusIdx, onSelectStream, onOpenDetails, onClose]);

  const hasDetails = Boolean(onOpenDetails);
  const isSingle = streams.length === 1;

  return (
    <div className="ssm-backdrop">
      <div className={`ssm-card ${isSingle ? 'is-single' : ''}`}>
        <MatchHeader event={event} />

        {error && (
          <>
            <div className="ssm-error-msg">{errorTitle || 'Esta señal no está disponible'}</div>
            <div className="ssm-error-detail">Transmisión deportiva · {error}</div>
          </>
        )}

        {hint && <div className="ssm-hint">{hint}</div>}

        {loading ? (
          <div className="ssm-status">
            <div className="spp-wave" aria-hidden="true"><span /><span /><span /><span /></div>
            Buscando señales…
          </div>
        ) : streams.length === 0 ? (
          <div className="ssm-status">
            Este evento no tiene señales que se puedan ver en la app por ahora.
          </div>
        ) : (
          <div className={`ssm-grid ${isSingle ? 'is-single' : ''}`} ref={containerRef}>
            {streams.map((st, i) => {
              const isFocused = i === focusIdx;
              const isPlaying = currentStreamIdx !== undefined && i === currentStreamIdx && !error;
              const isFailed = failedStreams?.has(i);

              return (
                <div
                  key={i}
                  className={`ssm-item ${isFocused ? 'is-focused' : ''} ${isPlaying ? 'is-playing' : ''} ${isFailed ? 'is-failed' : ''}`}
                  onClick={() => onSelectStream(i)}
                >
                  <span className="ssm-item-name">{st.name}</span>
                  {isPlaying && <span className="ssm-item-tag">Viendo</span>}
                  {isFailed && !isPlaying && <span className="ssm-item-tag is-failed">No disponible</span>}
                  {!isPlaying && !isFailed && <span className="ssm-item-play">Ver ▶</span>}
                </div>
              );
            })}

            {hasDetails && (
              <div
                className={`ssm-item ssm-details-btn ${focusIdx === streams.length ? 'is-focused' : ''}`}
                onClick={onOpenDetails}
              >
                <span className="ssm-item-name">Alineaciones y Estadísticas</span>
                <span className="ssm-item-play">Ver ›</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
