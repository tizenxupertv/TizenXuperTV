import React, { useRef, useLayoutEffect } from 'react';
import { HistoryItem } from '../../types/history';
import { ContinueWatchingCard } from './ContinueWatchingCard';
import { scrollHorizontalSlider } from '../../utils/scrollHelper';
import { preloadCardNeighbors } from '../../lib/imageCache';
import { isOlderTv } from '../../lib/tvMemory';

/** Older TVs: no decoding ahead (every card of this row is already mounted) */
const OLDER_TV = isOlderTv();

interface ContinueWatchingRowProps {
  items: HistoryItem[];
  focusedIndex: number | null;
  onActivate: (item: HistoryItem) => void;
  onOptions?: (item: HistoryItem) => void;
}

const ContinueWatchingRowComponent: React.FC<ContinueWatchingRowProps> = ({
  items,
  focusedIndex,
  onActivate,
  onOptions
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (focusedIndex !== null && sliderRef.current) {
      const target = sliderRef.current.children[focusedIndex] as HTMLElement;
      scrollHorizontalSlider(sliderRef.current, target, focusedIndex, 48, 160);
      if (!OLDER_TV) preloadCardNeighbors(items, focusedIndex, 3, false);
    }
  }, [focusedIndex, items]);

  if (!items || !items.length) return null;

  return (
    <div className="content-section continue-watching-section">
      <div className="section-header">
        <div className="section-title">
          Seguir viendo <span className="section-chevron">›</span>
        </div>
        {focusedIndex !== null && (
          <div className="cw-section-hint">
            Mantén OK para opciones
          </div>
        )}
      </div>
      <div className="content-slider" ref={sliderRef}>
        {items.map((item, idx) => (
          <ContinueWatchingCard
            key={item.id || idx}
            item={item}
            isFocused={focusedIndex === idx}
            onActivate={onActivate}
            onOptions={onOptions}
          />
        ))}
      </div>
    </div>
  );
};

export const ContinueWatchingRow = React.memo<ContinueWatchingRowProps>(
  ContinueWatchingRowComponent,
  (prev, next) => {
    return prev.focusedIndex === next.focusedIndex && prev.items === next.items;
  }
);
