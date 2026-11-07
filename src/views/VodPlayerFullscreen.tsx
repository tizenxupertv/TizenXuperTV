import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VodItem, VodEpisode } from '../types/vod';
import { historyService } from '../services/historyService';
import { playerService } from '../services/playerService';
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
  // Remote focus: the three center buttons (-10 / play / +10) or the bottom-right buttons
  const [focusArea, setFocusArea] = useState<'center' | 'timeline' | 'controls'>('center');
  const [centerIndex, setCenterIndex] = useState<number>(1);
  const [ctrlIndex, setCtrlIndex] = useState<number>(0); // 0 = subtitles, 1 = audio, then episodes (series) and settings
  const [menu, setMenu] = useState<null | 'subs' | 'audio' | 'episodes' | 'settings'>(null);
  const [menuCursor, setMenuCursor] = useState<number>(0);
  const [toastId, setToastId] = useState<number>(0);
  const portalTrackRef = useRef<number>(0);
  const subsInitRef = useRef<boolean>(false);
  const audioPrefAppliedRef = useRef<boolean>(false);
  const pendingSeekRef = useRef<{ target: number; until: number } | null>(null);
  const seekTimerRef = useRef<any>(null);
  const acceptTimeRef = useRef<(t: number) => boolean>(() => true);
  const toastTimerRef = useRef<any>(null);
  const [, setSettingsTick] = useState(0); // re-render after a setting changes
  const settings = settingsService.get();

  const epIndex = episode ? episodes.findIndex(ep => String(ep.id) === String(episode.id)) : -1;
  const nextEpisode = epIndex !== -1 && epIndex + 1 < episodes.length ? episodes[epIndex + 1] : undefined;
  // Episode shelf (like Apple TV): the other episodes of the season, without leaving the player
  const hasEpisodeShelf = !isTrailer && !!onPlayEpisode && episodes.length > 1;
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

  // Trigger OSD visibility timeout (4.5 seconds)
  const triggerOsd = useCallback(() => {
    setOsdDismissed(false);
    setShowOsd(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      setShowOsd(false);
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
        const byAudio = tracksNow.filter(t => sameLanguage(t.audio, prefCode));
        const pool = byAudio.length ? byAudio : (qWanted ? tracksNow : []);
        const wanted = pool.length
          ? (qWanted && pool.find(t => String(t.quality || '').indexOf(qWanted) !== -1)) || pool[0]
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
  // seek (slow on AVPlay) is sent once, 350 ms after the last press. Until the player reaches the
  // target, its time updates are ignored so the bar does not jump back.
  const accumulatedSkipRef = useRef(0);
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

    // Feedback with the total of this burst of presses (+10 s, +1:30, −5:00)
    accumulatedSkipRef.current += delta;
    flash(`${accumulatedSkipRef.current > 0 ? '⏩' : '⏪'} ${formatSkip(accumulatedSkipRef.current)}`);

    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = setTimeout(() => {
      seekTimerRef.current = null;
      accumulatedSkipRef.current = 0;
      if (useAvPlayRef.current && window.XuperAVPlay) {
        window.XuperAVPlay.seekTo(target, undefined, (err: any) => {
          // The player refused the jump: say so (the bar goes back to where the video is) and leave a trace for support
          flash('No se pudo mover el video a ese punto');
          logPlayback({ kind: 'error', player: 'AVPlay', detail: `seek ${Math.round(target)} s: ${(err && (err.name || err.message)) || err}` });
        });
      } else if (videoRef.current) {
        videoRef.current.currentTime = target;
      }
      if (pendingSeekRef.current) pendingSeekRef.current.until = Date.now() + 2500;
    }, 350);
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
  useEffect(() => () => { if (seekTimerRef.current) clearTimeout(seekTimerRef.current); }, []);

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
  // Playback settings (also in Perfil > Configuración): screen format and subtitle look
  const applyDisplay = (idx: number) => {
    settingsService.set({ display: idx });
    if (avMode) {
      try { window.webapis.avplay.setDisplayMethod(DISPLAY_METHODS[idx]); } catch (e) {}
    }
  };
  const settingRows: SettingRow[] = [
    ...DISPLAY_LABELS.map((label, i) => ({ group: 'Formato de pantalla', label, selected: settings.display === i, apply: () => applyDisplay(i) })),
    ...SUB_SIZE_LABELS.map((label, i) => ({ group: 'Tamaño de subtítulos', label, selected: settings.size === i, apply: () => settingsService.set({ size: i }) })),
    ...SUB_STYLE_LABELS.map((label, i) => ({ group: 'Estilo de subtítulos', label, selected: settings.style === i, apply: () => settingsService.set({ style: i }) }))
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
        triggerOsd();
        return;
      }
      if (isPause) {
        if (isPlaying) togglePause();
        triggerOsd();
        return;
      }
      if (isPlayPause) {
        togglePause();
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

      // Back hides the overlay first (closing an open menu), and leaves the player once it is hidden
      if (isBack && !error) {
        if (menu) {
          setMenu(null);
          triggerOsd();
        } else if (osdVisibleRef.current) {
          if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
          setShowOsd(false);
          setOsdDismissed(true);
          setFocusArea('center');
        } else {
          onClose();
        }
        return;
      }

      // First key while the overlay is hidden only brings it back (OK still pauses at once)
      const wasHidden = !osdVisibleRef.current;
      triggerOsd();

      // Episode shelf: ◄ ► choose, OK plays, ▲ closes
      if (menu === 'episodes') {
        if (isLeft) setMenuCursor(c => Math.max(0, c - 1));
        else if (isRight) setMenuCursor(c => Math.min(episodes.length - 1, c + 1));
        else if (isUp) setMenu(null);
        else if (isEnter) {
          const ep = episodes[menuCursor];
          setMenu(null);
          if (ep && onPlayEpisode && menuCursor !== epIndex) onPlayEpisode(ep);
        }
        return;
      }

      // Audio / subtitles menu
      if (menu) {
        if (isBack || isLeft) setMenu(null);
        else if (isUp) setMenuCursor(c => Math.max(0, c - 1));
        else if (isDown) setMenuCursor(c => Math.min(menuRows.length - 1, c + 1));
        else if (isEnter) {
          if (menu === 'settings') {
            // Settings stay open so the check mark moves to the new choice
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
        }
        return;
      }

      // Focus order follows the screen, top to bottom: center buttons, controls row, timeline
      // Timeline (bottom): ◄ ► scrub (hold for bigger jumps), OK pauses, ▲ goes to the controls row
      if (focusArea === 'timeline') {
        if (isBack) onClose();
        else if (isLeft || isRight) holdSeek(isRight ? 1 : -1, e.repeat);
        else if (isEnter) togglePause();
        else if (isUp) setFocusArea(isTrailer ? 'center' : 'controls');
        return;
      }

      // Controls row above the timeline (Subtítulos / Audio / Episodios)
      if (focusArea === 'controls') {
        if (isBack) setFocusArea('center');
        else if (isUp) setFocusArea('center');
        else if (isDown) setFocusArea('timeline');
        else if (isLeft) setCtrlIndex(i => Math.max(0, i - 1));
        else if (isRight) setCtrlIndex(i => Math.min(ctrlCount - 1, i + 1));
        else if (isEnter && ctrlIndex === settingsCtrl) {
          setMenu('settings');
          setMenuCursor(Math.max(0, settingRows.findIndex(r => r.selected)));
        } else if (isEnter && ctrlIndex === 2) {
          setMenu('episodes');
          setMenuCursor(Math.max(0, epIndex));
        } else if (isEnter) {
          const which = ctrlIndex === 0 ? 'subs' : 'audio';
          const rows = which === 'subs' ? subRows : audioRows;
          const current = which === 'subs' ? subIndex : audioIndex;
          setMenu(which);
          setMenuCursor(Math.max(0, rows.findIndex(r => r.value === current)));
        }
        return;
      }

      if (isBack) {
        onClose();
        return;
      }

      if (error) {
        if (isEnter) setRetryTick(t => t + 1);
        return;
      }

      // While watching (controls hidden), ◄ ► seek right away, as on any TV player; the timeline keeps the focus
      if (wasHidden && (isLeft || isRight)) {
        setFocusArea('timeline');
        holdSeek(isRight ? 1 : -1, e.repeat);
        return;
      }
      if (wasHidden && !isEnter) return;

      // Center buttons: ◄ ► move between them, OK presses the focused one
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
        else if (centerIndex === 2) seekBy(10);
        else togglePause();
        return;
      }
      if (isDown) {
        if (isTrailer) setFocusArea('timeline');
        else {
          setFocusArea('controls');
          setCtrlIndex(0);
        }
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
  const osdVisible = !!error || (!osdDismissed && (showOsd || !isPlaying || !!menu || focusArea === 'controls'));
  const osdVisibleRef = useRef(osdVisible);
  osdVisibleRef.current = osdVisible;
  const subtitleText = subIndex >= 0 ? cueAt(cues, currentTime) : '';
  const subSize = settings.size === 1 ? 'is-large' : settings.size === 2 ? 'is-small' : '';
  const subStyle = settings.style === 1 ? 'is-yellow' : settings.style === 2 ? 'is-boxed' : '';
  const year = item.year && item.year !== '—' ? item.year : '';

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

      {/* Center feedback on seek / pause (disappears on its own) */}
      {osdMessage && (
        <div className="player-center-toast" key={toastId}>
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
          <div className="vod-player-error-hint">OK Reintentar · VOLVER Salir</div>
        </div>
      )}

      {nextCountdown !== null && nextEpisode && (
        <div className="vod-next-episode">
          <div className="vod-next-label">Siguiente episodio en {nextCountdown} s</div>
          <div className="vod-next-title">
            {seasonNumber ? `T${seasonNumber}:` : ''}E{nextEpisode.number || epIndex + 2} · {nextEpisode.title || nextEpisode.name || 'Capítulo'}
          </div>
          <div className="vod-next-hint">OK Ver ahora · VOLVER Salir</div>
        </div>
      )}

      {/* Apple TV style overlay */}
      <div className={`vp-osd ${osdVisible ? 'is-visible' : ''}`}>
        {quality && !isTrailer && <div className="vp-badge">{quality}</div>}

        <div className="vp-center">
          <div
            className={`vp-round ${focusArea === 'center' && !menu && centerIndex === 0 ? 'is-focused' : ''}`}
            onClick={() => seekBy(-10)}
          >
            <span className="vp-skip">↺</span>
            <span className="vp-skip-num">10</span>
          </div>
          <div
            className={`vp-round vp-play ${focusArea === 'center' && !menu && centerIndex === 1 ? 'is-focused' : ''}`}
            onClick={togglePause}
          >
            {isPlaying ? '❚❚' : '▶'}
          </div>
          <div
            className={`vp-round ${focusArea === 'center' && !menu && centerIndex === 2 ? 'is-focused' : ''}`}
            onClick={() => seekBy(10)}
          >
            <span className="vp-skip">↻</span>
            <span className="vp-skip-num">10</span>
          </div>
        </div>

        <div className="vp-bottom">
          <div className="vp-info-row">
            <div className="vp-titles">
              {year && <div className="vp-year">{year}</div>}
              <div className="vp-title">{isTrailer ? `${item.title} — Tráiler` : item.title}</div>
              {!isTrailer && episode && <div className="vp-episode">{subtitle}</div>}
            </div>
            {!isTrailer && (
              <div className="vp-ctrls">
                <div className={`vp-ctrl ${focusArea === 'controls' && ctrlIndex === 0 ? 'is-focused' : ''} ${subIndex >= 0 ? 'is-on' : ''}`} title="Subtítulos">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="5" width="18" height="14" rx="3" />
                    <path d="M7 13h4M13 13h4M7 16h7" />
                  </svg>
                </div>
                <div className={`vp-ctrl ${focusArea === 'controls' && ctrlIndex === 1 ? 'is-focused' : ''}`} title="Audio">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
                  </svg>
                </div>
                {hasEpisodeShelf && (
                  <div className={`vp-ctrl ${focusArea === 'controls' && ctrlIndex === 2 ? 'is-focused' : ''} ${menu === 'episodes' ? 'is-on' : ''}`} title="Episodios">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="12" rx="2" />
                      <path d="M7 20h10" />
                    </svg>
                  </div>
                )}

                <div className={`vp-ctrl ${focusArea === 'controls' && ctrlIndex === settingsCtrl ? 'is-focused' : ''} ${menu === 'settings' ? 'is-on' : ''}`} title="Ajustes">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
                  </svg>
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
              <div className="vp-menu-title">{seasonNumber ? `Temporada ${seasonNumber}` : 'Episodios'}</div>
              <div className="vp-episodes-track" style={{ transform: `translateX(${-Math.max(0, menuCursor - 2) * 340}px)` }}>
                {episodes.map((ep, i) => {
                  const current = i === epIndex;
                  return (
                    <div key={ep.id} className={`vp-ep-card ${i === menuCursor ? 'is-focused' : ''} ${current ? 'is-current' : ''}`}>
                      <div className="vp-ep-thumb" style={{ backgroundImage: `url('${ep.picture || item.backdrop || item.landscape || 'assets/placeholder_landscape.png'}')` }}>
                        {current && <span className="vp-ep-now">Reproduciendo</span>}
                        {current && <div className="vp-ep-progress"><div style={{ width: `${progressPercent}%` }} /></div>}
                      </div>
                      <div className="vp-ep-num">Episodio {ep.number || i + 1}</div>
                      <div className="vp-ep-title">{ep.title || ep.name || `Capítulo ${i + 1}`}</div>
                    </div>
                  );
                })}
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
