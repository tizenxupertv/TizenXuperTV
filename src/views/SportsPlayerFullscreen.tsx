import { AUTO_NEXT_MS, nextSignal } from '../lib/nextSignal';
import { createRunGuard } from '../lib/runGuard';
import { loadShaka } from '../lib/lazyScript';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import '../styles/sportsPlayer.css';
import { MatchCrest, MatchHeader } from '../components/sports/MatchHeader';
import { MatchDetailModal } from '../components/sports/MatchDetailModal';
import { scoreboardService } from '../services/scoreboardService';
import { SportsEvent, SportsStream } from '../types/sports.ts';
import { sportsService } from '../services/sportsService.ts';
import { hostOf, logPlayback, setPlaybackContext } from '../lib/playbackLog';
import { routeAt, routeCount, routeLabel } from '../lib/signalRoutes';

/** A signal that shows no picture this long counts as failed (its other route or the next signal is tried) */
const NO_PICTURE_MS = 20_000;
import { backBufferFor } from '../lib/tvMemory';

interface SportsPlayerFullscreenProps {
  event: SportsEvent;
  initialStreamIndex: number;
  streams: SportsStream[];
  onClose: () => void;
}

export const SportsPlayerFullscreen: React.FC<SportsPlayerFullscreenProps> = ({
  event,
  initialStreamIndex,
  streams,
  onClose
}) => {
  const [currentStreamIdx, setCurrentStreamIdx] = useState<number>(initialStreamIndex);
  const [showOsd, setShowOsd] = useState<boolean>(true);
  const [showServerMenu, setShowServerMenu] = useState<boolean>(false);
  const [serverMenuIdx, setServerMenuIdx] = useState<number>(initialStreamIndex);
  const [showMatchModal, setShowMatchModal] = useState<boolean>(false);
  const [isBuffering, setIsBuffering] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // AVPlay draws below the page: the player background must be transparent while it plays
  const [usingAvplay, setUsingAvplay] = useState(false);
  // The OK that opened the player must not also open the signal panel
  const openedAtRef = useRef(Date.now());
  // Signals that failed in this session, marked in the list
  const [failed, setFailed] = useState<Set<number>>(() => new Set());
  // The signal about to be tried by itself after a failure (index), or null
  const [autoNext, setAutoNext] = useState<number | null>(null);
  const autoNextTimerRef = useRef<any>(null);
  const cancelAutoNext = useCallback(() => {
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setAutoNext(null);
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const shakaRef = useRef<any>(null);
  // Shaka is asked for once per signal; the tick runs the playback effect again when the load settles
  const shakaTriedRef = useRef<number | null>(null);
  const [shakaTick, setShakaTick] = useState(0);
  const osdTimerRef = useRef<any>(null);
  const errorRef = useRef<string | null>(null);
  // Which player and link the current signal uses, for the Perfil › Diagnóstico report
  const playerKindRef = useRef('');
  const startLoggedRef = useRef(false);
  /** When the current route was started, for the time to the first picture in the log */
  const startedAtRef = useRef(0);
  // Route of the current signal being tried (0: its own address, then its alternates, lib/signalRoutes)
  const [routeIdx, setRouteIdx] = useState(0);
  useEffect(() => { setRouteIdx(0); }, [currentStreamIdx]);

  // The signal as listed, and the same one with its address worked out when it needs it (a signed link, a page to
  // read). That work happens here, when the signal is chosen, not for every signal of the match when it is opened
  const baseStream = streams[currentStreamIdx] || streams[0];
  const listedStream = useMemo(() => (baseStream ? routeAt(baseStream, routeIdx) : baseStream), [baseStream, routeIdx]);
  const [resolved, setResolved] = useState<{ from: SportsStream; stream: SportsStream } | null>(null);
  const resolving = sportsService.needsResolving(listedStream) && !(resolved && resolved.from === listedStream);
  useEffect(() => {
    if (!sportsService.needsResolving(listedStream)) return;
    let alive = true;
    sportsService.resolveStream(listedStream).then(stream => {
      if (alive) setResolved({ from: listedStream, stream });
    });
    return () => { alive = false; };
  }, [listedStream]);
  const currentStream = resolved && resolved.from === listedStream ? resolved.stream : listedStream;
  // The next two signals are worked out meanwhile (EPIC+ only), so the switch to them, by hand or after a failure, is quick
  useEffect(() => {
    sportsService.prepareStreams(streams.slice(currentStreamIdx + 1, currentStreamIdx + 3));
  }, [streams, currentStreamIdx]);
  const versus = !!event.away && event.away.trim().toLowerCase() !== event.home.trim().toLowerCase();
  const score = versus ? scoreboardService.findScore(event.home, event.away) : null;

  const osdVisibleRef = useRef(true);
  const hideOsd = useCallback(() => {
    osdVisibleRef.current = false;
    setShowOsd(false);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
  }, []);
  const triggerOsd = useCallback(() => {
    osdVisibleRef.current = true;
    setShowOsd(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      osdVisibleRef.current = false;
      setShowOsd(false);
      // The signal list stays open over a failed signal: it is the only way on
      if (!errorRef.current) setShowServerMenu(false);
    }, 5000);
  }, []);

  useEffect(() => {
    triggerOsd();
    return () => {
      if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    };
  }, [triggerOsd]);

  // Clean up playback on unmount or stream switch
  const cleanupPlayer = useCallback(() => {
    if (shakaRef.current) {
      try {
        shakaRef.current.destroy();
      } catch {}
      shakaRef.current = null;
    }
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {}
      hlsRef.current = null;
    }
    const av = (window as any).XuperAVPlay;
    if (av && av.isActive) {
      try { if (typeof av.stopLive === 'function') av.stopLive(); else av.stop(); } catch {}
    }
    setUsingAvplay(false);
    const video = videoRef.current;
    if (video) {
      // Handlers of the signal that is going away: they closed over its name
      video.onerror = null;
      video.onplaying = null;
      video.onwaiting = null;
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {}
    }
    document.documentElement.classList.remove('xuper-live-avplay', 'xuper-vod-avplay');
    (window as any).XuperPlatform?.setScreenSaver?.(true);
  }, []);

  // Initialize playback for the selected stream
  useEffect(() => {
    // A signal that failed keeps reporting errors for a few seconds. Everything this run sets on screen goes through
    // the guard, so once the viewer picks another signal the old one can no longer show its error over the new one
    const run = createRunGuard();
    const showError = run.wrap((msg: string | null) => setError(msg));
    const showBuffering = run.wrap((on: boolean) => setIsBuffering(on));
    // The address of this signal is still being worked out: the effect runs again when it arrives
    if (resolving) {
      showError(null);
      showBuffering(true);
      return;
    }
    if (!currentStream || !currentStream.url) {
      showError('Servidor sin URL disponible');
      showBuffering(false);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    showError(null);
    showBuffering(true);
    (window as any).XuperPlatform?.setScreenSaver?.(false);

    const streamUrl = currentStream.url;
    const isAvPlayAvailable = !!(window as any).webapis?.avplay && !!(window as any).XuperAVPlay;
    const Hls = (window as any).Hls;

    const isDash = streamUrl.includes('.mpd') || streamUrl.includes('dash') || Boolean(currentStream.drmApi);
    // Shaka Player is loaded by the first DASH signal, not at every start of the app (lib/lazyScript). This effect
    // runs again when it arrives; when it cannot be loaded the signal goes on to the next way of playing it
    if (isDash && !(window as any).shaka && shakaTriedRef.current !== currentStreamIdx) {
      shakaTriedRef.current = currentStreamIdx;
      loadShaka().then(() => setShakaTick(t => t + 1));
      return;
    }
    const shaka = (window as any).shaka;
    const isHls = streamUrl.includes('.m3u8') || streamUrl.includes('hls');

    playerKindRef.current = isAvPlayAvailable && !isDash ? 'AVPlay'
      : isDash && shaka?.Player ? `Shaka${currentStream.drmApi ? ' ClearKey' : ''}`
      : isHls && Hls?.isSupported?.() ? 'HLS.js' : 'HTML5';
    startLoggedRef.current = false;
    startedAtRef.current = Date.now();
    logPlayback({ kind: 'info', player: playerKindRef.current, detail: `prueba ${routeLabel(baseStream, routeIdx, hostOf(streamUrl))}`, host: hostOf(streamUrl) });
    // Answering but no picture (a link that responds is not a signal that plays): give up on this route
    const noPicture = setTimeout(() => {
      if (!startLoggedRef.current) showError(`Sin imagen en ${NO_PICTURE_MS / 1000} s (${currentStream.name})`);
    }, NO_PICTURE_MS);
    // (its error goes through the run guard, so it is ignored once another signal or route has started)
    void noPicture;
    setPlaybackContext({
      channel: versus ? `${event.home} vs ${event.away}` : event.home,
      category: event.league ? `Deportes · ${event.league}` : 'Deportes',
      source: currentStream.name
    });

    if (shaka?.polyfill) {
      try { shaka.polyfill.installAll(); } catch {}
    }

    // Host only: the link carries tokens, and the DRM key is never written anywhere
    console.log('[SportsPlayer] Starting stream:', currentStream.name, hostOf(streamUrl), 'isDash:', isDash, 'drm:', Boolean(currentStream.drmApi));

    if (isAvPlayAvailable && !isDash) {
      // TV, HLS without DRM: hardware AVPlay (the same path as live TV). It draws below the page, so the
      // player turns transparent while it plays
      try {
        setUsingAvplay(true);
        document.documentElement.classList.add('xuper-vod-avplay');
        const av = (window as any).XuperAVPlay;
        av._nextKind = 'live';
        video.onplaying = () => showBuffering(false);
        video.onwaiting = () => showBuffering(true);
        video.onerror = () => {
          showBuffering(false);
          showError(`No se pudo cargar la señal (${currentStream.name})`);
        };
        if (av.playStream(streamUrl, currentStream.headers || {}, video) === false) throw new Error('AVPlay did not start');
      } catch (err: any) {
        console.error('[SportsPlayer] AVPlay error:', err);
        setUsingAvplay(false);
        document.documentElement.classList.remove('xuper-vod-avplay');
        showError('Error iniciando el reproductor');
        showBuffering(false);
      }
    } else if (isDash && shaka && shaka.Player && shaka.Player.isBrowserSupported()) {
      // Shaka Player for MPEG-DASH & ClearKey DRM (Works in Chrome, Edge, Firefox, Tizen EME)
      try {
        // The element is attached below: passing it to the constructor is deprecated since Shaka 4.x
        const player = new shaka.Player();
        shakaRef.current = player;

        // Configure resilient buffer goals (5s rebuffering / 12s goal)
        player.configure({
          streaming: {
            bufferingGoal: 12,
            rebufferingGoal: 5
          }
        });

        // Configure ClearKey DRM if key is provided
        if (currentStream.drmApi) {
          const parts = currentStream.drmApi.split(':');
          if (parts.length === 2) {
            const keyIdHex = parts[0].trim().toLowerCase().replace(/-/g, '');
            const keyHex = parts[1].trim().toLowerCase().replace(/-/g, '');
            player.configure({
              drm: {
                clearKeys: {
                  [keyIdHex]: keyHex
                }
              }
            });
          }
        }

        // Attach request headers (User-Agent, Referer) if provided
        if (currentStream.headers && Object.keys(currentStream.headers).length > 0) {
          player.getNetworkingEngine().registerRequestFilter((_type: any, request: any) => {
            for (const [k, v] of Object.entries(currentStream.headers || {})) {
              if (v) request.headers[k] = v;
            }
          });
        }

        player.addEventListener('error', (event: any) => {
          // Code and category only: a network error's data holds the full link
          console.error('[SportsPlayer] Shaka error event:', event.detail && event.detail.code, event.detail && event.detail.category);
          showBuffering(false);
          showError(`Error de señal: ${currentStream.name}`);
        });

        player.addEventListener('buffering', (event: any) => {
          showBuffering(Boolean(event.buffering));
        });

        player.attach(video).then(() => player.load(streamUrl)).then(() => {
          console.log('[SportsPlayer] Shaka stream loaded successfully!');
          showBuffering(false);
          video.play().catch(err => {
            console.warn('[SportsPlayer] Unmuted autoplay blocked, retrying muted:', err);
            video.muted = true;
            video.play().catch(mErr => console.warn('[SportsPlayer] Muted play also blocked:', mErr));
          });
        }).catch((err: any) => {
          console.error('[SportsPlayer] Shaka load failed:', err);
          showBuffering(false);
          showError(`No se pudo cargar la señal (${currentStream.name})`);
        });
      } catch (err: any) {
        console.error('[SportsPlayer] Shaka init exception:', err);
        showBuffering(false);
        showError(`Error inicializando reproductor DASH (${currentStream.name})`);
      }
    } else if (isHls && Hls && Hls.isSupported()) {
      // Browser / Hls.js fallback with dev proxy support for local testing
      const isBrowserEnv = typeof window !== 'undefined' && (
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        (typeof (window as any).tizen === 'undefined' && typeof (window as any).webOS === 'undefined')
      );
      const referer = currentStream.headers?.['Referer'] || currentStream.headers?.['referer'] || '';
      const ua = currentStream.headers?.['User-Agent'] || currentStream.headers?.['user-agent'] || '';
      let effectiveHlsUrl = streamUrl;
      if (isBrowserEnv && streamUrl.startsWith('http') && !streamUrl.includes('/stream-proxy')) {
        let proxyUri = `/stream-proxy?url=${encodeURIComponent(streamUrl)}`;
        if (referer) proxyUri += `&referer=${encodeURIComponent(referer)}`;
        if (ua) proxyUri += `&ua=${encodeURIComponent(ua)}`;
        effectiveHlsUrl = proxyUri;
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        // Keep only the last 30 s already played (10 s on 1 GB TVs): the rest piles up in memory over a long match
        backBufferLength: backBufferFor(30),
        maxMaxBufferLength: 60,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6
      });
      hlsRef.current = hls;
      hls.loadSource(effectiveHlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(err => {
          video.muted = true;
          video.play().catch(() => {});
        });
      });
      hls.on(Hls.Events.FRAG_LOADED, () => showBuffering(false));
      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (data.fatal) {
          showBuffering(false);
          showError(`Error de señal: ${currentStream.name}`);
        }
      });
    } else {
      video.src = streamUrl;
      video.play().catch(err => {
        video.muted = true;
        video.play().catch(() => {});
      });
      video.onplaying = () => showBuffering(false);
      video.onwaiting = () => showBuffering(true);
      video.onerror = () => {
        showBuffering(false);
        showError(`No se pudo cargar la señal (${currentStream.name})`);
      };
    }

    return () => {
      run.end();
      cleanupPlayer();
    };
  }, [currentStreamIdx, currentStream, cleanupPlayer, shakaTick, resolving]);

  // The first moment a signal plays, once per signal
  useEffect(() => {
    if (isBuffering || error || startLoggedRef.current || !currentStream?.url) return;
    startLoggedRef.current = true;
    const ms = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
    logPlayback({ kind: 'start', player: playerKindRef.current, detail: `reproduciendo · primera imagen en ${ms} ms · ${routeLabel(baseStream, routeIdx, hostOf(currentStream.url))}`, host: hostOf(currentStream.url) });
  }, [isBuffering, error, currentStream]);

  // A failed signal: mark it and open the list on the next one that has not failed
  useEffect(() => {
    errorRef.current = error;
    if (!error) return;
    logPlayback({ kind: 'error', player: playerKindRef.current, detail: `${error} · ${routeLabel(baseStream, routeIdx, hostOf(currentStream?.url))}`, host: hostOf(currentStream?.url) });
    // The same channel has another route: try it before marking the signal failed or moving to another one
    if (routeIdx + 1 < routeCount(baseStream)) {
      logPlayback({ kind: 'info', player: playerKindRef.current, detail: `cambia a la ruta ${routeIdx + 2} de «${baseStream.name}»` });
      setRouteIdx(routeIdx + 1);
      return;
    }
    setFailed(prev => new Set(prev).add(currentStreamIdx));
    if (streams.length > 1) {
      const next = nextSignal(streams.length, currentStreamIdx, failed);
      setServerMenuIdx(next >= 0 ? next : currentStreamIdx);
      setShowServerMenu(true);
      // The next signal that has not failed is tried by itself after a moment; any key leaves the choice to the viewer
      if (next >= 0) {
        setAutoNext(next);
        autoNextTimerRef.current = setTimeout(() => {
          autoNextTimerRef.current = null;
          setAutoNext(null);
          setShowServerMenu(false);
          logPlayback({ kind: 'info', player: playerKindRef.current, detail: `pasa a «${streams[next].name}» tras fallar «${baseStream.name}»` });
          setCurrentStreamIdx(next);
        }, AUTO_NEXT_MS);
      }
    }
    return cancelAutoNext;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // Key navigation in player
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showMatchModal) return; // MatchDetailModal handles its own keys
      if (Date.now() - openedAtRef.current < 600 && (e.key === 'Enter' || e.key === 'ArrowUp')) return;

      const isBack = e.key === 'Escape' || e.key === 'Backspace' || (e as any).keyCode === 10009;

      // Any key while the next signal is about to be tried: the viewer chooses instead
      if (autoNextTimerRef.current) cancelAutoNext();

      // Toggle match details with 'i' (Info key) or yellow remote button
      if (e.key === 'i' || (e as any).keyCode === 457 || (e as any).keyCode === 405) {
        e.preventDefault();
        setShowMatchModal(true);
        hideOsd();
        return;
      }

      // Error card: the other signals as a vertical list
      if (error) {
        e.preventDefault();
        if (showServerMenu && e.key === 'ArrowUp') setServerMenuIdx(i => Math.max(0, i - 1));
        else if (showServerMenu && e.key === 'ArrowDown') setServerMenuIdx(i => Math.min(streams.length - 1, i + 1));
        else if (e.key === 'Enter') {
          if (showServerMenu) { setCurrentStreamIdx(serverMenuIdx); setShowServerMenu(false); }
          else if (streams.length > 1) setShowServerMenu(true);
        } else if (isBack) onClose();
        return;
      }

      // Watching: the first key only shows the bar; ▲ ▼ move along the signals, OK switches, Back hides the bar
      if (!osdVisibleRef.current) {
        if (isBack) { e.preventDefault(); onClose(); return; }
        e.preventDefault();
        setServerMenuIdx(currentStreamIdx);
        triggerOsd();
        return;
      }
      triggerOsd();
      const maxMenuIdx = streams.length; // 0..streams.length - 1 = signals; streams.length = Alineaciones y Estadísticas
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setServerMenuIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setServerMenuIdx(i => Math.min(maxMenuIdx, i + 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (serverMenuIdx === streams.length) {
          setShowMatchModal(true);
          hideOsd();
        } else if (serverMenuIdx < streams.length && serverMenuIdx !== currentStreamIdx) {
          setCurrentStreamIdx(serverMenuIdx);
        }
      } else if (isBack) {
        e.preventDefault();
        hideOsd();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [error, showServerMenu, serverMenuIdx, currentStreamIdx, streams, triggerOsd, onClose]);

  // Signals list, shared by the error card and the side panel
  const signalList = (
    <div className="spp-signals">
      {streams.map((s, idx) => {
        const isFocused = idx === serverMenuIdx;
        const isPlaying = idx === currentStreamIdx && !error;
        const isFailed = failed.has(idx);
        return (
          <div
            key={idx}
            className={`spp-signal ${isFocused ? 'is-focused' : ''} ${isPlaying ? 'is-playing' : ''} ${isFailed ? 'is-failed' : ''}`}
            onClick={() => { setCurrentStreamIdx(idx); setShowServerMenu(false); }}
          >
            <span className="spp-signal-name">{s.name}</span>
            {isPlaying && <span className="spp-signal-tag">Viendo</span>}
            {isFailed && !isPlaying && <span className="spp-signal-tag is-failed">No disponible</span>}
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: usingAvplay ? 'transparent' : '#000',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    }}>
      <video
        ref={videoRef}
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain'
        }}
      />

      {/* Connecting: the match and the signal, in the same card as the errors */}
      {isBuffering && !error && (
        <div className="spp-error is-loading">
          <MatchHeader event={event} />
          <div className="spp-loading"><span className="spp-spinner" />Conectando a {currentStream?.name || 'la señal'}…</div>
        </div>
      )}

      {/* The signal failed: what happened and the other signals, in one card */}
      {error && (
        <div className="spp-error">
          <MatchHeader event={event} />
          <div className="spp-error-msg">Esta señal no está disponible</div>
          <div className="spp-error-detail">Transmisión deportiva · {error}</div>
          {streams.length > 1 && showServerMenu ? (
            <>
              <div className="spp-hint">
                {autoNext !== null && streams[autoNext]
                  ? `Probando «${streams[autoNext].name}» en unos segundos · pulsa una tecla para elegir tú`
                  : 'Elige otra señal · OK para ver · Atrás para salir'}
              </div>
              {signalList}
            </>
          ) : (
            <div className="spp-hint">{streams.length > 1 ? 'OK para elegir otra señal · Atrás para salir' : 'Atrás para salir'}</div>
          )}
        </div>
      )}

      {/* Bottom bar while watching: the match, its score, and the signals (◄ ► and OK) */}
      {showOsd && !error && (
        <div className="spp-bar">
          <div className="spp-bar-match">
            <MatchCrest src={event.homeLogo || event.leagueLogo} name={event.home} />
            <div className="spp-bar-titles">
              <div className="spp-bar-league">
                <span className="spb-live-tag"><span className="spb-dot" />{score && score.state === 'live' && score.periodDetail ? score.periodDetail : 'EN VIVO'}</span>
                {event.league}
              </div>
              <div className="spp-bar-name">
                <span className="spp-bar-team-name">{event.home}</span>
                {versus && (score ? <span className="spp-bar-score">{score.homeScore} – {score.awayScore}</span> : <span className="spp-bar-vs">vs</span>)}
                {versus && <span className="spp-bar-team-name">{event.away}</span>}
              </div>
            </div>
            {versus && <MatchCrest src={event.awayLogo} name={event.away} />}
          </div>
          <div className="spp-bar-signals">
            <div className="spp-bar-label">Señal</div>
            {streams.map((st, idx) => (
              <div
                key={idx}
                className={`spp-chip ${idx === serverMenuIdx ? 'is-focused' : ''} ${idx === currentStreamIdx ? 'is-playing' : ''} ${failed.has(idx) ? 'is-failed' : ''}`}
                onClick={() => setCurrentStreamIdx(idx)}
              >
                <span className="spp-chip-name">{st.name}</span>
                {idx === currentStreamIdx && <span className="spp-chip-tag">Viendo</span>}
                {failed.has(idx) && idx !== currentStreamIdx && <span className="spp-chip-tag is-failed">No disponible</span>}
              </div>
            ))}
            <div
              className={`spp-chip spp-chip-details ${serverMenuIdx === streams.length ? 'is-focused' : ''}`}
              onClick={() => {
                setShowMatchModal(true);
                hideOsd();
              }}
            >
              <span className="spp-chip-name">📊 Alineaciones y Estadísticas</span>
            </div>
            <div className="spp-bar-hint">▲ ▼ · OK cambiar / abrir · [Info] Alineaciones</div>
          </div>
        </div>
      )}

      {showMatchModal && (
        <MatchDetailModal
          event={event}
          onClose={() => setShowMatchModal(false)}
          onPlay={() => setShowMatchModal(false)}
        />
      )}
    </div>
  );
};

