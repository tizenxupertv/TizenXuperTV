import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { VodItem, VodEpisode } from '../types/vod';
import { historyService } from '../services/historyService';
import { playerService } from '../services/playerService';
import { catalogService } from '../services/catalogService';
import { getEpisodeStatus } from '../lib/vodResume';
import { scrollHorizontalSlider } from '../utils/scrollHelper';
import { logPlayback, setPlaybackContext } from '../lib/playbackLog';
import { createSeekHold, formatSkip } from '../lib/seekAccel';
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
  onPlayEpisode?: (episode: VodEpisode) => void;
  onClose: () => void;
}

// Demo video only for local development; a real TV build never plays it
const DEV_FALLBACK_URL = 'https://media.w3.org/2010/05/bunny/movie.mp4';
const SAVE_EVERY_MS = 15000;
const NEXT_EPISODE_SECONDS = 10;

interface SettingRow {
  group: string;
  label: string;
  selected: boolean;
  apply: () => void;
}

// Same order as PlaybackSettings.display and the bridge's _displayMethod
const DISPLAY_METHODS = ['PLAYER_DISPLAY_MODE_LETTER_BOX', 'PLAYER_DISPLAY_MODE_FULL_SCREEN', 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO'];
const DISPLAY_LABELS = ['Ajustar (con bandas)', 'Pantalla completa', 'Automático'];
const DISPLAY_FIT = ['contain', 'cover', 'contain'] as const;
const SUB_SIZE_LABELS = ['Normal', 'Grande', 'Pequeño'];
const SUB_STYLE_LABELS = ['Blanco', 'Amarillo', 'Con fondo'];

interface AudioOption {
  kind: 'avplay' | 'portal';
  index: number;
  label: string;
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
function hasAvPlay(): boolean {
  return !!(window.XuperAVPlay && window.webapis && window.webapis.avplay);
}

export const VodPlayerFullscreen: React.FC<VodPlayerFullscreenProps> = ({
  item,
  episode,
  isTrailer,
  startAt = 0,
  seriesId,
  seasonNumber,
  episodes = [],
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
  const osdTimerRef = useRef<any>(null);
  const useAvPlayRef = useRef<boolean>(false);
  const requestIdRef = useRef<number>(0);
  const timeRef = useRef({ t: 0, d: 0 });
  const startedAtRef = useRef<number>(startAt);

  const [streamInfoText, setStreamInfoText] = useState<string>('');
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
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
  const [menu, setMenu] = useState<null | 'subs' | 'audio' | 'episodes' | 'settings'>(null);
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

  const EP_RANGE = 20;
  const epIndex = episode ? effectiveEpisodes.findIndex(ep => String(ep.id) === String(episode.id)) : -1;
  const currentEpIndex = epIndex >= 0 ? epIndex : 0;
  const totalRanges = Math.ceil(effectiveEpisodes.length / EP_RANGE);
  const currentRangeIdx = Math.floor(currentEpIndex / EP_RANGE);

  const [activeRange, setActiveRange] = useState<number>(() => currentRangeIdx);
  const [rangeCursor, setRangeCursor] = useState<number>(() => currentRangeIdx);
  const [episodeSubFocus, setEpisodeSubFocus] = useState<'tiles' | 'ranges'>('tiles');
  const vpRangesRef = useRef<HTMLDivElement>(null);

  // Sync initial range when currentEpIndex or effectiveEpisodes changes
  useEffect(() => {
    const r = Math.floor(currentEpIndex / EP_RANGE);
    setActiveRange(r);
    setRangeCursor(r);
  }, [currentEpIndex]);

  // History & episode statuses (watched, progress, current)
  const historyEntry = historyService.getEntry(item.id);
  const episodeStatuses = useMemo(() => {
    return effectiveEpisodes.map((ep, idx) =>
      getEpisodeStatus(ep, idx, historyEntry, seasonNumber)
    );
  }, [effectiveEpisodes, historyEntry, seasonNumber]);

  const rangeStart = activeRange * EP_RANGE;
  const rangeEnd = Math.min(effectiveEpisodes.length, rangeStart + EP_RANGE);

  // Ranges row auto-scroll
  useEffect(() => {
    if (menu === 'episodes' && vpRangesRef.current) {
      const track = vpRangesRef.current;
      const target = track.children[activeRange] as HTMLElement | undefined;
      if (track && target && typeof scrollHorizontalSlider === 'function') {
        scrollHorizontalSlider(track, target, activeRange, 0, 160);
      }
    }
  }, [menu, activeRange]);

  const nextEpisode = epIndex !== -1 && epIndex + 1 < effectiveEpisodes.length ? effectiveEpisodes[epIndex + 1] : undefined;
  // Episode shelf (like Apple TV): the other episodes of the season, without leaving the player
  const hasEpisodeShelf = !isTrailer && !!onPlayEpisode && effectiveEpisodes.length > 1;
  const settingsCtrl = hasEpisodeShelf ? 3 : 2;
  const ctrlCount = settingsCtrl + 1;
  const epNumber = episode ? (episode.number || epIndex + 1 || 1) : 0;

  const title = isTrailer ? `${item.title} — Tráiler Oficial` : item.title;
  const subtitle = !isTrailer && episode
    ? `${seasonNumber ? `T${seasonNumber}:` : ''}E${epNumber} · ${episode.title || episode.name || 'Capítulo'}`
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
    if (t < 1) return;
    historyService.savePlayback(item, t, d, episode, false, { id: seriesId, number: seasonNumber });
  }, [isTrailer, item, episode, seriesId, seasonNumber]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (isPlaying) saveProgress();
    }, SAVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [isPlaying, saveProgress]);

  const handleEnded = useCallback(() => {
    if (!isTrailer) {
      timeRef.current.t = timeRef.current.d || timeRef.current.t;
      saveProgress();
    }
    if (nextEpisode && onPlayEpisode && !isTrailer) {
      setNextCountdown(NEXT_EPISODE_SECONDS);
    } else {
      onClose();
    }
  }, [isTrailer, nextEpisode, onPlayEpisode, onClose, saveProgress]);

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
    if (nextCountdown === null) return;
    if (nextCountdown <= 0) {
      setNextCountdown(null);
      if (nextEpisode && onPlayEpisode) onPlayEpisode(nextEpisode);
      return;
    }
    const t = setTimeout(() => setNextCountdown(c => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [nextCountdown, nextEpisode, onPlayEpisode]);

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
    startedAtRef.current = retryTick > 0 ? timeRef.current.t : startAt;

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
      console.log('[VodPlayer] AVPlay open', res.mime, String(res.url).slice(0, 60), 'startAt=' + startedAtRef.current);
      // If resuming at an offset, ignore initial 0s updates until seek settles
      if (startedAtRef.current > 5) {
        pendingSeekRef.current = { target: startedAtRef.current, until: Date.now() + 6000 };
      }
      // tizen-bridge reads backup CDNs from here when a stream fails
      window.__xuperCurrentStreamMeta = res;
      video.onloadedmetadata = () => {
        console.log('[VodPlayer] AVPlay prepared, duration=' + window.XuperAVPlay.durationSec);
        if (!isCurrent()) return;
        const d = window.XuperAVPlay.durationSec || res.duration || 0;
        timeRef.current.d = d;
        setDuration(d);
        if (startedAtRef.current > 5) window.XuperAVPlay.seekTo(startedAtRef.current);
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
            const prefCode = PREF_LANG_CODES[settingsService.get().audio] || 'es';
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
        timeRef.current.t = t;
        setCurrentTime(t);
      };
      video.onwaiting = () => isCurrent() && setIsBuffering(true);
      video.onplaying = () => {
        console.log('[VodPlayer] AVPlay playing');
        if (!isCurrent()) return;
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
      if (err || !res || !res.url) {
        failed((err && err.message) || 'No se pudo obtener el video del portal.');
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
      if (hasAvPlay()) {
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
      setCurrentTime(video.currentTime);
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
          videoRef.current.play();
        }
      };

      if (useAvPlayRef.current && window.XuperAVPlay) {
        window.XuperAVPlay.seekTo(target, onSeekDone, (err: any) => {
          logPlayback({ kind: 'error', player: 'AVPlay', detail: `seek ${Math.round(target)} s: ${(err && (err.name || err.message)) || err}` });
          if (!shouldResume) {
            flash('No se pudo mover el video a ese punto');
          }
        });
      } else if (videoRef.current) {
        videoRef.current.currentTime = target;
        onSeekDone();
      }
      if (pendingSeekRef.current) pendingSeekRef.current.until = Date.now() + 2500;
    }, 180);
  };

  // Player time updates while a seek is pending / settling
  const acceptTime = (t: number): boolean => {
    const pending = pendingSeekRef.current;
    if (!pending) return true;
    const reached = Math.abs(t - pending.target) < 3;
    const expired = pending.until > 0 && Date.now() > pending.until;
    if (reached || expired) {
      pendingSeekRef.current = null;
      return true;
    }
    return false;
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
  const settingRows: SettingRow[] = [
    // 1. Formato de pantalla (Siempre aplica a cualquier video)
    ...DISPLAY_LABELS.map((label, i) => ({
      group: 'Formato de pantalla',
      label,
      selected: settings.display === i,
      apply: () => applyDisplay(i)
    })),

    // 2. Opciones de Series (sólo si es una serie con episodios)
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
    ] : []),

    // 3. Estilo y tamaño de subtítulos (SOLO si el contenido actual tiene subtítulos disponibles)
    ...(hasSubtitles ? [
      ...SUB_SIZE_LABELS.map((label, i) => ({
        group: 'Tamaño de subtítulos',
        label,
        selected: settings.size === i,
        apply: () => settingsService.set({ size: i })
      })),
      ...SUB_STYLE_LABELS.map((label, i) => ({
        group: 'Estilo de subtítulos',
        label,
        selected: settings.style === i,
        apply: () => settingsService.set({ style: i })
      }))
    ] : [])
  ];
  const menuRows = menu === 'subs' ? subRows : menu === 'settings' ? settingRows : audioRows;

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
        holdSeek(isFastForward ? 1 : -1, e.repeat);
        return;
      }

      // "Next episode" card
      if (nextCountdown !== null) {
        if (isEnter && nextEpisode && onPlayEpisode) {
          setNextCountdown(null);
          onPlayEpisode(nextEpisode);
        } else if (isBack) {
          setNextCountdown(null);
          onClose();
        }
        return;
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
          setFocusArea('timeline');
          holdSeek(isRight ? 1 : -1, e.repeat);
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

        // Sub-focus 1: RANGES ROW (1-20, 21-40, 41-60...)
        if (episodeSubFocus === 'ranges') {
          if (isLeft) {
            setRangeCursor(r => {
              const next = Math.max(0, r - 1);
              setActiveRange(next);
              setMenuCursor(next * EP_RANGE);
              return next;
            });
            return;
          }
          if (isRight) {
            setRangeCursor(r => {
              const next = Math.min(totalRanges - 1, r + 1);
              setActiveRange(next);
              setMenuCursor(next * EP_RANGE);
              return next;
            });
            return;
          }
          if (isDown || isEnter) {
            setEpisodeSubFocus('tiles');
            setMenuCursor(activeRange * EP_RANGE);
            return;
          }
          if (isUp) {
            setFocusArea('center');
            setCenterIndex(1);
            return;
          }
          return;
        }

        // Sub-focus 2: TILES ROW (the 20 tiles)
        if (isLeft) {
          if (menuCursor > rangeStart) {
            setMenuCursor(c => c - 1);
          } else if (activeRange > 0) {
            const nextRange = activeRange - 1;
            setActiveRange(nextRange);
            setRangeCursor(nextRange);
            setMenuCursor(Math.min(effectiveEpisodes.length - 1, (nextRange + 1) * EP_RANGE - 1));
          }
          return;
        }

        if (isRight) {
          if (menuCursor < rangeEnd - 1) {
            setMenuCursor(c => c + 1);
          } else if (activeRange < totalRanges - 1) {
            const nextRange = activeRange + 1;
            setActiveRange(nextRange);
            setRangeCursor(nextRange);
            setMenuCursor(nextRange * EP_RANGE);
          }
          return;
        }

        if (isUp) {
          if (totalRanges > 1) {
            setEpisodeSubFocus('ranges');
            setRangeCursor(activeRange);
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
          if (ep && onPlayEpisode && menuCursor !== epIndex) onPlayEpisode(ep);
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
          if (menu === 'settings') {
            const row = settingRows[menuCursor];
            if (row) {
              row.apply();
              setSettingsTick(t => t + 1);
            }
            return;
          }
          const row = (menu === 'subs' ? subRows : audioRows)[menuCursor];
          if (row) {
            if (menu === 'subs') chooseSubtitle(row.value);
            else chooseAudio(row.value);
          }
          setMenu(null);
          setFocusArea('controls');
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
        if (isLeft) {
          setCenterIndex(i => Math.max(0, i - 1));
          return;
        }
        if (isRight) {
          setCenterIndex(i => Math.min(2, i + 1));
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
            if (totalRanges > 1) {
              setEpisodeSubFocus('ranges');
              setRangeCursor(activeRange);
            } else {
              setEpisodeSubFocus('tiles');
            }
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
          if (ctrlIndex === settingsCtrl) {
            if (menu === 'episodes') setMenu(null);
            setMenu('settings');
            setMenuCursor(Math.max(0, settingRows.findIndex(r => r.selected)));
          } else if (hasEpisodeShelf && ctrlIndex === 2) {
            if (menu === 'episodes') {
              setMenu(null);
            } else {
              setMenu('episodes');
              setFocusArea('episodes');
              setEpisodeSubFocus('tiles');
              const targetEpIdx = Math.max(0, epIndex);
              setMenuCursor(targetEpIdx);
              const r = Math.floor(targetEpIdx / EP_RANGE);
              setActiveRange(r);
              setRangeCursor(r);
            }
          } else {
            if (menu === 'episodes') setMenu(null);
            const which = ctrlIndex === 0 ? 'subs' : 'audio';
            if (which === 'subs' && !hasSubtitles) {
              flash('Este contenido no cuenta con subtítulos');
              return;
            }
            const rows = which === 'subs' ? subRows : audioRows;
            const current = which === 'subs' ? subIndex : audioIndex;
            setMenu(which);
            setMenuCursor(Math.max(0, rows.findIndex(r => r.value === current)));
          }
          return;
        }
        return;
      }

      // Focus Area 3: Timeline Progress Bar (Direct scrubbing with ◄ ►)
      if (focusArea === 'timeline') {
        if (isLeft || isRight) {
          holdSeek(isRight ? 1 : -1, e.repeat);
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

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const remainingTime = duration > 0 ? Math.max(0, duration - currentTime) : 0;
  const osdVisible = !!error || (!osdDismissed && showOsd);
  const osdVisibleRef = useRef(osdVisible);
  osdVisibleRef.current = osdVisible;
  const subtitleText = subIndex >= 0 ? cueAt(cues, currentTime) : '';
  const subSize = settings.size === 1 ? 'is-large' : settings.size === 2 ? 'is-small' : '';
  const subStyle = settings.style === 1 ? 'is-yellow' : settings.style === 2 ? 'is-boxed' : '';
  const year = item.year && item.year !== '—' ? item.year : '';

  // Episode drawer horizontal scroll: 12 tiles fit comfortably in the 1824px wide container
  const rangeCount = rangeEnd - rangeStart;
  const idxInBlock = Math.max(0, Math.min(rangeCount - 1, menuCursor - rangeStart));
  const VISIBLE_TILES = 12;
  const maxScrollTiles = Math.max(0, rangeCount - VISIBLE_TILES);
  const scrollTiles = Math.min(maxScrollTiles, Math.max(0, idxInBlock - 6));
  const trackTranslateX = -(scrollTiles * 144);

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

      {subtitleText && (
        <div className={`vp-subtitle ${osdVisible ? 'is-raised' : ''} ${subSize} ${subStyle}`}>
          {subtitleText.split('\n').map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

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

      {error && (
        <div className="vod-player-error">
          <div className="vod-player-error-title">{error}</div>
          {playerService.ispBlocked && !isTrailer && (
            <div className="vod-player-error-hint">
              Tu proveedor de internet bloquea los servidores de video. Cambia el DNS de la TV a 1.1.1.1 (Configuración › General ›
              Red › Estado de la red › Configuración de IP › Configuración de DNS) o prueba con otra red.
            </div>
          )}
          <div className="vod-player-error-keys">
            <span className="vod-player-error-key">OK</span><span>Reintentar</span>
            <span className="vod-player-error-key">VOLVER</span><span>Salir</span>
          </div>
        </div>
      )}

      {/* Apple TV Style Next Episode Card */}
      {nextCountdown !== null && nextEpisode && (
        <div className="vod-next-episode">
          <div className="vod-next-progress-track">
            <div
              className="vod-next-progress-fill"
              style={{ width: `${Math.max(0, Math.min(100, ((NEXT_EPISODE_SECONDS - nextCountdown) / NEXT_EPISODE_SECONDS) * 100))}%` }}
            />
          </div>
          <div className="vod-next-inner">
            <div
              className="vod-next-thumb"
              style={{
                backgroundImage: `url('${nextEpisode.picture || item.backdrop || item.landscape || 'assets/placeholder_landscape.png'}')`
              }}
            >
              <div className="vod-next-play-icon">▶</div>
            </div>
            <div className="vod-next-info">
              <div className="vod-next-badge-row">
                <span className="vod-next-tag">SIGUIENTE EPISODIO</span>
                <span className="vod-next-timer">en {nextCountdown}s</span>
              </div>
              <div className="vod-next-title">
                {seasonNumber ? `T${seasonNumber}:` : ''}E{nextEpisode.number || epIndex + 2} · {nextEpisode.title || nextEpisode.name || 'Capítulo'}
              </div>
              <div className="vod-next-btn-row">
                <div
                  className="vod-next-btn"
                  onClick={() => {
                    setNextCountdown(null);
                    if (onPlayEpisode) onPlayEpisode(nextEpisode);
                  }}
                >
                  <span>▶ Ver ahora</span>
                  <span className="vod-next-btn-key">OK</span>
                </div>
                <span className="vod-next-cancel-hint">VOLVER Salir</span>
              </div>
            </div>
          </div>
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
                  className={`vp-ctrl ${focusArea === 'controls' && ctrlIndex === settingsCtrl ? 'is-focused' : ''} ${menu === 'settings' ? 'is-on' : ''}`}
                  title="Ajustes"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
                  </svg>
                  <span className="vp-ctrl-label">Ajustes</span>
                </div>

                {menu === 'settings' && (
                  <div className="vp-menu is-settings">
                    {settingRows.map((row, i) => (
                      <React.Fragment key={row.group + row.label}>
                        {(i === 0 || settingRows[i - 1].group !== row.group) && <div className="vp-menu-title">{row.group}</div>}
                        <div className={`vp-menu-row ${i === menuCursor ? 'is-focused' : ''}`}>
                          <span className="vp-check">{row.selected ? '✓' : ''}</span>
                          <span>{row.label}</span>
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                )}

                {menu && menu !== 'episodes' && menu !== 'settings' && (
                  <div className={`vp-menu ${menu === 'audio' ? 'is-audio' : ''}`}>
                    <div className="vp-menu-title">{menu === 'subs' ? 'Subtítulos' : 'Audio'}</div>
                    {menuRows.length === 0 && <div className="vp-menu-empty">No hay opciones</div>}
                    {menuRows.map((row, i) => {
                      const selected = menu === 'subs' ? row.value === subIndex : row.value === audioIndex;
                      return (
                        <div key={row.label + i} className={`vp-menu-row ${i === menuCursor ? 'is-focused' : ''}`}>
                          <span className="vp-check">{selected ? '✓' : ''}</span>
                          <span>{row.label}</span>
                        </div>
                      );
                    })}
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
                  {seasonNumber && (
                    <div className="vp-episodes-season-pill">
                      <span>Temporada {seasonNumber}</span>
                      <span className="vp-episodes-season-arrow">▾</span>
                    </div>
                  )}
                </div>
                {effectiveEpisodes[menuCursor] && (
                  <div className="vp-episodes-caption">
                    <span className="vp-episodes-caption-num">
                      {seasonNumber ? `T${seasonNumber}:` : ''}E{effectiveEpisodes[menuCursor].number || menuCursor + 1}
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

              {totalRanges > 1 && (
                <div className="vod-ep-ranges-clip">
                  <div className="vod-ep-ranges" ref={vpRangesRef}>
                    {Array.from({ length: totalRanges }, (_, r) => {
                      const from = r * EP_RANGE + 1;
                      const to = Math.min(effectiveEpisodes.length, (r + 1) * EP_RANGE);
                      const isRangeActive = r === activeRange;
                      const isRangeFocused = focusArea === 'episodes' && episodeSubFocus === 'ranges' && rangeCursor === r;
                      const hasCurrentEp = r === currentRangeIdx;
                      return (
                        <div
                          key={r}
                          className={`vod-ep-range ${isRangeActive ? 'is-active' : ''} ${hasCurrentEp ? 'has-current' : ''} ${
                            isRangeFocused ? 'is-focused' : ''
                          }`}
                          onClick={() => {
                            setActiveRange(r);
                            setRangeCursor(r);
                            setFocusArea('episodes');
                            setEpisodeSubFocus('tiles');
                            setMenuCursor(r * EP_RANGE);
                          }}
                        >
                          {from}-{to}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="vp-episodes-track">
                <div
                  className="vod-episodes-slider is-tiles"
                  style={{
                    transform: `translateX(${trackTranslateX}px)`
                  }}
                >
                  {effectiveEpisodes.slice(rangeStart, rangeEnd).map((ep, j) => {
                    const epIdx = rangeStart + j;
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
                          if (onPlayEpisode && epIdx !== epIndex) onPlayEpisode(ep);
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
              <div className="vp-fill" style={{ width: `${progressPercent}%` }} />
              <div className="vp-thumb" style={{ left: `${progressPercent}%` }} />
            </div>
            <span className="vp-time">−{formatTime(remainingTime)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
