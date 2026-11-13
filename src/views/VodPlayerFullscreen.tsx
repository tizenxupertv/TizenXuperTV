import { noteFinished, playerClosed, playerOpened } from '../lib/donateMoment';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { VodItem, VodEpisode, VodSeason } from '../types/vod';
import { historyService } from '../services/historyService';
import { playerService } from '../services/playerService';
import { catalogService } from '../services/catalogService';
import { getEpisodeStatus, canSaveProgress, reachedResumeGoal, retryStartAt } from '../lib/vodResume';
import { scrollHorizontalSlider } from '../utils/scrollHelper';
import { hostOf, logPlayback, setPlaybackContext } from '../lib/playbackLog';
import { createSeekHold, formatSkip } from '../lib/seekAccel';
import { buildVodPlaylist, fileAudioLanguages, indexDuration, mseHlsConfig, mseUnsupportedReason, wantedAudioIndex, MSE_PLAYLIST_URL } from '../lib/vodMseEngine';
import { friendlyPortalError } from '../lib/portalErrors';
import { settingsService, QUALITY_OPTIONS } from '../services/settingsService';
import {
  SubtitleTrack,
  SubtitleCue,
  languageName,
  sameLanguage,
  PREF_LANG_CODES,
  loadSubtitle,
  cueAt
} from '../lib/subtitles';

interface VodPlayerFullscreenProps {
  item: VodItem;
  episode?: VodEpisode;
  isTrailer?: boolean;
  /** Seconds to resume from */
  startAt?: number;
  /** Season content id the episode belongs to */
  seriesId?: string;
  seasonNumber?: number;
  /** Episodes of the season, for "next episode" */
  episodes?: VodEpisode[];
  /** Full list of seasons of the series */
  seasons?: VodSeason[];
  onPlayEpisode?: (episode: VodEpisode, seasonNumber?: number) => void;
  onClose: () => void;
}

// Demo video only for local development; a real TV build never plays it
const DEV_FALLBACK_URL = 'https://media.w3.org/2010/05/bunny/movie.mp4';
const SAVE_EVERY_MS = 15000;
const NEXT_EPISODE_SECONDS = 10;
/**
 * A "Siguiente episodio" button shows this many seconds before the end of an episode, over the credits; the
 * countdown appears only for the last CREDITS_COUNTDOWN_S, and the next one starts when the episode ends
 */
const CREDITS_WINDOW_S = 30;
const CREDITS_COUNTDOWN_S = 5;
/**
 * "Omitir intro": the portal does not say where an intro starts or ends, so the offer is general. An episode shows
 * the button between INTRO_FROM_S and INTRO_UNTIL_S, and OK jumps INTRO_SKIP_S ahead
 */
const INTRO_FROM_S = 5;
const INTRO_UNTIL_S = 150;
const INTRO_SKIP_S = 90;

interface SettingRow {
  group: string;
  label: string;
  selected: boolean;
  apply: () => void;
  /** Choosing it closes the menu (a track or a resolution); settings stay open to try another value */
  close?: boolean;
}

