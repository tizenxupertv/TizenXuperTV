import React, { useRef, useEffect, useState, useLayoutEffect } from 'react';
import { VodItem } from '../../types/vod';
import { PosterCard } from './PosterCard';
import { scrollHorizontalSlider } from '../../utils/scrollHelper';
import { preloadCardNeighbors } from '../../lib/imageCache';
import { isOlderTv } from '../../lib/tvMemory';

/** Older TVs: no decoding ahead (the cards it would cover are already mounted) */
const OLDER_TV = isOlderTv();

interface ContentSliderProps {
  title: string;
  subtitle?: string;
  items: VodItem[];
  isRanked?: boolean;
  isWide?: boolean;
  focusedIndex: number | null; // index if this row is focused, null if not
  /** The row is on screen or next to it: its first cards load their images */
  nearFocus: boolean;
  /** The row is far from the focus on a TV short of memory: it lets go of its images until it is near again */
  releaseImages?: boolean;
  onActivate: (item: VodItem) => void;
  /** Adds a last "Ver todo" card (focus index = items.length) */
  onSeeAll?: () => void;
}

const ContentSliderComponent: React.FC<ContentSliderProps> = ({
  title,
  subtitle,
  items,
  isRanked,
  isWide,
  focusedIndex,
  nearFocus,
  releaseImages,
  onActivate,
  onSeeAll
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  // Images load only for the cards on screen plus a few ahead, and stay once loaded (portal images are full size
  // and decoding all of them at once stalls the TV), except on a TV short of memory, where a row far from the focus
  // gives them back
  const ahead = isWide ? 4 : 7;
  const [loadCount, setLoadCount] = useState(nearFocus || focusedIndex !== null ? ahead : 0);
  useEffect(() => {
    if (releaseImages) {
      setLoadCount(0);
      return;
    }
    if (!nearFocus && focusedIndex === null) {
      return;
    }
    const wanted = (focusedIndex || 0) + ahead;
    setLoadCount(c => (wanted > c ? wanted : c));
  }, [nearFocus, focusedIndex, ahead, releaseImages]);

  useLayoutEffect(() => {
    if (focusedIndex !== null && sliderRef.current) {
      const target = sliderRef.current.children[focusedIndex] as HTMLElement;
      scrollHorizontalSlider(sliderRef.current, target, focusedIndex, 48, 160);
    }
  }, [focusedIndex]);

  // Decoupled predictive preloading: runs after frame paint to keep D-pad navigation instant
  useEffect(() => {
    if (focusedIndex !== null && !OLDER_TV) {
      const t = setTimeout(() => {
        preloadCardNeighbors(items, focusedIndex, isWide ? 3 : 5, isWide);
      }, 50);
      return () => clearTimeout(t);
    }
  }, [focusedIndex, items, isWide]);

  if (!items || !items.length) return null;

  return (
    <div className="content-section">
      <div className="section-header">
        <div className="section-title">
          {title} {!isWide && <span className="section-chevron">›</span>}
        </div>
        {subtitle && <div className="section-sub">{subtitle}</div>}
      </div>
      <div className={`content-slider ${isWide ? 'is-wide-slider' : ''}`} ref={sliderRef}>
        {items.map((item, idx) => (
          <PosterCard
            key={item.id || idx}
            item={item}
            rank={isRanked ? idx + 1 : undefined}
            isWide={isWide}
            isFocused={focusedIndex === idx}
            showImage={idx < loadCount}
            onActivate={onActivate}
          />
        ))}
        {onSeeAll && (
          <div
            className={`see-all-card ${isWide ? 'is-wide-card' : ''} ${focusedIndex === items.length ? 'is-focused' : ''}`}
            onClick={onSeeAll}
          >
            <span className="see-all-icon">›</span>
            <span className="see-all-label">Ver todo</span>
          </div>
        )}
      </div>
    </div>
  );
};

export const ContentSlider = React.memo<ContentSliderProps>(
  ContentSliderComponent,
  (prev, next) => {
    if (prev.focusedIndex !== next.focusedIndex) return false;
    if (prev.title !== next.title) return false;
    if (prev.subtitle !== next.subtitle) return false;
    if (prev.items !== next.items) return false;
    if (prev.isRanked !== next.isRanked) return false;
    if (prev.isWide !== next.isWide) return false;
    if (prev.nearFocus !== next.nearFocus) return false;
    if (!!prev.releaseImages !== !!next.releaseImages) return false;
    if (!!prev.onSeeAll !== !!next.onSeeAll) return false;
    return true;
  }
);
