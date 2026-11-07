import React, { useState, useEffect, useRef, useMemo } from 'react';
import { VodItem, VodEpisode, VodSeason } from '../types/vod';
import { catalogService } from '../services/catalogService';
import { PosterCard } from '../components/vod/PosterCard';
import { scrollHorizontalSlider } from '../utils/scrollHelper';
import { historyService } from '../services/historyService';
import { favoritesService } from '../services/favoritesService';
import { ScreenHeader, BackIcon } from '../components/layout/Header';
import { settingsService, PREFERRED_LANGUAGES, SUBTITLE_CHOICES, subtitleChoiceIndex, QUALITY_OPTIONS } from '../services/settingsService';
import { effectiveChoice, ownAudioName, titleChoices, type LanguageRules, type TitleChoices, type TitleMedia } from '../lib/titleOptions';
import { PREF_LANG_CODES, languageName, sameLanguage } from '../lib/subtitles';
import { getResumeTarget, getEpisodeStatus, EpisodeStatus } from '../lib/vodResume';
import { useViewProfiler } from '../lib/perfMonitor';

export type SettingsCol = 'menu' | 'audio' | 'subs' | 'quality';

export type DetailFocusArea = 'back' | 'actions' | 'quick' | 'seasons' | 'seasonMenu' | 'epRanges' | 'episodes' | 'related' | 'audioModal';

export interface VodDetailFocus {
  area: DetailFocusArea;
  actionIndex: number;
  seasonIndex: number;
  episodeIndex: number;
  relatedIndex: number;
  /** Small buttons under the big ones: Mi lista, Ajustes, Tráiler */
  quickIndex?: number;
  /** Season highlighted in the open season list (the season loads only when picked) */
  seasonMenuIndex?: number;
  /** Range of 20 episodes focused in the ranges row ("1-20", "21-40"…) */
  rangeIndex?: number;
  /** Settings list: 'menu' (Audio / Subtítulos / Resolución) or the options of one of them */
  modalCol?: SettingsCol;
  modalIndex?: number;
}

const NO_EPISODES: VodEpisode[] = [];

/** Episodes per range, as the official app: long series stay light and quick to cross */
export const EP_RANGE = 20;

export const AUDIO_OPTIONS = PREFERRED_LANGUAGES;
export const SUB_OPTIONS = SUBTITLE_CHOICES;

/** Language matching of the player, for the settings list */
export const LANGUAGE_RULES: LanguageRules = {
  matches: (label, i) => sameLanguage(label, PREF_LANG_CODES[i]),
  name: languageName
};

interface VodDetailViewProps {
  item: VodItem;
  focus: VodDetailFocus;
  isFavorite: boolean;
  relatedItems?: VodItem[];
  onBack: () => void;
  onPlay: (item: VodItem, episode?: VodEpisode, isTrailer?: boolean) => void;
  onToggleFavorite: (item: VodItem) => void;
  onSelectSeason?: (seasonIndex: number) => void;
  onSelectEpisode?: (episodeIndex: number) => void;
  /** Opens the season list (mouse) */
  onOpenSeasonMenu?: () => void;
  onSelectRelated?: (item: VodItem) => void;
  onDetailLoaded?: (counts: { seasonsCount: number; episodesCount: number; relatedCount: number; isSeries: boolean; hasTrailer?: boolean; choices?: TitleChoices }) => void;
  onEpisodesChange?: (data: { episodes: VodEpisode[]; seasonId: string; seasonNumber?: number; activeEpisodeIndex?: number }) => void;
  /** Opens the settings list: its first level ('menu') or the options of one setting */
  onOpenAudioModal?: (col: SettingsCol) => void;
  /** Picks option `index` of a setting (mouse) */
  onSelectSetting?: (col: 'audio' | 'subs' | 'quality', index: number) => void;
  onCloseAudioModal?: () => void;
  onSelectAudioOption?: (audio: string) => void;
  onSelectSubOption?: (sub: string) => void;
}

