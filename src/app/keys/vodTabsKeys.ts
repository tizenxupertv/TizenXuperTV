import { TvKey } from '../../hooks/useTvRemote';
import { favoritesService } from '../../services/favoritesService';
import { DestacadosFocus, ContentRowDef } from '../../views/DestacadosView';
import { VodItem } from '../../types/vod';
import { HistoryItem } from '../../types/history';
import { Setter } from '../types';
import { rowHasSeeAll } from '../tabRows';

export interface VodTabsKeysCtx {
  activeHeroIndex: number;
  setActiveHeroIndex: Setter<number>;
  destacadosFocus: DestacadosFocus;
  setDestacadosFocus: Setter<DestacadosFocus>;
  handleOpenDetail: (item: VodItem) => void;
  currentHeroItems: VodItem[];
  currentRows: ContentRowDef[];
  totalRows: number;
  getRowItemCount: (rowIdx: number) => number;
  returnToHeader: () => void;
  findVod: (item: HistoryItem) => VodItem;
  openSeeAll: (row: ContentRowDef) => void;
}

export function handleVodTabsKeys(key: TvKey, ctx: VodTabsKeysCtx): boolean {
  const {
    activeHeroIndex,
    setActiveHeroIndex,
    destacadosFocus,
    setDestacadosFocus,
    handleOpenDetail,
    currentHeroItems,
    currentRows,
    totalRows,
    getRowItemCount,
    returnToHeader,
    findVod,
    openSeeAll
  } = ctx;
  if (destacadosFocus.area === 'hero') {
    const heroCount = currentHeroItems.length || 1;

    if (key === 'left') {
      if (destacadosFocus.heroBtn === 'fav') {
        // Move back from [+] button to [▶ Reproducir]
        setDestacadosFocus(prev => ({ ...prev, heroBtn: 'play' }));
      } else {
        // When on play, cycle to previous slide
        setActiveHeroIndex(prev => (prev - 1 + heroCount) % heroCount);
      }
      return true;
    }

    if (key === 'right') {
      if (destacadosFocus.heroBtn === 'play') {
        // Move from [▶ Reproducir] to [+] button
        setDestacadosFocus(prev => ({ ...prev, heroBtn: 'fav' }));
      } else {
        // When on [+], advance to next slide and return cursor to play
        setActiveHeroIndex(prev => (prev + 1) % heroCount);
        setDestacadosFocus(prev => ({ ...prev, heroBtn: 'play' }));
      }
      return true;
    }

    if (key === 'up') {
      returnToHeader();
      return true;
    }

    if (key === 'down') {
      if (totalRows > 0) {
        setDestacadosFocus({
          area: 'row',
          rowIndex: 0,
          cardIndex: 0
        });
      }
      return true;
    }

    if (key === 'enter') {
      const item = currentHeroItems[activeHeroIndex] || currentHeroItems[0];
      if (item) {
        if (destacadosFocus.heroBtn === 'play') {
          handleOpenDetail(item);
        } else {
          favoritesService.toggleFavorite(item.id, item);
        }
      }
      return true;
    }
  }

  if (destacadosFocus.area === 'row') {
    const curRow = destacadosFocus.rowIndex;
    const curCol = destacadosFocus.cardIndex;
    const count = getRowItemCount(curRow);

    if (key === 'left') {
      if (curCol > 0) {
        setDestacadosFocus(prev => ({ ...prev, cardIndex: curCol - 1 }));
      }
      return true;
    }
    if (key === 'right') {
      if (curCol < count - 1) {
        setDestacadosFocus(prev => ({ ...prev, cardIndex: curCol + 1 }));
      }
      return true;
    }
    if (key === 'up') {
      if (curRow === 0) {
        setDestacadosFocus({ area: 'hero', heroBtn: 'play', rowIndex: 0, cardIndex: 0 });
        return true;
      }
      const prevRowCount = getRowItemCount(curRow - 1);
      setDestacadosFocus({
        area: 'row',
        rowIndex: curRow - 1,
        cardIndex: Math.min(curCol, Math.max(0, prevRowCount - 1))
      });
      return true;
    }
    if (key === 'down') {
      if (curRow < totalRows - 1) {
        const nextRowCount = getRowItemCount(curRow + 1);
        setDestacadosFocus({
          area: 'row',
          rowIndex: curRow + 1,
          cardIndex: Math.min(curCol, Math.max(0, nextRowCount - 1))
        });
      }
      return true;
    }
    if (key === 'enter') {
      const rowDef = currentRows[curRow];
      if (rowDef) {
        const item = rowDef.items[curCol];
        if (!item && curCol === rowDef.items.length && rowHasSeeAll(rowDef)) {
          openSeeAll(rowDef);
        } else if (item) {
          if (rowDef.type === 'history') {
            const hist = item as HistoryItem;
            const vod = findVod(hist);
            handleOpenDetail(vod);
          } else {
            handleOpenDetail(item as VodItem);
          }
        }
      }
      return true;
    }
  }

  return true;
}