// Same order as PlaybackSettings.display and the bridge's _displayMethod
const DISPLAY_METHODS = ['PLAYER_DISPLAY_MODE_LETTER_BOX', 'PLAYER_DISPLAY_MODE_FULL_SCREEN', 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO'];
const DISPLAY_LABELS = ['Ajustar (con bandas)', 'Pantalla completa', 'Automático'];
const DISPLAY_FIT = ['contain', 'cover', 'contain'] as const;
const SUB_SIZE_LABELS = ['Normal', 'Grande', 'Pequeño'];
const SUB_STYLE_LABELS = ['Blanco', 'Amarillo', 'Con fondo'];

interface AudioOption {
  /** 'file': another audio inside the same file while MSE plays it; choosing it reopens the title with AVPlay */
  kind: 'avplay' | 'portal' | 'file';
  index: number;
  label: string;
  lang?: string;
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

/** AVPlay (hardware player) is only available on the Samsung TV */
/** The title and its index asked from the dev server (/stream-proxy in vite.config.ts) instead of the CDN */
function viaDevProxy(res: any): any {
  const auth = (res.headers && res.headers['Content-Auth']) || '';
  const license = (res.headers && res.headers['Content-License']) || '';
  const wrap = (url: string) => url
    ? `${location.origin}/stream-proxy?url=${encodeURIComponent(url)}&auth=${encodeURIComponent(auth)}&license=${encodeURIComponent(license)}`
    : url;
  // No headers of its own: the proxy sets them, and no host to pick another Content-Auth for
  return { ...res, url: wrap(res.url), idxUrl: wrap(res.idxUrl), headers: {}, authByHost: undefined };
}

function hasAvPlay(): boolean {
  return !!(window.XuperAVPlay && window.webapis && window.webapis.avplay);
}

/** AVPlay state and the duration it reports, for the playback log (a 0 s duration means it cannot seek) */
function avPlayState(): string {
  let state = '?';
  try { state = window.webapis.avplay.getState(); } catch (e) {}
  const dur = Math.round((window.XuperAVPlay && window.XuperAVPlay.durationSec) || 0);
  return `estado ${state} · duración TV ${dur} s`;
}

export const VodPlayerFullscreen: React.FC<VodPlayerFullscreenProps> = ({
  item,
  episode,
  isTrailer,
  startAt = 0,
  seriesId,
  seasonNumber,
  episodes = [],
  seasons = [],
  onPlayEpisode,
  onClose
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showOsd, setShowOsd] = useState(true);
  const [osdMessage, setOsdMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [currentSeasonNum, setCurrentSeasonNum] = useState<number | undefined>(seasonNumber);
  useEffect(() => {
    if (seasonNumber) setCurrentSeasonNum(seasonNumber);
  }, [seasonNumber]);

  // While the player is open the saved position does not redraw the app under it: once, on leaving
  useEffect(() => {
    if (isTrailer) return;
    return historyService.holdNotifications();
  }, [isTrailer]);

  // The donation request waits for the player to be gone (lib/donateMoment)
  useEffect(() => {
    if (isTrailer) return;
    playerOpened();
    return () => playerClosed();
  }, [isTrailer]);

  // Problem report: what is playing, and why it stopped
  useEffect(() => {
    if (isTrailer) return;
    const ep = episode as any;
    const label = ep && (ep.episodeNumber || ep.number) ? ` · ep. ${ep.episodeNumber || ep.number}` : '';
    setPlaybackContext({ channel: `${item.title}${label}`, category: item.isSeries ? 'Serie' : 'Película', source: 'portal' });
  }, [item.id, episode && (episode as any).id, isTrailer]);
  useEffect(() => {
    if (error && !isTrailer) logPlayback({ kind: 'error', player: 'VOD', detail: error });
  }, [error]);
  const [retryTick, setRetryTick] = useState(0);
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  // Next-episode card: over the credits (the episode keeps playing) or after the end. Without a countdown when
  // "Siguiente capítulo" is Manual in the settings
  const [nextOffer, setNextOffer] = useState<null | 'credits' | 'end'>(null);
  const creditsDismissedRef = useRef(false);
  /** The intro button was used or hidden in this episode */
  const [introDismissed, setIntroDismissed] = useState(false);
  const osdTimerRef = useRef<any>(null);
  const useAvPlayRef = useRef<boolean>(false);
  const requestIdRef = useRef<number>(0);
  const timeRef = useRef({ t: 0, d: 0 });
  // The player reports its time several times a second and every update re-renders this whole screen. With the
  // controls hidden and no subtitles on, nothing on screen changes that often: once a second is enough there
  const shownTimeRef = useRef(0);
  const fineTimeRef = useRef(true);
  const showTime = useCallback((t: number) => {
    if (!fineTimeRef.current && Math.abs(t - shownTimeRef.current) < 1) return;
    shownTimeRef.current = t;
    setCurrentTime(t);
  }, []);
  const startedAtRef = useRef<number>(startAt);

  const [streamInfoText, setStreamInfoText] = useState<string>('');
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  /** Title played through MSE (hls.js + the .idxg index) instead of AVPlay */
  const [mseRes, setMseRes] = useState<any>(null);
  /** MSE failed in this player: the rest of the session (retries, audio changes) uses AVPlay */
  const mseFailedRef = useRef(false);
  /** Audio language picked in this player among the ones inside the file ('' = the profile preference) */
  const fileAudioRef = useRef('');
  /** Which of the file's audios MSE plays (0: the first one) */
  const mseAudioIndexRef = useRef(0);
  const [avMode, setAvMode] = useState(false);

  // Audio / subtitles chosen from the player menus (bottom-right buttons)
  const [quality, setQuality] = useState<string>('');
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);
  const [subIndex, setSubIndex] = useState<number>(-1);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [audioOptions, setAudioOptions] = useState<AudioOption[]>([]);
  const [audioIndex, setAudioIndex] = useState<number>(0);
  // Remote focus: center transport (default), controls row, timeline scrubber, or episode drawer
  const [focusArea, setFocusArea] = useState<'center' | 'controls' | 'timeline' | 'episodes'>('center');
  const [centerIndex, setCenterIndex] = useState<number>(1); // 0 = -10s, 1 = play/pause, 2 = +10s
  const [ctrlIndex, setCtrlIndex] = useState<number>(0); // 0 = subtitles, 1 = audio, then episodes (series) and settings
  const [menu, setMenu] = useState<null | 'subs' | 'audio' | 'quality' | 'episodes' | 'settings'>(null);
  const [menuCursor, setMenuCursor] = useState<number>(0);
  const [toastId, setToastId] = useState<number>(0);
  const [seekHud, setSeekHud] = useState<{ delta: number; target: number; duration: number } | null>(null);
  const seekHudTimerRef = useRef<any>(null);
  const portalTrackRef = useRef<number>(0);
  const subsInitRef = useRef<boolean>(false);
  const audioPrefAppliedRef = useRef<boolean>(false);
  const pendingSeekRef = useRef<{ target: number; until: number } | null>(null);
  const seekTimerRef = useRef<any>(null);
  const acceptTimeRef = useRef<(t: number) => boolean>(() => true);
  const introOfferRef = useRef(false);
  // Resuming at the saved position: until the TV confirms that seek, its time (0:00, 0:10…) is not the
  // viewer's and must never be saved over the saved position
  const resumePendingRef = useRef(false);
  /** Position this play was asked to continue at, until the player gets there (0: nothing pending) */
  const resumeGoalRef = useRef(0);
  /** When this play started and when the portal answered, to log how long the first frame took */
  const startTimingRef = useRef<{ at: number; resolvedAt: number; logged: boolean } | null>(null);
  const lastTokenRenewalRef = useRef<number>(Date.now());
  /** How long a seek may take before the timeline shows the TV's time again */
  const SEEK_SAFETY_MS = 6000;
  const LONG_SEEK_SAFETY_MS = 24000;
  const toastTimerRef = useRef<any>(null);
  const [, setSettingsTick] = useState(0); // re-render after a setting changes
  const settings = settingsService.get();

  // Series episodes fallback: ensure the player has the episode list even if started from a quick action
  const [loadedEpisodes, setLoadedEpisodes] = useState<VodEpisode[]>(episodes);
  useEffect(() => {
    if (episodes && episodes.length > 0) {
      setLoadedEpisodes(episodes);
    } else if (item.isSeries || seriesId) {
      catalogService.getVodDetail({ ...item, id: seriesId || item.id })
        .then(res => {
          if (res && Array.isArray(res.episodes) && res.episodes.length > 0) {
            setLoadedEpisodes(res.episodes);
          }
        })
        .catch(() => {});
    }
  }, [episodes, item.id, item.isSeries, seriesId]);
  const effectiveEpisodes = loadedEpisodes && loadedEpisodes.length > 0 ? loadedEpisodes : episodes;

  const handleSwitchSeason = useCallback((s: VodSeason) => {
    setCurrentSeasonNum(s.number);
    catalogService.getVodDetail({ ...item, id: String(s.id) }).then(res => {
      if (res && res.episodes && res.episodes.length > 0) {
        setLoadedEpisodes(res.episodes);
        setMenuCursor(0);
      }
    }).catch(() => {});
  }, [item]);

  const epIndex = episode ? effectiveEpisodes.findIndex(ep => String(ep.id) === String(episode.id)) : -1;
  const currentEpIndex = epIndex >= 0 ? epIndex : 0;

  const [episodeSubFocus, setEpisodeSubFocus] = useState<'tiles' | 'seasons'>('tiles');

  // History & episode statuses (watched, progress, current)
  const historyEntry = historyService.getEntry(item.id);
  const errorArt = item.backdrop || item.landscape || item.poster || '';
  const episodeStatuses = useMemo(() => {
    return effectiveEpisodes.map((ep, idx) =>
      getEpisodeStatus(ep, idx, historyEntry, currentSeasonNum)
    );
  }, [effectiveEpisodes, historyEntry, currentSeasonNum]);

  const nextEpisode = epIndex !== -1 && epIndex + 1 < effectiveEpisodes.length ? effectiveEpisodes[epIndex + 1] : undefined;
  // Episode shelf (like Apple TV): the other episodes of the season, without leaving the player
  const hasEpisodeShelf = !isTrailer && !!onPlayEpisode && effectiveEpisodes.length > 1;
  // Controls row: Subtítulos, Audio, (Episodios), Resolución, Ajustes
  const qualityCtrl = hasEpisodeShelf ? 3 : 2;
  const settingsCtrl = qualityCtrl + 1;
  const ctrlCount = settingsCtrl + 1;
  const epNumber = episode ? (episode.number || epIndex + 1 || 1) : 0;

  const title = isTrailer ? `${item.title} — Tráiler Oficial` : item.title;
  const subtitle = !isTrailer && episode
    ? `${currentSeasonNum ? `T${currentSeasonNum}:` : ''}E${epNumber} · ${episode.title || episode.name || 'Capítulo'}`
    : (!isTrailer ? [item.year, item.duration].filter(v => v && v !== '—').join(' · ') : 'Avance cinematográfico');

  // Short center feedback (pause / seek): disappears on its own
  const flash = useCallback((msg: string) => {
    setOsdMessage(msg);
    setToastId(n => n + 1);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setOsdMessage(null), 1200);
  }, []);

  // Back hides the overlay even while paused; any other key brings it back
  const [osdDismissed, setOsdDismissed] = useState(false);

  // Auto-hide OSD after 4.5 seconds of inactivity
  const triggerOsd = useCallback(() => {
    setOsdDismissed(false);
    setShowOsd(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      // Don't auto-hide while scrubbing burst is in progress
      if (isSeekingBurstRef.current) return;
      setShowOsd(false);
      setMenu(null);
      setOsdDismissed(true);
    }, 4500);
  }, []);

  useEffect(() => {
    triggerOsd();
    return () => {
      if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    };
  }, [triggerOsd]);

  // ---------------------------------------------------------------------------
  // Progress saving: every 15 s while playing, and when leaving the player
  // ---------------------------------------------------------------------------
  const saveProgress = useCallback(() => {
    if (isTrailer) return;
    const { t, d } = timeRef.current;
    if (resumePendingRef.current && t < 3) return;
    // Asked to continue further ahead and not there yet: the saved position is not replaced (lib/vodResume.ts)
    if (!canSaveProgress(t, resumeGoalRef.current)) return;
    historyService.savePlayback(item, t, d, episode, false, { id: seriesId, number: seasonNumber });
  }, [isTrailer, item, episode, seriesId, seasonNumber]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (isPlaying) saveProgress();
    }, SAVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [isPlaying, saveProgress]);

  // Preventive SLB token renewal at ~14.5 minutes (870s) to prevent cutoffs at minute 17
  useEffect(() => {
    if (isTrailer || !isPlaying) return;
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastTokenRenewalRef.current >= 870_000) {
        const contentId = String(episode?.id || item.id || '');
        const seasonId = episode ? String(seriesId || item.id || '') : null;
        if (window.MagisClient && typeof window.MagisClient.resolve === 'function' && contentId) {
          console.log('[VodPlayer] Proactively renewing SLB token before 17-minute expiration...');
          window.MagisClient.resolve(contentId, seasonId, { trackIndex: portalTrackRef.current }, (err: any, newRes: any) => {
            if (!err && newRes && newRes.url) {
              lastTokenRenewalRef.current = Date.now();
              window.__xuperCurrentStreamMeta = {
                ...newRes,
                contentId,
                seasonId,
                trackIndex: portalTrackRef.current,
                startedAt: Date.now()
              };
              if (window.XuperAVPlay) {
                window.XuperAVPlay._lastHeaders = newRes.headers;
                window.XuperAVPlay._lastUrl = newRes.url;
              }
              console.log('[VodPlayer] SLB token renewed successfully.');
            }
          });
        }
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [isTrailer, isPlaying, episode, item.id, seriesId]);

  const handleEnded = useCallback(() => {
    if (!isTrailer) {
      timeRef.current.t = timeRef.current.d || timeRef.current.t;
      saveProgress();
      noteFinished();
    }
    // The card was counting down over the credits: the end is its zero
    if (nextOffer === 'credits' && settingsService.get().autoNext !== false && nextEpisode && onPlayEpisode) {
      setNextOffer(null);
      setNextCountdown(null);
      onPlayEpisode(nextEpisode);
      return;
    }
    if (nextEpisode && onPlayEpisode && !isTrailer) {
      setNextOffer('end');
      setNextCountdown(settingsService.get().autoNext !== false ? NEXT_EPISODE_SECONDS : null);
    } else {
      onClose();
    }
  }, [isTrailer, nextEpisode, onPlayEpisode, onClose, saveProgress, nextOffer]);

  // Credits: the last CREDITS_WINDOW_S seconds of an episode with a next one offer it while the credits play
  // (once; Back hides it). Seeking back before the credits hides it again
  useEffect(() => {
    if (isTrailer || !nextEpisode || !onPlayEpisode || !(duration > 120) || nextOffer === 'end') return;
    const left = duration - currentTime;
    // Up to the very end: with a lower limit the offer closed in the last second and the end opened a second one
    const inCredits = left <= CREDITS_WINDOW_S;
    const opening = inCredits && !nextOffer && isPlaying && !creditsDismissedRef.current && !pendingSeekRef.current;
    if (opening) setNextOffer('credits');
    if (inCredits && (opening || nextOffer === 'credits')) {
      // The countdown is the time left in the episode (it stops while paused), shown only for the last seconds
      setNextCountdown(settingsService.get().autoNext !== false && left <= CREDITS_COUNTDOWN_S ? Math.max(0, Math.ceil(left)) : null);
    } else if (!inCredits && nextOffer === 'credits') {
      setNextOffer(null);
      setNextCountdown(null);
    }
  }, [currentTime, duration, isPlaying, isTrailer, nextEpisode, onPlayEpisode, nextOffer]);
  const playNext = useCallback(() => {
    setNextOffer(null);
    setNextCountdown(null);
    if (nextEpisode && onPlayEpisode) onPlayEpisode(nextEpisode);
  }, [nextEpisode, onPlayEpisode]);

  // Latest callbacks for listeners registered once (AVPlay handlers, unmount)
  const handleEndedRef = useRef(handleEnded);
  handleEndedRef.current = handleEnded;
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;

  // Manage TV screensaver during playback (Jellyfin / Tizen pattern)
  useEffect(() => {
    window.XuperPlatform?.setScreenSaver?.(!isPlaying);
    return () => {
      window.XuperPlatform?.setScreenSaver?.(true);
    };
  }, [isPlaying]);

  // Next-episode countdown
  useEffect(() => {
    if (nextCountdown === null || nextOffer !== 'end') return;
    if (nextCountdown <= 0) {
      playNext();
      return;
    }
    const t = setTimeout(() => setNextCountdown(c => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [nextCountdown, nextOffer, playNext]);

  // ---------------------------------------------------------------------------
  // Resolve the stream and start playback
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestId === requestIdRef.current;

    setError(null);
    setIsBuffering(true);
    setBrowserUrl(null);
    setMseRes(null);
    // A retry reopens where the title is; when it never played (MSE failed before its first frame), where it was asked to
    startedAtRef.current = retryTick > 0 ? retryStartAt(timeRef.current.t, startedAtRef.current, resumeGoalRef.current) : startAt;
    resumeGoalRef.current = startedAtRef.current > 5 ? startedAtRef.current : 0;

    // The live preview shares the single AVPlay instance: stop it first
    playerService.stop();

    const failed = (msg: string) => {
      if (!isCurrent()) return;
      if (import.meta.env.DEV) {
        console.warn('[VodPlayer] ' + msg + ' — using the demo video (development only)');
        setBrowserUrl(episode?.streamUrl || item.streamUrl || DEV_FALLBACK_URL);
      } else {
        setIsBuffering(false);
        setError(msg);
      }
    };

    const playOnTv = (res: any) => {
      useAvPlayRef.current = true;
      setAvMode(true);
      // AVPlay draws below the page: everything above it must be transparent
      document.documentElement.classList.add('xuper-vod-avplay');
      console.log('[VodPlayer] AVPlay open', res.mime, hostOf(res.url), 'startAt=' + startedAtRef.current);
      // Resuming at an offset: ignore the TV's time until it confirms the seek (video.onresumeseek below)
      resumePendingRef.current = startedAtRef.current > 5;
      if (resumePendingRef.current) {
        pendingSeekRef.current = { target: startedAtRef.current, until: Date.now() + SEEK_SAFETY_MS };
        setTimeout(() => {
          if (isCurrent()) {
            resumePendingRef.current = false;
          }
        }, 4000);
      }
      (video as any).onresumeseek = (ok: boolean) => {
        if (!isCurrent()) return;
        resumePendingRef.current = false;
        const resumeSec = Math.round(startedAtRef.current);
        if (ok) logPlayback({ kind: 'info', player: 'AVPlay', detail: `retomó en ${resumeSec} s` });
        else logPlayback({ kind: 'error', player: 'AVPlay', detail: `no pudo retomar en ${resumeSec} s (${avPlayState()})` });
        if (ok) {
          if (pendingSeekRef.current) pendingSeekRef.current.until = Date.now() + 1500;
        } else {
          pendingSeekRef.current = null;
          flash('No se pudo continuar donde lo dejaste');
        }
      };
      // tizen-bridge reads backup CDNs from here when a stream fails
      window.__xuperCurrentStreamMeta = res;
      video.onloadedmetadata = () => {
        console.log('[VodPlayer] AVPlay prepared, duration=' + window.XuperAVPlay.durationSec);
        if (!isCurrent()) return;
        const d = window.XuperAVPlay.durationSec || res.duration || 0;
        timeRef.current.d = d;
        setDuration(d);
        // Older TVs give no duration for these files and the portal sends 0: the title's index has it
        if (!d && res.idxUrl) {
          indexDuration(res).then(sec => {
            if (!isCurrent() || !(sec > 0) || timeRef.current.d > 0) return;
            timeRef.current.d = sec;
            setDuration(sec);
          });
        }
        // Several audio languages inside the same stream: switch them without reloading
        try {
          const info = window.webapis.avplay.getTotalTrackInfo() || [];
          const audios: AudioOption[] = [];
          for (let i = 0; i < info.length; i++) {
            if (info[i].type !== 'AUDIO') continue;
            let lang = '';
            try { lang = JSON.parse(info[i].extra_info || '{}').language || ''; } catch (e) {}
            audios.push({ kind: 'avplay', index: info[i].index, label: languageName(lang) });
          }
          console.log('[VodPlayer] AVPlay audio tracks', audios.length);
          if (audios.length > 1) {
            setAudioOptions(audios);
            const prefCode = fileAudioRef.current || PREF_LANG_CODES[settingsService.get().audio] || 'es';
            const wantedIdx = Math.max(0, audios.findIndex(a => sameLanguage(a.label, prefCode)));
            setAudioIndex(wantedIdx);
            if (wantedIdx > 0) {
              try { window.webapis.avplay.setSelectTrack('AUDIO', audios[wantedIdx].index); } catch (e) {}
            }
          }
        } catch (e) {}
      };
      video.ontimeupdate = () => {
        if (!isCurrent()) return;
        const t = window.XuperAVPlay.currentTimeSec || 0;
        if (!acceptTimeRef.current(t)) return;
        if (t > 2 && resumePendingRef.current) {
          resumePendingRef.current = false;
        }
        timeRef.current.t = t;
        showTime(t);
      };
      video.onwaiting = () => isCurrent() && setIsBuffering(true);
      video.onplaying = () => {
        console.log('[VodPlayer] AVPlay playing');
        if (!isCurrent()) return;
        const timing = startTimingRef.current;
        if (timing && !timing.logged && !isTrailer) {
          timing.logged = true;
          const now = Date.now();
          logPlayback({ kind: 'start', player: 'AVPlay', detail: `inicio ${now - timing.at} ms (portal ${timing.resolvedAt - timing.at} ms, TV ${now - timing.resolvedAt} ms) · ${avPlayState()}` });
        }
        setIsBuffering(false);
        setIsPlaying(true);
      };
      video.onended = () => isCurrent() && handleEndedRef.current();
      video.onerror = () => {
        console.log('[VodPlayer] AVPlay error');
        if (isCurrent()) {
          setIsBuffering(false);
          setError('No se pudo reproducir este contenido.');
        }
      };
      window.__xuperCurrentStreamMeta = {
        ...res,
        contentId,
        seasonId,
        trackIndex: portalTrackRef.current,
        startedAt: Date.now()
      };
      const ok = window.XuperAVPlay.playStream(res.url, res.headers, video, startedAtRef.current);
      console.log('[VodPlayer] playStream returned', ok);
      if (!ok) failed('No se pudo iniciar el reproductor de la TV.');
    };

    if (isTrailer) {
      const trailerUrl = item.streamUrl || (import.meta.env.DEV ? DEV_FALLBACK_URL : '');
      if (trailerUrl) {
        setBrowserUrl(trailerUrl);
      } else {
        setIsBuffering(false);
        setError('Este título no tiene tráiler disponible.');
      }
      return;
    }

    const contentId = String(episode?.id || item.id || '');
    const seasonId = episode ? String(seriesId || item.id || '') : null;

    if (!window.MagisClient || typeof window.MagisClient.resolve !== 'function' || !contentId) {
      failed('El portal no está disponible.');
      return;
    }

    const onResolved = (err: any, res: any) => {
      if (!isCurrent()) return; // the user already left or chose another episode
      if (startTimingRef.current && !startTimingRef.current.resolvedAt) startTimingRef.current.resolvedAt = Date.now();
      if (err || !res || !res.url) {
        // Region blocks and portal codes in plain Spanish, never the portal's Chinese text
        failed(friendlyPortalError(err));
        return;
      }
      // The portal returns its first track (often Portuguese): switch to the preferred audio
      // language once, unless the user already picked a track in this player
      if (!audioPrefAppliedRef.current) {
        audioPrefAppliedRef.current = true;
        const tracksNow: any[] = Array.isArray(res.tracks) ? res.tracks : [];
        const prefCode = PREF_LANG_CODES[settingsService.get().audio] || 'es';
        // "Resolución" of the detail: among the tracks in that language, the preferred quality
        const qPref = QUALITY_OPTIONS[settingsService.get().quality || 0];
        const qWanted = qPref && qPref !== QUALITY_OPTIONS[0] ? qPref.replace('p', '') : '';
        const qualityRank = (q: string): number => {
          const s = String(q || '').toUpperCase();
          if (s.includes('4K') || s.includes('2160')) return 4000;
          if (s.includes('1080') || s.includes('FHD')) return 1080;
          if (s.includes('720') || s.includes('HD')) return 720;
          if (s.includes('480') || s.includes('SD')) return 480;
          const num = parseInt(s, 10);
          return isNaN(num) ? 0 : num;
        };
        const byAudio = tracksNow.filter(t => sameLanguage(t.audio, prefCode));
        const pool = byAudio.length ? byAudio : (qWanted ? tracksNow : []);
        // In "Auto" quality: prioritize the highest resolution track (1080p / 4K) in the chosen audio
        const poolSorted = pool.slice().sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
        const wanted = pool.length
          ? (qWanted && pool.find(t => String(t.quality || '').indexOf(qWanted) !== -1)) || poolSorted[0] || pool[0]
          : undefined;
        if (wanted && wanted.index !== res.trackIndex) {
          console.log('[VodPlayer] preferred audio', prefCode, '-> track', wanted.index, 'instead of', res.trackIndex);
          portalTrackRef.current = wanted.index;
          window.MagisClient.resolve(contentId, seasonId, { trackIndex: wanted.index }, onResolved);
          return;
        }
      }
      setStreamInfoText([res.quality, res.codec, res.audio && `Audio: ${res.audio}`].filter(Boolean).join(' · '));
      setQuality(res.quality || '');
      const tracks: any[] = Array.isArray(res.tracks) ? res.tracks : [];
      setAudioOptions(tracks.length > 0
        ? tracks.map(t => ({ kind: 'portal' as const, index: t.index, label: languageName(t.audio) + (tracks.length > 1 && t.quality ? ` · ${t.quality}` : '') }))
        : [{ kind: 'portal', index: 0, label: languageName(res.audio) }]);
      setAudioIndex(Math.max(0, tracks.findIndex(t => t.index === res.trackIndex)));
      const subs: SubtitleTrack[] = Array.isArray(res.subtitles) ? res.subtitles : [];
      setSubtitles(subs);
      if (!subsInitRef.current) {
        // First load: subtitles follow the profile preference (Configuración global)
        subsInitRef.current = true;
        const pref = PREF_LANG_CODES[settings.subLang] || 'es';
        const audioInPref = sameLanguage(res.audio, pref);
        setSubIndex(settings.subtitle && !audioInPref ? subs.findIndex(sb => sameLanguage(sb.lang, pref)) : -1);
      }
      // MSE plays only the first audio of the file: a title whose wanted audio is another one goes to AVPlay
      const audioWanted = fileAudioRef.current || PREF_LANG_CODES[settingsService.get().audio] || 'es';
      const mseWhyNot = mseFailedRef.current
        ? 'MSE falló en esta reproducción'
        : mseUnsupportedReason(res);
      // The wanted audio may not be the file's first one: MSE is told which one to play (lib/tsAudioSelect.ts)
      mseAudioIndexRef.current = wantedAudioIndex(res.audio, l => sameLanguage(l, audioWanted));
      if (hasAvPlay() && !isTrailer) {
        // Which player and why, for the problem report (the first thing to know when a title misbehaves)
        const resumeAt = startedAtRef.current > 5 ? ` · retomar en ${Math.round(startedAtRef.current)} s` : '';
        logPlayback({ kind: 'info', player: 'VOD', detail: `${mseWhyNot ? `motor AVPlay (${mseWhyNot})` : 'motor MSE'}${res.codec ? ` · ${res.codec}` : ''}${resumeAt}` });
      }
      // Browser development has no AVPlay: the same MSE engine plays the title through the dev server proxy,
      // which adds the portal headers and passes the byte ranges on
      const mseInBrowser = !hasAvPlay() && import.meta.env.DEV;
      if ((hasAvPlay() || mseInBrowser) && !isTrailer && !mseWhyNot) {
        // Indexed .ts on a TV with MSE: pieces by byte range, instant seeks inside the buffer
        if (mseInBrowser) res = viaDevProxy(res);
        window.__xuperCurrentStreamMeta = { ...res, contentId, seasonId, trackIndex: portalTrackRef.current, startedAt: Date.now() };
        // The audios inside the file are the menu: choosing another one reopens the title on it, at the same position
        const fileLangs: AudioOption[] = [];
        fileAudioLanguages(res.audio).forEach((lang, i) => {
          const label = languageName(lang);
          if (!fileLangs.some(o => o.label === label)) fileLangs.push({ kind: 'file', index: i, label, lang });
        });
        if (tracks.length <= 1 && fileLangs.length > 1) {
          setAudioOptions(fileLangs);
          const playing = languageName(fileAudioLanguages(res.audio)[mseAudioIndexRef.current]);
          setAudioIndex(Math.max(0, fileLangs.findIndex(o => o.label === playing)));
        }
        setMseRes(res);
      } else if (hasAvPlay()) {
        playOnTv(res);
      } else if (res.mime === 'video/mp2t' || /\.ts(\?|$)/i.test(res.url)) {
        // Desktop Chrome cannot play MPEG-TS files; the TV plays them with AVPlay
        setIsBuffering(false);
        setError('Este video (.ts) solo se reproduce en la TV. En el navegador no es compatible.');
      } else {
        // Desktop browser (development): the dev server proxy adds the portal headers
        const auth = res.headers?.['Content-Auth'] || '';
        const license = res.headers?.['Content-License'] || '';
        setBrowserUrl(`/stream-proxy?url=${encodeURIComponent(res.url)}&auth=${encodeURIComponent(auth)}&license=${encodeURIComponent(license)}`);
      }
    };

    startTimingRef.current = { at: Date.now(), resolvedAt: 0, logged: false };
    window.MagisClient.resolve(contentId, seasonId, { trackIndex: portalTrackRef.current }, onResolved);

    return () => {
      requestIdRef.current++;
    };
  }, [item, episode, isTrailer, seriesId, retryTick]);

  // Browser <video> playback (development / trailers)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !browserUrl) return;
    useAvPlayRef.current = false;

    video.src = browserUrl;
    video.load();

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      if (!acceptTimeRef.current(video.currentTime)) return;
      timeRef.current.t = video.currentTime;
      showTime(video.currentTime);
    };
    const onLoadedMetadata = () => {
      timeRef.current.d = video.duration || 0;
      setDuration(video.duration || 0);
      if (startedAtRef.current > 5 && startedAtRef.current < (video.duration || 0)) {
        video.currentTime = startedAtRef.current;
      }
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    };
    const onPlaying = () => setIsBuffering(false);
    const onWaiting = () => setIsBuffering(true);
    const onEnded = () => handleEndedRef.current();
    const onError = () => {
      if (import.meta.env.DEV && video.src.indexOf(DEV_FALLBACK_URL) === -1) {
        video.src = DEV_FALLBACK_URL;
        video.load();
        return;
      }
      setIsBuffering(false);
      setError('No se pudo reproducir este contenido.');
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      try {
        video.pause();
        video.removeAttribute('src');
      } catch {}
    };
  }, [browserUrl]);

  // MSE playback: the .idxg index becomes a byte-range playlist for hls.js on the page's <video>
  useEffect(() => {
    const video = videoRef.current;
    const Hls = (window as any).Hls;
    if (!video || !mseRes || !Hls) return;
    useAvPlayRef.current = false;
    setAvMode(false);
    document.documentElement.classList.remove('xuper-vod-avplay');
    let hls: any = null;
    let alive = true;
    let recoveredMedia = false;

    // Anything wrong here: play the same title with AVPlay from where it is
    const fallBack = (why: string) => {
      if (!alive) return;
      alive = false;
      console.warn('[VodPlayer] MSE -> AVPlay:', why);
      logPlayback({ kind: 'error', player: 'MSE', detail: `vuelve a AVPlay: ${why}` });
      mseFailedRef.current = true;
      if (video.currentTime > 5) timeRef.current.t = video.currentTime;
      setMseRes(null);
      setRetryTick(t => t + 1);
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      if (!acceptTimeRef.current(video.currentTime)) return;
      timeRef.current.t = video.currentTime;
      showTime(video.currentTime);
    };
    const onLoadedMetadata = () => {
      timeRef.current.d = video.duration || 0;
      setDuration(video.duration || 0);
    };
    const onPlaying = () => {
      setIsBuffering(false);
      setIsPlaying(true);
      const timing = startTimingRef.current;
      if (timing && !timing.logged) {
        timing.logged = true;
        const now = Date.now();
        logPlayback({ kind: 'start', player: 'MSE', detail: `inicio ${now - timing.at} ms (portal ${timing.resolvedAt - timing.at} ms, TV ${now - timing.resolvedAt} ms)` });
        const wanted = startedAtRef.current;
        if (wanted > 5 && Math.abs(video.currentTime - wanted) > 15) {
          logPlayback({ kind: 'error', player: 'MSE', detail: `no retomó: empezó en ${Math.round(video.currentTime)} s (pedido ${Math.round(wanted)} s)` });
        }
      }
    };
    const onWaiting = () => setIsBuffering(true);
    const onEnded = () => handleEndedRef.current();
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('ended', onEnded);

    buildVodPlaylist(mseRes)
      .then(({ playlist, pieces }) => {
        if (!alive) return;
        console.log('[VodPlayer] MSE playlist', pieces, 'pieces, start at', Math.round(startedAtRef.current));
        hls = (window as any).__xuperCreateHls(mseHlsConfig(Hls, playlist, startedAtRef.current, mseAudioIndexRef.current));
        if (!hls) return fallBack('hls.js no disponible');
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {
            video.muted = true;
            video.play().catch(() => {});
          });
        });
        hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
          if (!data || !data.fatal) return;
          // One media recovery (a decoder hiccup); network errors were already retried by hls.js
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
            recoveredMedia = true;
            hls.recoverMediaError();
            return;
          }
          const code = data.response && data.response.code ? ` ${data.response.code}` : '';
          fallBack(`${data.type}/${data.details}${code}`);
        });
        hls.loadSource(MSE_PLAYLIST_URL);
        hls.attachMedia(video);
      })
      .catch((err: any) => fallBack((err && err.message) || String(err)));

    return () => {
      alive = false;
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('ended', onEnded);
      if (hls) {
        try { hls.destroy(); } catch {}
      }
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {}
    };
  }, [mseRes]);

  // Back from background / network reconnect: reopen at the same position
  useEffect(() => {
    const onRestoreFailed = () => {
      if (useAvPlayRef.current) setRetryTick(t => t + 1);
    };
    const onNetworkRecovered = (e: any) => {
      if (e?.detail?.online && error) {
        flash('Conexión restablecida. Reanudando…');
        setError(null);
        setRetryTick(t => t + 1);
      }
    };
    window.addEventListener('xuper-avplay-restore-failed', onRestoreFailed);
    window.addEventListener('xuper-network-change', onNetworkRecovered);
    return () => {
      window.removeEventListener('xuper-avplay-restore-failed', onRestoreFailed);
      window.removeEventListener('xuper-network-change', onNetworkRecovered);
    };
  }, [error]);

  // Load the selected subtitle file
  useEffect(() => {
    setCues([]);
    const track = subtitles[subIndex];
    if (!track) return;
    let alive = true;
    loadSubtitle(track.url)
      .then(list => { if (alive) setCues(list); })
      .catch(() => { if (alive) flash('No se pudieron cargar los subtítulos'); });
    return () => { alive = false; };
  }, [subIndex, subtitles]);

  // Home or the TV's apps button hides the app without closing the player: save the position then too
  useEffect(() => {
    const onHide = () => { if (document.hidden) saveProgressRef.current(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  // Leaving the player: save the position and release the TV player
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      saveProgressRef.current();
      if (useAvPlayRef.current && window.XuperAVPlay) {
        try { window.XuperAVPlay.stop(); } catch {}
        // AVPlay stop paints the page black; give the theme background back
        document.documentElement.style.backgroundColor = '';
        document.body.style.backgroundColor = '';
      }
      window.__xuperCurrentStreamMeta = null;
      document.documentElement.classList.remove('xuper-vod-avplay');
      if (video) {
        video.onloadedmetadata = null;
        video.ontimeupdate = null;
        video.onwaiting = null;
        video.onplaying = null;
        video.onended = null;
        video.onerror = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Controls (AVPlay on the TV, <video> in the browser)
  // ---------------------------------------------------------------------------
  const togglePause = () => {
    const video = videoRef.current;
    if (useAvPlayRef.current && window.XuperAVPlay) {
      if (window.XuperAVPlay.isPaused) {
        window.XuperAVPlay.play();
        setIsPlaying(true);
      } else {
        window.XuperAVPlay.pause();
        setIsPlaying(false);
        saveProgress();
      }
      return;
    }
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
      saveProgress();
    }
  };

  // Seeking: each press moves the timeline at once and adds to the previous target; the real
  // seek is sent once, 220 ms after the last press.
  const accumulatedSkipRef = useRef(0);
  const wasPlayingBeforeSeekRef = useRef(false);
  /** Last MSE seek target: a later seek cancels the "did it land" check of the previous one */
  const lastSeekTargetRef = useRef<number | null>(null);
  const isSeekingBurstRef = useRef(false);
  // Holding ◄ ► (or ⏪ ⏩) makes the jumps grow: 10 s, 30 s, 1, 2, 5 min (lib/seekAccel.ts)
  const seekHoldRef = useRef(createSeekHold());
  const holdSeek = (dir: 1 | -1, isRepeat: boolean) => {
    const delta = seekHoldRef.current.press(dir, isRepeat, Date.now());
    if (delta) seekBy(delta);
  };
  const seekBy = (delta: number) => {
    const d = timeRef.current.d;
    const pending = pendingSeekRef.current;
    const base = pending ? pending.target : timeRef.current.t;
    const target = Math.max(0, Math.min(d > 0 ? d - 5 : Infinity, base + delta));
    pendingSeekRef.current = { target, until: 0 };
    // The viewer moved on their own: their position counts from here, resumed or not
    resumePendingRef.current = false;
    timeRef.current.t = target;
    setCurrentTime(target);

    // For HTML5 video in browser: pause video so audio doesn't stutter while seeking
    // For AVPlay on TV: DO NOT PAUSE! AVPlay natively handles seeking in PLAYING state without state transition freeze
    if (!isSeekingBurstRef.current) {
      isSeekingBurstRef.current = true;
      wasPlayingBeforeSeekRef.current = isPlaying;
      if (isPlaying && !useAvPlayRef.current && videoRef.current) {
        videoRef.current.pause();
      }
    }

    // Feedback with the total of this burst of presses (+10 s, +1:30, −5:00)
    accumulatedSkipRef.current += delta;
    const skipTotal = accumulatedSkipRef.current;
    setSeekHud({ delta: skipTotal, target, duration: d });
    if (seekHudTimerRef.current) clearTimeout(seekHudTimerRef.current);
    seekHudTimerRef.current = setTimeout(() => setSeekHud(null), 1200);

    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = setTimeout(() => {
      seekTimerRef.current = null;
      accumulatedSkipRef.current = 0;
      isSeekingBurstRef.current = false;
      const shouldResume = wasPlayingBeforeSeekRef.current;

      const onSeekDone = () => {
        // Only HTML5 video needs explicit play() call after resume; AVPlay continues playing automatically
        // via onbufferingcomplete once the seeked buffer fills.
        if (shouldResume && !useAvPlayRef.current && videoRef.current) {
          // A seek or closing the player can interrupt this play(): that is expected, not an error for the report
          videoRef.current.play().catch(() => {});
        }
      };

      if (useAvPlayRef.current && window.XuperAVPlay) {
        // The timeline keeps the target until the TV confirms the seek (it can take several seconds on older
        // TVs); for long seeks (> 600s / 10min), extend the safety window up to 24s so the player doesn't bounce back prematurely
        const isLongSeek = Math.abs((window.XuperAVPlay.currentTimeSec || 0) - target) >= 600;
        const safetyMs = isLongSeek ? LONG_SEEK_SAFETY_MS : SEEK_SAFETY_MS;
        if (pendingSeekRef.current) pendingSeekRef.current.until = Date.now() + safetyMs;
        const seekAt = Date.now();
        window.XuperAVPlay.seekTo(target, () => {
          // Slow seeks go to the playback log, to compare TVs
          const took = Date.now() - seekAt;
          if (took > 1500) logPlayback({ kind: 'stall', player: 'AVPlay', detail: `seek ${Math.round(target)} s tardó ${took} ms` });
          if (pendingSeekRef.current && pendingSeekRef.current.target === target) pendingSeekRef.current.until = Date.now() + 2000;
          // The viewer moved the video themself: where they are is their position
          resumeGoalRef.current = 0;
          onSeekDone();
        }, (err: any) => {
          logPlayback({ kind: 'error', player: 'AVPlay', detail: `seek ${Math.round(target)} s: ${(err && (err.name || err.message)) || err} (${avPlayState()})` });
          if (pendingSeekRef.current && pendingSeekRef.current.target === target) {
            pendingSeekRef.current = null;
            // The TV stayed where it was: so do the timeline and the position that gets saved
            const real = window.XuperAVPlay.currentTimeSec || 0;
            timeRef.current.t = real;
            setCurrentTime(real);
          }
          flash('No se pudo mover el video a ese punto');
        });
      } else if (videoRef.current) {
        const v = videoRef.current;
        v.currentTime = target;
        resumeGoalRef.current = 0;
        if (hasAvPlay()) {
          // On the TV this is the MSE player: slow seeks and seeks that never land go to the playback log
          const seekAt = Date.now();
          lastSeekTargetRef.current = target;
          v.addEventListener('seeked', () => {
            const took = Date.now() - seekAt;
            if (took > 1500) logPlayback({ kind: 'stall', player: 'MSE', detail: `seek ${Math.round(target)} s tardó ${took} ms` });
          }, { once: true });
          setTimeout(() => {
            if (lastSeekTargetRef.current !== target || videoRef.current !== v) return;
            if (Math.abs(v.currentTime - target) > 10) {
              logPlayback({ kind: 'error', player: 'MSE', detail: `seek ${Math.round(target)} s no llegó (va en ${Math.round(v.currentTime)} s)` });
            }
          }, 6000);
        }
        onSeekDone();
        if (pendingSeekRef.current) pendingSeekRef.current.until = Date.now() + 2500;
      }
    }, 180);
  };

  // Player time updates while a seek is pending / settling
  const acceptTime = (t: number): boolean => {
    const pending = pendingSeekRef.current;
    if (pending) {
      // Wider landing tolerance for seeks (up to 8s) like Eclectic 2.0.36b so hardware AVPlay
      // decoder resumes instantly without micro-stutters or bouncing
      const reached = Math.abs(t - pending.target) <= 8;
      const expired = pending.until > 0 && Date.now() > pending.until;
      if (!reached && !expired) return false;
      pendingSeekRef.current = null;
      resumePendingRef.current = false;
    }
    // The player is where it was asked to continue: from here its time is the viewer's
    if (reachedResumeGoal(t, resumeGoalRef.current)) resumeGoalRef.current = 0;
    return true;
  };

  acceptTimeRef.current = acceptTime;
  useEffect(() => () => {
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    if (seekHudTimerRef.current) clearTimeout(seekHudTimerRef.current);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
  }, []);

  const chooseAudio = (idx: number) => {
    const opt = audioOptions[idx];
    if (!opt || idx === audioIndex) return;
    setAudioIndex(idx);
    audioPrefAppliedRef.current = true; // a manual choice wins over the preference
    const audioPrefIdx = PREF_LANG_CODES.findIndex(code => sameLanguage(opt.label, code));
    if (audioPrefIdx !== -1) settingsService.set({ audio: audioPrefIdx });
    if (opt.kind === 'avplay') {
      try { window.webapis.avplay.setSelectTrack('AUDIO', opt.index); } catch (e) {}
    } else if (opt.kind === 'file') {
      // Another audio of the same file: the title reopens on it at the same position
      fileAudioRef.current = opt.lang || '';
      setRetryTick(t => t + 1);
    } else {
      // Another audio language is another file on the portal: reload it at the same position
      portalTrackRef.current = opt.index;
      setRetryTick(t => t + 1);
    }
    flash(`Audio: ${opt.label}`);
  };

  const chooseSubtitle = (idx: number) => {
    setSubIndex(idx);
    const track = subtitles[idx];
    const prefIdx = track ? PREF_LANG_CODES.findIndex(code => sameLanguage(track.lang, code)) : -1;
    settingsService.set(prefIdx !== -1 ? { subtitle: true, subLang: prefIdx } : { subtitle: !!track });
    flash(track ? `Subtítulos: ${languageName(track.lang)}` : 'Subtítulos desactivados');
  };

  // Menu rows: subtitles start with "Desactivados" (-1)
  const subRows = [{ label: 'Desactivados', value: -1 }, ...subtitles.map((sb, i) => ({ label: languageName(sb.lang), value: i }))];
  const audioRows = audioOptions.map((a, i) => ({ label: a.label, value: i }));
  // Subtitles & Series Content detection
  const hasSubtitles = subtitles.length > 0;
  const isSeriesContent = !!(hasEpisodeShelf || item.isSeries);

  // Playback settings (also in Perfil > Configuración): screen format, subtitle look, series behavior
  const applyDisplay = (idx: number) => {
    settingsService.set({ display: idx });
    if (avMode) {
      try { window.webapis.avplay.setDisplayMethod(DISPLAY_METHODS[idx]); } catch (e) {}
    }
  };
  // Each control opens the menu with what belongs to it: tracks and subtitle look under Subtítulos, the resolution
  // under Resolución, and what is left (screen format, next episode) under Ajustes
  const subsMenuRows: SettingRow[] = [
    ...subRows.map(r => ({
      group: 'Subtítulos',
      label: r.label,
      selected: r.value === subIndex,
      close: true,
      apply: () => chooseSubtitle(r.value)
    })),
    ...(hasSubtitles ? [
      ...SUB_SIZE_LABELS.map((label, i) => ({
        group: 'Tamaño',
        label,
        selected: settings.size === i,
        apply: () => { settingsService.set({ size: i }); }
      })),
      ...SUB_STYLE_LABELS.map((label, i) => ({
        group: 'Estilo',
        label,
        selected: settings.style === i,
        apply: () => { settingsService.set({ style: i }); }
      }))
    ] : [])
  ];
  const audioMenuRows: SettingRow[] = audioRows.map(r => ({
    group: 'Audio',
    label: r.label,
    selected: r.value === audioIndex,
    close: true,
    apply: () => chooseAudio(r.value)
  }));
  const qualityMenuRows: SettingRow[] = QUALITY_OPTIONS.map((opt, i) => {
    const qLabel = i === 0 ? 'Auto' : opt.toUpperCase();
    return {
      group: 'Resolución',
      label: qLabel,
      selected: (settings.quality || 0) === i,
      close: true,
      apply: () => {
        settingsService.set({ quality: i });
        flash(`Resolución: ${qLabel}`);
      }
    };
  });
  const settingRows: SettingRow[] = [
    ...DISPLAY_LABELS.map((label, i) => ({
      group: 'Formato de pantalla',
      label,
      selected: settings.display === i,
      apply: () => applyDisplay(i)
    })),
    ...(isSeriesContent ? [
      {
        group: 'Episodios de la serie',
        label: settings.autoNext !== false ? 'Siguiente capítulo: Automático' : 'Siguiente capítulo: Manual',
        selected: settings.autoNext !== false,
        apply: () => {
          const next = settings.autoNext === false;
          settingsService.set({ autoNext: next });
          flash(next ? 'Siguiente capítulo: Automático' : 'Siguiente capítulo: Manual');
        }
      }
    ] : [])
  ];
  const rowsOf = (which: 'subs' | 'audio' | 'quality' | 'settings'): SettingRow[] =>
    which === 'subs' ? subsMenuRows : which === 'audio' ? audioMenuRows : which === 'quality' ? qualityMenuRows : settingRows;
  const menuRows: SettingRow[] = menu && menu !== 'episodes' ? rowsOf(menu) : [];

  // Handle TV Remote Keys during full playback
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.keyCode;
      const key = e.key;
      const isBack = code === 10009 || code === 27 || code === 461 || key === 'Escape' || key === 'Backspace' || code === 413 || key === 'MediaStop';
      const isPlay = code === 415 || key === 'MediaPlay';
      const isPause = code === 19 || key === 'MediaPause';
      const isPlayPause = code === 10252 || key === 'MediaPlayPause';
      const isFastForward = code === 417 || key === 'MediaFastForward';
      const isRewind = code === 412 || key === 'MediaRewind';
      const isEnter = code === 13 || code === 32;
      const isLeft = code === 37 || key === 'ArrowLeft';
      const isRight = code === 39 || key === 'ArrowRight';
      const isUp = code === 38 || key === 'ArrowUp';
      const isDown = code === 40 || key === 'ArrowDown';
      if (!(isBack || isEnter || isLeft || isRight || isUp || isDown || isPlay || isPause || isPlayPause || isFastForward || isRewind)) return;
      e.preventDefault();
      e.stopPropagation();

      // Dedicated Samsung Media Remote Keys
      if (isPlay) {
        if (!isPlaying) togglePause();
        setFocusArea('center');
        setCenterIndex(1);
        triggerOsd();
        return;
      }
      if (isPause) {
        if (isPlaying) togglePause();
        setFocusArea('center');
        setCenterIndex(1);
        triggerOsd();
        return;
      }
      if (isPlayPause) {
        togglePause();
        setFocusArea('center');
        setCenterIndex(1);
        triggerOsd();
        return;
      }
      if (isFastForward || isRewind) {
        // The key seeks only with its button (or the timeline) on screen and focused: the first press shows the
        // controls and goes to the button, the next ones seek (held: longer jumps)
        const wanted = isFastForward ? 2 : 0;
        const onButton = osdVisibleRef.current && !menu && focusArea === 'center' && centerIndex === wanted;
        const onTimeline = osdVisibleRef.current && !menu && focusArea === 'timeline';
        triggerOsd();
        if (onButton || onTimeline) {
          holdSeek(isFastForward ? 1 : -1, e.repeat);
        } else {
          if (menu) setMenu(null);
          setFocusArea('center');
          setCenterIndex(wanted);
        }
        return;
      }

      // "Next episode" card: OK plays it. Over the credits Back hides it and every other key works as usual;
      // after the end Back leaves the player
      if (nextOffer === 'credits') {
        if (isEnter) {
          playNext();
          return;
        }
        if (isBack) {
          creditsDismissedRef.current = true;
          setNextOffer(null);
          setNextCountdown(null);
          return;
        }
      } else if (nextOffer === 'end') {
        if (isEnter) playNext();
        else if (isBack) {
          setNextOffer(null);
          setNextCountdown(null);
          onClose();
        }
        return;
      }

      // "Omitir intro" (shown with the controls hidden): OK jumps ahead, Back hides it
      if (introOfferRef.current && !osdVisibleRef.current) {
        if (isEnter) {
          setIntroDismissed(true);
          seekBy(INTRO_SKIP_S);
          return;
        }
        if (isBack) {
          setIntroDismissed(true);
          return;
        }
      }

      // Back key
      if (isBack && !error) {
        if (menu) {
          const wasEp = menu === 'episodes';
          setMenu(null);
          if (wasEp) {
            setFocusArea('controls');
            setCtrlIndex(2);
          }
          triggerOsd();
        } else if (osdVisibleRef.current) {
          if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
          setShowOsd(false);
          setOsdDismissed(true);
          setFocusArea('center');
          setCenterIndex(1);
        } else {
          onClose();
        }
        return;
      }

      // If OSD is currently hidden, any navigation key brings it back first
      if (!osdVisibleRef.current) {
        triggerOsd();
        if (isPlayPause || isPlay || isPause) {
          togglePause();
          setFocusArea('center');
          setCenterIndex(1);
          return;
        }
        if (isEnter) {
          togglePause();
          setFocusArea('center');
          setCenterIndex(1);
          return;
        }
        if (isLeft || isRight) {
          triggerOsd();
          setFocusArea('center');
          setCenterIndex(isLeft ? 0 : 2);
          return;
        }
        setFocusArea('center');
        setCenterIndex(1);
        return;
      }

      // Any navigation while OSD is visible resets the auto-hide timer!
      triggerOsd();

      // Episode drawer: ◄ ► choose, OK plays, Back / ▲ / ▼ closes or shifts focus
      if (focusArea === 'episodes' && menu === 'episodes') {
        if (isBack) {
          setMenu(null);
          setFocusArea('controls');
          setCtrlIndex(2);
          return;
        }

        // Sub-focus 0: SEASONS PILL (Temporada X ▾)
        if (episodeSubFocus === 'seasons') {
          if (isLeft) {
            if (seasons && seasons.length > 1) {
              const curIdx = seasons.findIndex(s => s.number === currentSeasonNum);
              const prevIdx = curIdx > 0 ? curIdx - 1 : seasons.length - 1;
              handleSwitchSeason(seasons[prevIdx]);
            }
            return;
          }
          if (isRight || isEnter) {
            if (seasons && seasons.length > 1) {
              const curIdx = seasons.findIndex(s => s.number === currentSeasonNum);
              const nextIdx = (curIdx + 1) % seasons.length;
              handleSwitchSeason(seasons[nextIdx]);
            }
            return;
          }
          if (isDown) {
            setEpisodeSubFocus('tiles');
            return;
          }
          if (isUp) {
            setFocusArea('center');
            setCenterIndex(1);
            return;
          }
          return;
        }

        // Sub-focus: TILES ROW (the episode tiles)
        if (isLeft) {
          if (menuCursor > 0) {
            setMenuCursor(c => c - 1);
          }
          return;
        }

        if (isRight) {
          if (menuCursor < effectiveEpisodes.length - 1) {
            setMenuCursor(c => c + 1);
          }
          return;
        }

        if (isUp) {
          if (seasons && seasons.length > 1) {
            setEpisodeSubFocus('seasons');
          } else {
            setFocusArea('center');
            setCenterIndex(1);
          }
          return;
        }

        if (isDown) {
          // Move DOWN back to the controls row on "Episodios"
          setFocusArea('controls');
          setCtrlIndex(2);
          return;
        }

        if (isEnter) {
          const ep = effectiveEpisodes[menuCursor];
          setMenu(null);
          setFocusArea('center');
          setCenterIndex(1);
          if (ep && onPlayEpisode && menuCursor !== epIndex) onPlayEpisode(ep, currentSeasonNum);
          return;
        }
        return;
      }

      // Audio / subtitles / settings menu
      if (menu && menu !== 'episodes') {
        if (isBack || isLeft) {
          setMenu(null);
          setFocusArea('controls');
          return;
        }
        if (isUp) {
          setMenuCursor(c => Math.max(0, c - 1));
          return;
        }
        if (isDown) {
          setMenuCursor(c => Math.min(menuRows.length - 1, c + 1));
          return;
        }
        if (isEnter) {
          const row = menuRows[menuCursor];
          if (row) {
            row.apply();
            if (row.close) {
              setMenu(null);
              setFocusArea('controls');
            } else {
              setSettingsTick(t => t + 1);
            }
          }
          return;
        }
        return;
      }

      // With an error the screen says "OK Reintentar · VOLVER Salir": Back must leave (it used to be ignored here)
      if (error) {
        if (isBack) onClose();
        else if (isEnter) setRetryTick(t => t + 1);
        return;
      }

      // Focus Area 1: Center Transport Controls ([-10], [Play/Pause], [+10])
      if (focusArea === 'center') {
        // ◄ ► move between the three buttons; already on the rewind or forward button, they seek
        if (isLeft) {
          if (centerIndex === 0) holdSeek(-1, e.repeat);
          else setCenterIndex(i => Math.max(0, i - 1));
          return;
        }
        if (isRight) {
          if (centerIndex === 2) holdSeek(1, e.repeat);
          else setCenterIndex(i => Math.min(2, i + 1));
          return;
        }
        if (isEnter) {
          if (centerIndex === 0) seekBy(-10);
          else if (centerIndex === 1) togglePause();
          else if (centerIndex === 2) seekBy(10);
          return;
        }
        if (isDown) {
          if (menu === 'episodes') {
            setFocusArea('episodes');
            setEpisodeSubFocus('tiles');
            return;
          }
          if (!isTrailer && ctrlCount > 0) {
            setFocusArea('controls');
            setCtrlIndex(hasEpisodeShelf ? 2 : 0);
          } else {
            setFocusArea('timeline');
          }
          return;
        }
        if (isUp) {
          if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
          setShowOsd(false);
          setOsdDismissed(true);
          return;
        }
        return;
      }

      // Focus Area 2: Controls row above timeline (Subtítulos / Audio / Episodios / Ajustes)
      if (focusArea === 'controls') {
        if (isUp) {
          if (hasEpisodeShelf && ctrlIndex === 2) {
            // Open or enter the Episode Drawer directly above
            setMenu('episodes');
            setFocusArea('episodes');
            setEpisodeSubFocus('tiles');
            return;
          }
          if (menu === 'episodes') {
            setFocusArea('episodes');
            setEpisodeSubFocus('tiles');
            return;
          }
          setFocusArea('center');
          setCenterIndex(1); // focus Play/Pause
          return;
        }
        if (isDown) {
          setFocusArea('timeline');
          return;
        }
        if (isLeft) {
          if (menu === 'episodes') setMenu(null);
          setCtrlIndex(i => Math.max(0, i - 1));
          return;
        }
        if (isRight) {
          if (menu === 'episodes') setMenu(null);
          setCtrlIndex(i => Math.min(ctrlCount - 1, i + 1));
          return;
        }
        if (isEnter) {
          if (hasEpisodeShelf && ctrlIndex === 2) {
            if (menu === 'episodes') {
              setMenu(null);
            } else {
              setMenu('episodes');
              setFocusArea('episodes');
              setEpisodeSubFocus('tiles');
              const targetEpIdx = Math.max(0, epIndex);
              setMenuCursor(targetEpIdx);
            }
          } else {
            if (menu === 'episodes') setMenu(null);
            const which = ctrlIndex === 0 ? 'subs' : ctrlIndex === 1 ? 'audio' : ctrlIndex === qualityCtrl ? 'quality' : 'settings';
            if (which === 'subs' && !hasSubtitles) {
              flash('Este contenido no cuenta con subtítulos');
              return;
            }
            setMenu(which);
            setMenuCursor(Math.max(0, rowsOf(which).findIndex(r => r.selected)));
          }
          return;
        }
        return;
      }

      // Focus Area 3: Timeline Progress Bar (Select on-screen jump buttons with ◄ ►)
      if (focusArea === 'timeline') {
        // On the timeline ◄ ► move the video (held: longer jumps)
        if (isLeft) {
          holdSeek(-1, e.repeat);
          return;
        }
        if (isRight) {
          holdSeek(1, e.repeat);
          return;
        }
        if (isEnter) {
          togglePause();
          setFocusArea('center');
          setCenterIndex(1);
          return;
        }
        if (isUp) {
          if (!isTrailer && ctrlCount > 0) {
            setFocusArea('controls');
            setCtrlIndex(hasEpisodeShelf ? 2 : 0);
          } else {
            setFocusArea('center');
            setCenterIndex(1);
          }
          return;
        }
        if (isDown) {
          if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
          setShowOsd(false);
          setOsdDismissed(true);
          return;
        }
        return;
      }
    };

    // Letting go of the key ends the hold: the next press starts again at 10 s
    const onKeyUp = (e: KeyboardEvent) => {
      if ([37, 39, 412, 417].indexOf(e.keyCode) >= 0) seekHoldRef.current.release();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
    };
  });

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const remainingTime = duration > 0 ? Math.max(0, duration - currentTime) : 0;
  const osdVisible = !!error || (!osdDismissed && showOsd);
  const osdVisibleRef = useRef(osdVisible);
  osdVisibleRef.current = osdVisible;
  // Every update while the timeline, a seek or the subtitles are on screen; once a second otherwise (showTime)
  fineTimeRef.current = osdVisible || subIndex >= 0 || !!seekHud || !!nextOffer;
  // Episodes only, long enough to have an intro, in their first minutes and with nothing else on screen
  const introOffer = !isTrailer && !!episode && !introDismissed && !nextOffer && !error && !menu && !osdVisible &&
    duration > 600 && currentTime >= INTRO_FROM_S && currentTime < INTRO_UNTIL_S;
  introOfferRef.current = introOffer;
  const subtitleText = subIndex >= 0 ? cueAt(cues, currentTime) : '';
  const subSize = settings.size === 1 ? 'is-large' : settings.size === 2 ? 'is-small' : '';
  const subStyle = settings.style === 1 ? 'is-yellow' : settings.style === 2 ? 'is-boxed' : '';
  const year = item.year && item.year !== '—' ? item.year : '';

  // Episode drawer horizontal scroll: 12 tiles fit comfortably in the 1776px wide visible area
  const totalEps = effectiveEpisodes.length;
  const maxScrollX = Math.max(0, totalEps * 144 - 1788);
  const targetScrollX = Math.max(0, Math.min(maxScrollX, menuCursor * 144 - 822));
  const trackTranslateX = -targetScrollX;

  return (
    <div className={`vod-fullscreen-player ${avMode ? 'is-avplay' : ''}`}>
      <video
        ref={videoRef}
        className="vod-fullscreen-video"
        style={{ objectFit: DISPLAY_FIT[settings.display] || 'contain' }}
        playsInline
        autoPlay
      />

      {isBuffering && !error && <div className="vod-player-spinner" />}

      {/* Subtitles Overlay */}
      <div
        className={`vp-subtitle ${osdVisible ? 'is-raised' : ''} ${subSize} ${subStyle}`}
        hidden={!subtitleText}
        style={{ display: subtitleText ? 'block' : 'none' }}
      >
        {subtitleText ? subtitleText.split('\n').map((line, i) => <div key={i}>{line}</div>) : null}
      </div>

      {/* Apple TV Frosted Glass Seek HUD */}
      {seekHud && (
        <div className="vp-seek-hud">
          <div className="vp-seek-icon">
            {seekHud.delta > 0 ? (
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
                <path d="m3 6 7 6-7 6V6Z m10 0 7 6-7 6V6Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
                <path d="M11 6 4 12l7 6V6Z M21 6l-7 6 7 6V6Z" />
              </svg>
            )}
          </div>
          <div className="vp-seek-content">
            <span className="vp-seek-delta">{formatSkip(seekHud.delta)}</span>
            <span className="vp-seek-target">
              {formatTime(seekHud.target)}
              {seekHud.duration > 0 ? ` / ${formatTime(seekHud.duration)}` : ''}
            </span>
          </div>
        </div>
      )}

      {/* Apple TV Frosted Toast for system notices (Audio, Subs) */}
      {osdMessage && !seekHud && (
        <div className="vp-hud-toast" key={toastId}>
          {osdMessage}
        </div>
      )}

      {/* A failed title shows its own artwork, dimmed and drifting slowly, instead of a black screen */}
      {error && errorArt && <div className="vod-player-error-art" style={{ backgroundImage: `url("${errorArt}")` }} />}
      {error && (
        <div className="vod-player-error">
          <div className="vod-player-error-title">{error}</div>
          {playerService.ispBlocked && !isTrailer && (
            <div className="vod-player-error-hint">
              Tu proveedor de internet bloquea los servidores de video. En la TV fija la IP y el DNS en manual a 1.1.1.1 o 8.8.8.8 (Configuración › General ›
              Red › Estado de la red › Configuración de IP) o prueba con otra red.
            </div>
          )}
          <div className="vod-player-error-keys">
            <span className="vod-player-error-key">OK</span><span>Reintentar</span>
            <span className="vod-player-error-key">VOLVER</span><span>Salir</span>
          </div>
        </div>
      )}

      {introOffer && (
        <div className="vod-next-button-wrap">
          <div className="vod-next-btn" onClick={() => { setIntroDismissed(true); seekBy(INTRO_SKIP_S); }}>
            <span className="vod-next-btn-icon">⏭</span>
            <span>Omitir intro</span>
          </div>
          <span className="vod-next-cancel-hint"><b>OK</b> salta 1:30 · <b>Atrás</b> para ocultar</span>
        </div>
      )}

      {/* Next episode: one button, over the credits (Back hides it) and after the end (Back leaves) */}
      {nextOffer && nextEpisode && (
        <div className="vod-next-button-wrap">
          <div className="vod-next-btn" onClick={playNext}>
            <span className="vod-next-btn-icon">▶</span>
            <span>Siguiente episodio{nextCountdown !== null ? ` en ${nextCountdown}` : ''}</span>
          </div>
          <span className="vod-next-cancel-hint">
            <b>Atrás</b> {nextOffer === 'credits' ? 'para seguir viendo' : 'para salir'}
          </span>
        </div>
      )}

      {/* Apple TV style overlay */}
      <div className={`vp-osd ${osdVisible ? 'is-visible' : ''}`}>
        {quality && !isTrailer && <div className="vp-badge">{quality}</div>}

        {/* With an error the center is the error box: OK retries and Back leaves, the round buttons would only cover it */}
        {!error && <div className="vp-center">
          <div
            className={`vp-round ${focusArea === 'center' && centerIndex === 0 ? 'is-focused' : ''}`}
            onClick={() => seekBy(-10)}
            title="Retroceder"
          >
            <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" aria-hidden="true">
              <path d="M11 6 4 12l7 6V6Z M21 6l-7 6 7 6V6Z" />
            </svg>
          </div>
          <div
            className={`vp-round vp-play ${focusArea === 'center' && centerIndex === 1 ? 'is-focused' : ''}`}
            onClick={togglePause}
            title={isPlaying ? 'Pausar' : 'Reproducir'}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor" aria-hidden="true">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="38" height="38" fill="currentColor" aria-hidden="true" style={{ marginLeft: 3 }}>
                <path d="M7 4v16l13-8L7 4Z" />
              </svg>
            )}
          </div>
          <div
            className={`vp-round ${focusArea === 'center' && centerIndex === 2 ? 'is-focused' : ''}`}
            onClick={() => seekBy(10)}
            title="Adelantar"
          >
            <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" aria-hidden="true">
              <path d="m3 6 7 6-7 6V6Z m10 0 7 6-7 6V6Z" />
            </svg>
          </div>
        </div>}

        <div className="vp-bottom">
          <div className="vp-info-row">
            <div className="vp-titles">
              {year && <div className="vp-year">{year}</div>}
              <div className="vp-title">{isTrailer ? `${item.title} — Tráiler` : item.title}</div>
              {!isTrailer && episode && <div className="vp-episode">{subtitle}</div>}
            </div>
            {!isTrailer && (
              <div className="vp-ctrls">
                <div
                  className={`vp-ctrl ${focusArea === 'controls' && ctrlIndex === 0 ? 'is-focused' : ''} ${subIndex >= 0 ? 'is-on' : ''} ${!hasSubtitles ? 'is-disabled' : ''}`}
                  title={hasSubtitles ? 'Subtítulos' : 'Sin subtítulos'}
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="5" width="18" height="14" rx="3" />
                    <path d="M7 13h4M13 13h4M7 16h7" />
                  </svg>
                  <span className="vp-ctrl-label">{hasSubtitles ? 'Subtítulos' : 'Sin subs'}</span>
                </div>
                <div
                  className={`vp-ctrl ${focusArea === 'controls' && ctrlIndex === 1 ? 'is-focused' : ''}`}
                  title="Audio"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
                  </svg>
                  <span className="vp-ctrl-label">Audio</span>
                </div>
                {hasEpisodeShelf && (
                  <div
                    className={`vp-ctrl ${focusArea === 'controls' && ctrlIndex === 2 ? 'is-focused' : ''} ${menu === 'episodes' ? 'is-on' : ''}`}
                    title="Episodios"
                  >
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="12" rx="2" />
                      <path d="M7 20h10" />
                    </svg>
                    <span className="vp-ctrl-label">Episodios</span>
                  </div>
                )}

                <div
                  className={`vp-ctrl ${focusArea === 'controls' && ctrlIndex === qualityCtrl ? 'is-focused' : ''} ${menu === 'quality' ? 'is-on' : ''}`}
                  title="Resolución"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="5" width="20" height="14" rx="2" />
                    <path d="M7 15V9M7 12h3M10 9v6M14 9v6h1.5a2.5 2.5 0 0 0 2.5-2.5v-1A2.5 2.5 0 0 0 15.5 9H14Z" />
                  </svg>
                  <span className="vp-ctrl-label">Resolución</span>
                </div>

                <div
                  className={`vp-ctrl ${focusArea === 'controls' && ctrlIndex === settingsCtrl ? 'is-focused' : ''} ${menu === 'settings' ? 'is-on' : ''}`}
                  title="Ajustes"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
                  </svg>
                  <span className="vp-ctrl-label">Ajustes</span>
                </div>

                {menu && menu !== 'episodes' && (
                  <div className={`vp-menu ${menu === 'audio' ? 'is-audio' : ''} ${menu === 'settings' || menu === 'quality' || menu === 'subs' ? 'is-settings' : ''} is-${menu}`}>
                    {menuRows.length === 0 && <div className="vp-menu-empty">No hay opciones</div>}
                    {menuRows.map((row, i) => (
                      <React.Fragment key={row.group + row.label + i}>
                        {(i === 0 || menuRows[i - 1].group !== row.group) && <div className="vp-menu-title">{row.group}</div>}
                        <div className={`vp-menu-row ${i === menuCursor ? 'is-focused' : ''}`}>
                          <span className="vp-check">{row.selected ? '✓' : ''}</span>
                          <span>{row.label}</span>
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {menu === 'episodes' && (
            <div className="vp-episodes">
              <div className="vp-episodes-header">
                <div className="vp-episodes-head-left">
                  <span className="vp-episodes-title">Episodios</span>
                  {currentSeasonNum && (
                    <div
                      className={`vp-episodes-season-pill ${focusArea === 'episodes' && episodeSubFocus === 'seasons' ? 'is-focused' : ''}`}
                      onClick={() => {
                        if (seasons && seasons.length > 1) {
                          const curIdx = seasons.findIndex(s => s.number === currentSeasonNum);
                          const nextIdx = (curIdx + 1) % seasons.length;
                          handleSwitchSeason(seasons[nextIdx]);
                        }
                      }}
                    >
                      <span>Temporada {currentSeasonNum}</span>
                      {seasons && seasons.length > 1 && <span className="vp-episodes-season-arrow">▾</span>}
                    </div>
                  )}
                </div>
                {effectiveEpisodes[menuCursor] && (
                  <div className="vp-episodes-caption">
                    <span className="vp-episodes-caption-num">
                      {currentSeasonNum ? `T${currentSeasonNum}:` : ''}E{effectiveEpisodes[menuCursor].number || menuCursor + 1}
                    </span>
                    <span className="vp-episodes-caption-title">
                      {effectiveEpisodes[menuCursor].title || effectiveEpisodes[menuCursor].name || `Capítulo ${menuCursor + 1}`}
                    </span>
                    {effectiveEpisodes[menuCursor].duration && (
                      <span className="vp-episodes-caption-meta">· {effectiveEpisodes[menuCursor].duration}</span>
                    )}
                  </div>
                )}
              </div>

              <div className="vp-episodes-track">
                <div
                  className="vod-episodes-slider is-tiles"
                  style={{
                    transform: `translateX(${trackTranslateX}px)`
                  }}
                >
                  {effectiveEpisodes.map((ep, epIdx) => {
                    const isFocused = focusArea === 'episodes' && episodeSubFocus === 'tiles' && epIdx === menuCursor;
                    const isCurrent = epIdx === epIndex;
                    const st = episodeStatuses[epIdx];
                    const isWatched = st ? st.isWatched : epIdx < epIndex;
                    const progress = isCurrent ? progressPercent : (st ? st.progressPercent : 0);

                    return (
                      <div
                        key={ep.id || epIdx}
                        className={`vod-ep-tile ${isFocused ? 'is-focused' : ''} ${isCurrent ? 'is-current' : ''} ${
                          isWatched ? 'is-watched' : ''
                        }`}
                        onClick={() => {
                          setMenu(null);
                          setFocusArea('timeline');
                          if (onPlayEpisode && epIdx !== epIndex) onPlayEpisode(ep, currentSeasonNum);
                        }}
                      >
                        {isCurrent && <span className="vod-ep-tile-play">▶</span>}
                        <span className="vod-ep-tile-num">{ep.number || epIdx + 1}</span>
                        {isWatched && <span className="vod-ep-tile-check">✓</span>}
                        {progress > 0 && !isWatched && (
                          <div className="vod-ep-tile-progress">
                            <div style={{ width: `${progress}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="vp-progress-row">
            <span className={`vp-time ${focusArea === 'timeline' && !menu ? 'is-focused' : ''}`}>{formatTime(currentTime)}</span>
            <div className={`vp-track ${focusArea === 'timeline' && !menu ? 'is-focused' : ''}`}>
              {/* Moved with transform (the TV's compositor animates it between updates): the bar glides
                  while seeking instead of jumping at each re-render */}
              <div className="vp-fill" style={{ transform: `scaleX(${progressPercent / 100})` }} />
              <div className="vp-thumb-rail" style={{ transform: `translateX(${progressPercent}%)` }}>
                <div className="vp-thumb" />
              </div>
            </div>
            <span className="vp-time">−{formatTime(remainingTime)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