export const VodDetailView: React.FC<VodDetailViewProps> = ({
  item,
  focus,
  isFavorite,
  relatedItems = [],
  onBack,
  onPlay,
  onToggleFavorite,
  onSelectSeason,
  onSelectEpisode,
  onOpenSeasonMenu,
  onSelectRelated,
  onDetailLoaded,
  onEpisodesChange,
  onOpenAudioModal,
  onCloseAudioModal,
  onSelectAudioOption,
  onSelectSubOption,
  onSelectSetting
}) => {
  useViewProfiler('Detalle VOD');
  const [detailData, setDetailData] = useState<{
    item: VodItem;
    episodes: VodEpisode[];
    seasons: VodSeason[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Episodes of a season other than the opened one (portal: every season is its own content id)
  const [seasonEps, setSeasonEps] = useState<{ seasonId: string; episodes: VodEpisode[] } | null>(null);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);
  const [isFav, setIsFav] = useState<boolean>(() => favoritesService.isFavorite(item.id));

  useEffect(() => historyService.subscribe(() => setHistoryTick(t => t + 1)), []);
  useEffect(() => {
    setIsFav(favoritesService.isFavorite(item.id));
    return favoritesService.subscribe(() => {
      setIsFav(favoritesService.isFavorite(item.id));
    });
  }, [item.id]);

  const episodesSliderRef = useRef<HTMLDivElement>(null);
  const relatedSliderRef = useRef<HTMLDivElement>(null);
  const rootScrollRef = useRef<HTMLDivElement>(null);
  const viewTokenRef = useRef<number>(0);
  const seasonTokenRef = useRef<number>(0);

  // Fetch full details (episodes, seasons, cast, synopsis)
  useEffect(() => {
    const currentToken = ++viewTokenRef.current;
    let isMounted = true;
    setIsLoading(true);
    setLoadError(false);
    setSeasonEps(null);

    catalogService.getVodDetail(item).then(data => {
      if (!isMounted || currentToken !== viewTokenRef.current) return;
      setDetailData(data);
      setIsLoading(false);
      // Open on the season from history if available, otherwise default to item season
      const hist = historyService.getEntry(item.id);
      let targetSeasonIdx = -1;
      if (hist && (hist.seasonId || hist.seasonNumber !== undefined)) {
        targetSeasonIdx = data.seasons.findIndex(s =>
          (hist.seasonId && String(s.id) === String(hist.seasonId)) ||
          (hist.seasonNumber !== undefined && s.number === hist.seasonNumber)
        );
      }
      if (targetSeasonIdx === -1) {
        targetSeasonIdx = data.seasons.findIndex(s => String(s.id) === String(item.id));
      }
      if (targetSeasonIdx > 0 && onSelectSeason) onSelectSeason(targetSeasonIdx);
    }).catch(err => {
      if (!isMounted || currentToken !== viewTokenRef.current) return;
      console.warn('[VodDetailView] Detail load failed:', err);
      setLoadError(true);
      setDetailData({
        item,
        episodes: [],
        seasons: []
      });
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      viewTokenRef.current++;
    };
  }, [item]);

  const currentItem = detailData?.item || item;
  const seasons = useMemo(() => {
    const list = detailData?.seasons || [];
    const seenNumbers = new Set<number>();
    const seenNames = new Set<string>();
    const res: VodSeason[] = [];
    for (const s of list) {
      const num = Number(s.number) || 1;
      const name = (s.name || `Temporada ${num}`).trim();
      if (!seenNumbers.has(num) && !seenNames.has(name.toLowerCase())) {
        seenNumbers.add(num);
        seenNames.add(name.toLowerCase());
        res.push(s);
      }
    }
    return res.sort((a, b) => (a.number || 1) - (b.number || 1));
  }, [detailData?.seasons]);
  // Memoized so effects below only run when the list really changes
  const episodes = useMemo<VodEpisode[]>(
    () => (seasonEps ? seasonEps.episodes : (detailData?.episodes || NO_EPISODES)),
    [seasonEps, detailData]
  );
  const currentSeasonId = seasonEps ? seasonEps.seasonId : String(item.id);
  const currentSeasonNumber = (seasons.find(s => String(s.id) === currentSeasonId) || seasons[focus.seasonIndex] || seasons[0])?.number;

  // Load the episodes of the season selected in the season pills
  useEffect(() => {
    if (!detailData || seasons.length < 2) return;
    const target = seasons[focus.seasonIndex];
    if (!target || String(target.id) === currentSeasonId) return;
    const token = ++seasonTokenRef.current;
    let alive = true;
    setSeasonLoading(true);
    catalogService.getVodDetail({ ...item, id: String(target.id) })
      .then(d => { if (alive && token === seasonTokenRef.current) setSeasonEps({ seasonId: String(target.id), episodes: d.episodes }); })
      .catch(() => { if (alive && token === seasonTokenRef.current) setSeasonEps({ seasonId: String(target.id), episodes: [] }); })
      .then(() => { if (alive && token === seasonTokenRef.current) setSeasonLoading(false); });
    return () => {
      alive = false;
      seasonTokenRef.current++;
    };
  }, [focus.seasonIndex, detailData]);

  // History and episode statuses
  const historyEntry = useMemo(() => historyService.getEntry(item.id), [item.id, historyTick]);

  const episodeStatuses = useMemo(() => {
    return episodes.map((ep, idx) => getEpisodeStatus(ep, idx, historyEntry, currentSeasonNumber));
  }, [episodes, historyEntry, currentSeasonNumber]);

  const activeEpisodeIdx = useMemo(() => {
    if (!historyEntry || episodes.length === 0) return 0;
    const currentIdx = episodeStatuses.findIndex(s => s.isCurrent);
    if (currentIdx !== -1) return currentIdx;
    const nextUnwatched = episodeStatuses.findIndex(s => !s.isWatched);
    if (nextUnwatched !== -1) return nextUnwatched;
    return 0;
  }, [episodeStatuses, historyEntry, episodes.length]);

  // Tell the parent which episodes are on screen (used by the remote: OK on an episode, Continuar)
  useEffect(() => {
    if (onEpisodesChangeRef.current) {
      onEpisodesChangeRef.current({
        episodes,
        seasonId: currentSeasonId,
        seasonNumber: currentSeasonNumber,
        activeEpisodeIndex: activeEpisodeIdx
      });
    }
  }, [episodes, currentSeasonId, currentSeasonNumber, activeEpisodeIdx]);

  // When episodes load for a season, auto-position and focus on the current episode
  const lastPositionedKeyRef = useRef<string>('');
  useEffect(() => {
    lastPositionedKeyRef.current = '';
  }, [item.id]);

  useEffect(() => {
    if (episodes.length === 0) return;
    const seasonKey = `${item.id}-${currentSeasonId}`;
    if (lastPositionedKeyRef.current !== seasonKey) {
      lastPositionedKeyRef.current = seasonKey;
      if (onSelectEpisode) {
        onSelectEpisode(activeEpisodeIdx);
      }
      if (episodesSliderRef.current && activeEpisodeIdx > 0) {
        const container = episodesSliderRef.current;
        const local = activeEpisodeIdx % EP_RANGE;
        const target = container.children[local] as HTMLElement;
        if (target) {
          scrollHorizontalSlider(container, target, local, 0, 180);
        }
      }
    }
  }, [item.id, currentSeasonId, activeEpisodeIdx, episodes.length, onSelectEpisode]);

  const resume = getResumeTarget(item, episodes, historyEntry, currentSeasonNumber, currentSeasonId);
  void historyTick;
  const isSeries = Boolean(currentItem.isSeries || currentItem.kind === 'serie' || seasons.length > 0 || episodes.length > 0);

  // What the title offers (audio languages, qualities, subtitles): the settings list shows only that. The portal answer is
  // the one the player asks for next (shared cache), so playing right after is not slower. All options while it loads.
  const playableId = isSeries ? String(resume.episode?.id || episodes[0]?.id || '') : String(item.id);
  const playableSeries = isSeries ? currentSeasonId : '';
  const [media, setMedia] = useState<TitleMedia | null>(null);
  useEffect(() => {
    setMedia(null);
    const client = (window as any).MagisClient;
    if (!playableId || !client || typeof client.mediaOptions !== 'function') return;
    let cancelled = false;
    client.mediaOptions(playableId, playableSeries, (err: any, m: TitleMedia) => {
      if (!cancelled && !err && m) setMedia(m);
    });
    return () => { cancelled = true; };
  }, [playableId, playableSeries]);
  const choices = useMemo(() => titleChoices(media, AUDIO_OPTIONS.length, QUALITY_OPTIONS, LANGUAGE_RULES), [media]);

  // Audio & subtitle preferences: the same ones as the profile (Configuración global); a preference the title
  // lacks shows what the player will really use
  const prefs = settingsService.get();
  const audioIdx = effectiveChoice(choices.audio, prefs.audio);
  const subIdx = effectiveChoice(choices.subs, subtitleChoiceIndex(prefs));
  const qualityIdx = effectiveChoice(choices.quality, prefs.quality || 0);
  const settingsRows: { col: 'audio' | 'subs' | 'quality'; label: string; value: string; options: string[]; indices: number[] }[] = [
    {
      col: 'audio', label: 'Audio', indices: choices.audio, options: choices.audio.map(i => AUDIO_OPTIONS[i]),
      value: audioIdx >= 0 ? AUDIO_OPTIONS[audioIdx] : (ownAudioName(media, LANGUAGE_RULES) || 'Original')
    },
    { col: 'subs', label: 'Subtítulos', indices: choices.subs, options: choices.subs.map(i => SUB_OPTIONS[i]), value: SUB_OPTIONS[subIdx] || SUB_OPTIONS[0] },
    { col: 'quality', label: 'Resolución', indices: choices.quality, options: choices.quality.map(i => QUALITY_OPTIONS[i]), value: QUALITY_OPTIONS[qualityIdx] || QUALITY_OPTIONS[0] }
  ];
  const hasTrailer = Boolean(currentItem.trailerUrl || (currentItem as any).trailer);
  // Round buttons after Reproducir, in the same row
  const quickItems: ('fav' | 'settings' | 'trailer')[] = ['fav', 'settings', ...(hasTrailer ? ['trailer' as const] : [])];

  // Parent callbacks are new functions on every render: keep the latest in refs so the
  // effects below only fire when the data changes (otherwise they loop forever)
  const onDetailLoadedRef = useRef(onDetailLoaded);
  onDetailLoadedRef.current = onDetailLoaded;
  const onEpisodesChangeRef = useRef(onEpisodesChange);
  onEpisodesChangeRef.current = onEpisodesChange;

  // Notify parent of counts for remote D-pad navigation
  useEffect(() => {
    if (onDetailLoadedRef.current) {
      onDetailLoadedRef.current({
        seasonsCount: seasons.length || (isSeries ? 1 : 0),
        episodesCount: episodes.length,
        relatedCount: relatedItems.length,
        isSeries,
        hasTrailer,
        choices
      });
    }
  }, [seasons.length, episodes.length, relatedItems.length, isSeries, hasTrailer, choices]);

  // Auto-scroll horizontal episode slider with comfortable threshold
  useEffect(() => {
    if (focus.area === 'episodes' && episodesSliderRef.current) {
      const container = episodesSliderRef.current;
      const local = focus.episodeIndex % EP_RANGE;
      const target = container.children[local] as HTMLElement;
      scrollHorizontalSlider(container, target, local, 0, 180);
    }
  }, [focus.area, focus.episodeIndex, episodes]);

  const seriesSectionRef = useRef<HTMLElement>(null);
  const seasonMenuRef = useRef<HTMLDivElement>(null);
  // Long season lists: the highlighted season stays in view inside the panel
  useEffect(() => {
    if (focus.area !== 'seasonMenu' || !seasonMenuRef.current) return;
    const opt = seasonMenuRef.current.querySelector('.vod-action-option.is-focused') as HTMLElement | null;
    if (opt && opt.scrollIntoView) opt.scrollIntoView({ block: 'nearest' });
  }, [focus.area, focus.seasonMenuIndex]);

  // Ranges row follows the visible range (long series have dozens of ranges)
  const rangesRef = useRef<HTMLDivElement>(null);
  const visibleRangeForScroll = focus.area === 'epRanges' && focus.rangeIndex !== undefined
    ? focus.rangeIndex
    : Math.floor(Math.max(0, focus.episodeIndex) / EP_RANGE);
  useEffect(() => {
    const track = rangesRef.current;
    const target = track && (track.children[visibleRangeForScroll] as HTMLElement | undefined);
    if (track && target) scrollHorizontalSlider(track, target, visibleRangeForScroll, 0, 160);
  }, [visibleRangeForScroll, episodes.length]);

  // Auto-scroll horizontal related slider with comfortable threshold
  useEffect(() => {
    if (focus.area === 'related' && relatedSliderRef.current) {
      const container = relatedSliderRef.current;
      const target = container.children[focus.relatedIndex] as HTMLElement;
      scrollHorizontalSlider(container, target, focus.relatedIndex, 48, 160);
    }
  }, [focus.area, focus.relatedIndex]);

  // Auto-scroll vertical page when navigating between top actions and bottom rows
  useEffect(() => {
    if (!rootScrollRef.current) return;
    if (focus.area === 'back' || focus.area === 'actions' || focus.area === 'quick' || focus.area === 'audioModal') {
      rootScrollRef.current.scrollTop = 0;
    } else if (focus.area === 'seasons' || focus.area === 'seasonMenu' || focus.area === 'epRanges' || focus.area === 'episodes') {
      // The whole series section (selector, ranges, tiles) just under the header
      const sec = seriesSectionRef.current;
      rootScrollRef.current.scrollTop = sec ? Math.max(0, sec.offsetTop - 90) : 280;
    } else if (focus.area === 'related') {
      rootScrollRef.current.scrollTop = rootScrollRef.current.scrollHeight;
    }
  }, [focus.area]);

  const backdropUrl = currentItem.backdrop || currentItem.landscape || currentItem.poster || 'assets/placeholder_landscape.png';

  // Visible range of episodes: the focused one in the ranges row, else the focused/current episode's
  const visibleRange = focus.area === 'epRanges' && focus.rangeIndex !== undefined
    ? focus.rangeIndex
    : Math.floor(Math.max(0, focus.episodeIndex) / EP_RANGE);
  const rangeStart = Math.min(visibleRange * EP_RANGE, Math.max(0, episodes.length - 1) - (Math.max(0, episodes.length - 1) % EP_RANGE));
  const captionIdx = focus.area === 'episodes' ? focus.episodeIndex : Math.min(episodes.length - 1, Math.max(0, focus.episodeIndex));
  const captionEp = episodes[captionIdx];
  // Range of the episode to continue (marked with a dot in the ranges row)
  const currentEpIdx = episodeStatuses.findIndex(st => !!st && st.isCurrent);
  const currentRange = currentEpIdx >= 0 ? Math.floor(currentEpIdx / EP_RANGE) : -1;
  const genres = currentItem.genres && currentItem.genres.length ? currentItem.genres : ['Película', 'Acción'];
  const score = currentItem.score || '8.5';
  const year = currentItem.year && currentItem.year !== '—' ? currentItem.year : '2024';

  return (
    <div className="vod-detail-screen" ref={rootScrollRef}>
      {/* Immersive Cinema Backdrop */}
      <div className="vod-detail-backdrop">
        <img
          className="vod-detail-backdrop-img"
          src={backdropUrl}
          decoding="async"
          onLoad={e => e.currentTarget.classList.add('is-loaded')}
          alt=""
        />
      </div>
      <div className="vod-detail-overlay-vignette" />

      {/* Same bar as the home; Back is the icon on the right (focus area 'back') */}
      <ScreenHeader
        actions={[{ id: 'back', title: 'Volver', icon: BackIcon, onClick: onBack }]}
        focusedAction={focus.area === 'back' ? 0 : null}
      />

      {/* Main Metadata Section */}
      <main className="vod-detail-main">
        <div className="vod-detail-header-block">
          <h1 className="vod-detail-title">{currentItem.title}</h1>

          {/* Badges / Rating Row */}
          <div className="vod-detail-badges-row">
            <span className="badge-rating-star">★ {score}</span>
            <span className="badge-pill brand">4K ULTRA HD</span>
            <span className="badge-pill">HDR10+</span>
            <span className="badge-pill age">16+</span>
            <span className="badge-meta">{year}</span>
            <span className="badge-meta">
              {isSeries ? `${seasons.length || 1} Temporada${seasons.length > 1 ? 's' : ''}` : currentItem.duration}
            </span>
          </div>

          {/* Genre Chips */}
          <div className="vod-detail-genres-row">
            {genres.map((g, idx) => (
              <span key={idx} className="vod-genre-chip">
                {g}
              </span>
            ))}
          </div>

          {/* Synopsis */}
          <p className="vod-detail-synopsis">
            {currentItem.synopsis || 'Sinopsis completa de la producción cinematográfica en alta resolución disponible en Xuper TV.'}
          </p>

          {/* Cast & Crew */}
          <div className="vod-detail-crew-row">
            <span className="crew-label">Director:</span>
            <span className="crew-value">{currentItem.director || 'Christopher Nolan'}</span>
            <span className="crew-divider">·</span>
            <span className="crew-label">Reparto:</span>
            <span className="crew-value">{currentItem.actors || 'Reparto estelar'}</span>
          </div>
        </div>

        {/* One row (as streaming apps): Reproducir / Continuar, then round buttons (Mi lista, Ajustes,
            Tráiler) whose label shows under the focused one */}
        <div className="vod-detail-actions-row vod-actions-main">
          <button
            className={`vod-main-btn is-primary ${focus.area === 'actions' ? 'is-focused' : ''}`}
            onClick={() => onPlay(currentItem, resume.episode)}
          >
            <span className="vod-main-icon">▶</span>
            <span className="vod-main-label">{resume.label}</span>
          </button>
          {quickItems.map((q, i) => {
            const focused = (focus.area === 'quick' && focus.quickIndex === i) || (q === 'settings' && focus.area === 'audioModal');
            if (q === 'settings') {
              return (
                <div key={q} className="vod-action-wrap">
                  <button
                    className={`vod-quick-btn ${focused ? 'is-focused' : ''}`}
                    onClick={() => onOpenAudioModal && onOpenAudioModal('menu')}
                  >
                    <span className="vod-quick-circle"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                    </svg></span>
                    {focus.area === 'quick' && focused && <span className="vod-quick-label">Ajustes</span>}
                  </button>
                  {focus.area === 'audioModal' && (
                    <div className="vod-action-menu vod-settings-menu">
                      {(focus.modalCol || 'menu') === 'menu'
                        ? settingsRows.map((row, r) => (
                            <div
                              key={row.col}
                              className={`vod-action-option ${(focus.modalIndex || 0) === r ? 'is-focused' : ''}`}
                              onClick={() => onOpenAudioModal && onOpenAudioModal(row.col)}
                            >
                              <span>{row.label}</span>
                              <span className="vod-settings-value">{row.value}</span>
                              <span className="vod-settings-chevron">›</span>
                            </div>
                          ))
                        : (() => {
                            const row = settingsRows.find(x => x.col === focus.modalCol) || settingsRows[0];
                            return (
                              <>
                                <div className="vod-settings-head">‹ {row.label}</div>
                                {row.options.length === 0 && (
                                  <div className="vod-action-option is-focused"><span>Este título solo trae su audio original</span></div>
                                )}
                                {row.options.map((opt, o) => (
                                  <div
                                    key={opt}
                                    className={`vod-action-option ${opt === row.value ? 'is-active' : ''} ${(focus.modalIndex || 0) === o ? 'is-focused' : ''}`}
                                    onClick={() => onSelectSetting && onSelectSetting(row.col, row.indices[o])}
                                  >
                                    <span>{opt}</span>
                                    {opt === row.value && <span className="vod-season-check">✓</span>}
                                  </div>
                                ))}
                              </>
                            );
                          })()}
                    </div>
                  )}
                </div>
              );
            }
            if (q === 'fav') {
              return (
                <button
                  key={q}
                  className={`vod-quick-btn ${focused ? 'is-focused' : ''}`}
                  onClick={() => (onToggleFavorite ? onToggleFavorite(currentItem) : favoritesService.toggleFavorite(currentItem.id))}
                >
                  <span className="vod-quick-circle"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    {isFav ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M12 5v14M5 12h14" />}
                  </svg></span>
                  {focused && <span className="vod-quick-label">{isFav ? 'En mi lista' : 'Mi lista'}</span>}
                </button>
              );
            }
            return (
              <button
                key={q}
                className={`vod-quick-btn ${focused ? 'is-focused' : ''}`}
                onClick={() => onPlay(currentItem, undefined, true)}
              >
                <span className="vod-quick-circle"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
                  <rect x="3.5" y="9" width="17" height="11" rx="1.5" />
                  <path d="M3.5 9l2.2-4.5 15 0-2.2 4.5M8.5 4.5L7 9M14 4.5L12.5 9" />
                </svg></span>
                {focused && <span className="vod-quick-label">Tráiler</span>}
              </button>
            );
          })}
        </div>

        {/* Series Section: Seasons Selector + Episodes Slider */}
        {isSeries && (
          <section className="vod-detail-series-section" ref={seriesSectionRef}>
            <div className="vod-series-header">
              <h2 className="section-title">Episodios</h2>

              {/* Season selector: same button and list as Audio / Subtítulos (the season loads when picked) */}
              {seasons.length > 1 && (
                <div className="vod-action-wrap">
                  <button
                    className={`vod-action-btn secondary-btn ${focus.area === 'seasons' || focus.area === 'seasonMenu' ? 'is-focused' : ''}`}
                    onClick={() => onOpenSeasonMenu && onOpenSeasonMenu()}
                  >
                    <span>{(seasons[focus.seasonIndex] || seasons[0]).name}</span>
                    <span className="vod-action-caret">▾</span>
                  </button>
                  {focus.area === 'seasonMenu' && (
                    <div className="vod-action-menu is-scrollable" ref={seasonMenuRef}>
                      {seasons.map((s, sIdx) => (
                        <div
                          key={s.id || sIdx}
                          className={`vod-action-option ${sIdx === focus.seasonIndex ? 'is-active' : ''} ${
                            sIdx === focus.seasonMenuIndex ? 'is-focused' : ''
                          }`}
                          onClick={() => onSelectSeason && onSelectSeason(sIdx)}
                        >
                          <span>{s.name}</span>
                          {sIdx === focus.seasonIndex && <span className="vod-season-check">✓</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Ranges of 20 ("1-20", "21-40"…) when the season is longer */}
            {episodes.length > EP_RANGE && !(isLoading || seasonLoading) && (
              <div className="vod-ep-ranges-clip">
              <div className="vod-ep-ranges" ref={rangesRef}>
                {Array.from({ length: Math.ceil(episodes.length / EP_RANGE) }, (_, r) => {
                  const from = r * EP_RANGE + 1;
                  const to = Math.min(episodes.length, (r + 1) * EP_RANGE);
                  return (
                    <div
                      key={r}
                      className={`vod-ep-range ${r === visibleRange ? 'is-active' : ''} ${r === currentRange ? 'has-current' : ''} ${
                        focus.area === 'epRanges' && focus.rangeIndex === r ? 'is-focused' : ''
                      }`}
                      onClick={() => onSelectEpisode && onSelectEpisode(r * EP_RANGE)}
                    >
                      {from}-{to}
                    </div>
                  );
                })}
              </div>
              </div>
            )}

            {/* Numbered tiles of the visible range: episodes almost never have their own picture */}
            <div className="vod-episodes-slider is-tiles" ref={episodesSliderRef}>
              {(isLoading || seasonLoading) ? (
                [1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                  <div key={`ep-skel-${n}`} className="vod-ep-tile is-skeleton skeleton-shimmer" />
                ))
              ) : loadError ? (
                <div className="vod-episodes-empty-card">
                  <div className="vod-episodes-empty-icon">⚠️</div>
                  <div className="vod-episodes-empty-text">No se pudieron cargar los episodios. Vuelve a abrir la ficha para reintentar.</div>
                </div>
              ) : episodes.length === 0 ? (
                <div className="vod-episodes-empty-card">
                  <div className="vod-episodes-empty-icon">📺</div>
                  <div className="vod-episodes-empty-text">No hay episodios disponibles para esta temporada.</div>
                </div>
              ) : (
                episodes.slice(rangeStart, rangeStart + EP_RANGE).map((ep, j) => {
                  const epIdx = rangeStart + j;
                  const isEpFocused = focus.area === 'episodes' && focus.episodeIndex === epIdx;
                  const st = episodeStatuses[epIdx];
                  return (
                    <div
                      key={ep.id || epIdx}
                      className={`vod-ep-tile ${isEpFocused ? 'is-focused' : ''} ${st?.isWatched ? 'is-watched' : ''} ${st?.isCurrent ? 'is-current' : ''}`}
                      onClick={() => onPlay(currentItem, ep)}
                    >
                      {st?.isCurrent && <span className="vod-ep-tile-play">▶</span>}
                      <span className="vod-ep-tile-num">{ep.number || epIdx + 1}</span>
                      {st?.isWatched && <span className="vod-ep-tile-check">✓</span>}
                      {st && !st.isWatched && st.progressPercent > 0 && (
                        <div className="vod-ep-tile-progress">
                          <div style={{ width: `${st.progressPercent}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* The focused (or current) episode */}
            {captionEp && !(isLoading || seasonLoading) && (
              <div className="vod-ep-caption">
                <span className="vod-ep-caption-num">Episodio {captionEp.number || captionIdx + 1}</span>
                {captionEp.title && <span className="vod-ep-caption-title">{captionEp.title}</span>}
                {captionEp.duration && <span className="vod-ep-caption-meta">{captionEp.duration}</span>}
              </div>
            )}
          </section>
        )}

        {/* Recommended / Similar Titles Row */}
        {relatedItems && relatedItems.length > 0 && (
          <section className="vod-detail-related-section">
            <h2 className="section-title">Títulos Similares</h2>
            <div className="vod-related-slider" ref={relatedSliderRef}>
              {relatedItems.map((rel, rIdx) => {
                const isRelFocused = focus.area === 'related' && focus.relatedIndex === rIdx;
                return (
                  <PosterCard
                    key={rel.id || rIdx}
                    item={rel}
                    isFocused={isRelFocused}
                    onActivate={item => onSelectRelated && onSelectRelated(item)}
                  />
                );
              })}
            </div>
          </section>
        )}
      </main>

    </div>
  );
};
