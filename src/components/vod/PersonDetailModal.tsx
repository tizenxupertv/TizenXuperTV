import React, { useEffect, useState, useRef } from 'react';
import type { PersonDetail, VodItem } from '../../types/vod';
import { getPersonWorks } from '../../services/catalogService';
import { useScreenKeys } from '../../hooks/useScreenKeys';
import { PosterCard } from './PosterCard';
import '../../styles/personModal.css';

interface PersonDetailModalProps {
  person: PersonDetail;
  onClose: () => void;
  onSelectItem: (item: VodItem) => void;
}

export const PersonDetailModal: React.FC<PersonDetailModalProps> = ({
  person,
  onClose,
  onSelectItem
}) => {
  const [works, setWorks] = useState<VodItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const sliderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getPersonWorks(person.puId, 1, 30, person.name)
      .then(res => {
        if (!alive) return;
        setWorks(res.items);
        setLoading(false);
      })
      .catch(err => {
        if (!alive) return;
        console.warn('[PersonDetailModal] error loading works:', err);
        setError('No se pudo cargar la filmografía.');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [person.puId, person.name]);

  useEffect(() => {
    if (!sliderRef.current || works.length === 0) return;
    const cardWidth = 194; // 176px poster width + 18px gap
    sliderRef.current.scrollTo({
      left: Math.max(0, (focusIndex - 1) * cardWidth),
      behavior: 'smooth'
    });
  }, [focusIndex, works.length]);

  useScreenKeys(key => {
    if (key === 'back') {
      onClose();
      return;
    }
    if (works.length > 0) {
      if (key === 'left') {
        setFocusIndex(i => Math.max(0, i - 1));
      } else if (key === 'right') {
        setFocusIndex(i => Math.min(works.length - 1, i + 1));
      } else if (key === 'enter') {
        const selected = works[focusIndex];
        if (selected) {
          onClose();
          onSelectItem(selected);
        }
      }
    }
  });

  return (
    <div className="person-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="person-modal-card" onClick={e => e.stopPropagation()}>
        <button
          type="button"
          className="person-modal-close-btn"
          onClick={onClose}
          aria-label="Cerrar"
        >
          ✕
        </button>
        <div className="person-modal-header">
          <div className="person-avatar-wrap">
            {person.icon ? (
              <img
                src={person.icon}
                alt={person.name}
                className="person-avatar-img"
                onError={e => {
                  (e.target as HTMLElement).style.display = 'none';
                  const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              className="person-avatar-fallback"
              style={{ display: person.icon ? 'none' : 'flex' }}
            >
              {person.name.charAt(0).toUpperCase()}
            </div>
          </div>
          <div className="person-info-wrap">
            <h2 className="person-name">{person.name}</h2>
            <div className="person-meta-row">
              {person.personType === 1 ? (
                <span className="person-role-tag">Director</span>
              ) : (
                <span className="person-role-tag">Actor / Reparto</span>
              )}
              {person.birthPlace && (
                <span className="person-meta-item">📍 {person.birthPlace}</span>
              )}
              {person.birthTime && (
                <span className="person-meta-item">🎂 {person.birthTime}</span>
              )}
            </div>
            {person.awards && (
              <div className="person-awards">🏆 {person.awards}</div>
            )}
            {person.introduction && (
              <p className="person-bio">{person.introduction}</p>
            )}
          </div>
        </div>

        <div className="person-works-section">
          <h3 className="person-works-title">
            Obras y Filmografía {works.length > 0 && `(${works.length})`}
          </h3>

          {loading && (
            <div className="person-works-slider" style={{ overflow: 'hidden' }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="poster-card apple-poster-card is-skeleton">
                  <div className="poster-card-img">
                    <div className="poster-bottom-vignette">
                      <div className="skeleton-line skeleton-title-line" style={{ width: '75%', height: 13, background: 'rgba(255,255,255,0.08)' }} />
                      <div className="skeleton-line skeleton-meta-line" style={{ width: '40%', height: 10, background: 'rgba(255,255,255,0.05)' }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <div className="person-error-text">{error}</div>}

          {!loading && !error && works.length === 0 && (
            <div className="person-empty-text">No hay otros títulos disponibles de este artista.</div>
          )}

          {!loading && works.length > 0 && (
            <div className="person-works-slider" ref={sliderRef}>
              {works.map((item, idx) => (
                <PosterCard
                  key={item.id || idx}
                  item={item}
                  isFocused={idx === focusIndex}
                  onActivate={selected => {
                    onClose();
                    onSelectItem(selected);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="person-modal-hint">
          Usa{' '}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: 'middle', margin: '0 2px' }}>
            <path d="M16 4l-10 8 10 8V4z" />
          </svg>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: 'middle', margin: '0 2px' }}>
            <path d="M8 4l10 8-10 8V4z" />
          </svg>{' '}
          para navegar por las obras, [OK] para abrir detalles, o [Atrás] para cerrar
        </div>
      </div>
    </div>
  );
};

