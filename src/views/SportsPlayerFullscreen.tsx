import React, { useState, useEffect, useRef, useCallback } from 'react';
import '../styles/sportsPlayer.css';
import { MatchHeader } from '../components/sports/MatchHeader';
import { SportsEvent, SportsStream } from '../types/sports.ts';
import { sportsService } from '../services/sportsService.ts';

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
  const [isBuffering, setIsBuffering] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // Signals that failed in this session, marked in the list
  const [failed, setFailed] = useState<Set<number>>(() => new Set());

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const shakaRef = useRef<any>(null);
  const osdTimerRef = useRef<any>(null);
  const errorRef = useRef<string | null>(null);

  const currentStream = streams[currentStreamIdx] || streams[0];

  const triggerOsd = useCallback(() => {
    setShowOsd(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      setShowOsd(false);
      // The signal list stays open over a failed signal: it is the only way on
      if (!errorRef.current) setShowServerMenu(false);
    }, 4500);
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
    if ((window as any).XuperAVPlay && typeof (window as any).XuperAVPlay.stopLive === 'function') {
      try {
        (window as any).XuperAVPlay.stopLive();
      } catch {}
    }
    const video = videoRef.current;
    if (video) {
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
    if (!currentStream || !currentStream.url) {
      setError('Servidor sin URL disponible');
      setIsBuffering(false);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setIsBuffering(true);
    (window as any).XuperPlatform?.setScreenSaver?.(false);

    const streamUrl = currentStream.url;
    const isAvPlayAvailable = !!(window as any).webapis?.avplay && !!(window as any).XuperAVPlay;
    const shaka = (window as any).shaka;
    const Hls = (window as any).Hls;

    const isDash = streamUrl.includes('.mpd') || streamUrl.includes('dash') || Boolean(currentStream.drmApi);
    const isHls = streamUrl.includes('.m3u8') || streamUrl.includes('hls');

    console.log('[SportsPlayer] Starting stream:', currentStream.name, streamUrl, 'isDash:', isDash, 'drmApi:', currentStream.drmApi);

    if (isAvPlayAvailable) {
      // Use Tizen Hardware AVPlay
      try {
        document.documentElement.classList.add('xuper-live-avplay');
        (window as any).XuperAVPlay.playLive(
          {
            url: streamUrl,
            headers: currentStream.headers || {},
            drm: currentStream.drmApi ? { key: currentStream.drmApi } : undefined
          },
          video
        );

        video.onplaying = () => setIsBuffering(false);
        video.onwaiting = () => setIsBuffering(true);
        video.onerror = () => {
          setIsBuffering(false);
          setError(`Error al reproducir ${currentStream.name}`);
        };
      } catch (err: any) {
        console.error('[SportsPlayer] AVPlay error:', err);
        setError('Error inicializando reproductor AVPlay');
        setIsBuffering(false);
      }
    } else if (isDash && shaka && shaka.Player && shaka.Player.isBrowserSupported()) {
      // Shaka Player for MPEG-DASH & ClearKey DRM (Works in Chrome, Edge, Firefox, Tizen EME)
      try {
        shaka.polyfill?.installAll?.();
        const player = new shaka.Player(video);
        shakaRef.current = player;

        // Configure ClearKey DRM if key is provided
        if (currentStream.drmApi) {
          const parts = currentStream.drmApi.split(':');
          if (parts.length === 2) {
            const keyIdHex = parts[0].trim().toLowerCase();
            const keyHex = parts[1].trim().toLowerCase();
            player.configure({
              drm: {
                clearKeys: {
                  [keyIdHex]: keyHex
                }
              }
            });
          }
        }

        // Register custom headers if present
        if (currentStream.headers && Object.keys(currentStream.headers).length > 0) {
          player.getNetworkingEngine().registerRequestFilter((_type: any, request: any) => {
            for (const [k, v] of Object.entries(currentStream.headers!)) {
              request.headers[k] = v;
            }
          });
        }

        player.addEventListener('error', (event: any) => {
          console.error('[SportsPlayer] Shaka error event:', event.detail);
          setIsBuffering(false);
          setError(`Error de señal: ${currentStream.name}`);
        });

        player.addEventListener('buffering', (event: any) => {
          setIsBuffering(Boolean(event.buffering));
        });

        player.load(streamUrl).then(() => {
          console.log('[SportsPlayer] Shaka stream loaded successfully!');
          setIsBuffering(false);
          video.play().catch(err => {
            console.warn('[SportsPlayer] Unmuted autoplay blocked, retrying muted:', err);
            video.muted = true;
            video.play().catch(mErr => console.warn('[SportsPlayer] Muted play also blocked:', mErr));
          });
        }).catch((err: any) => {
          console.error('[SportsPlayer] Shaka load failed:', err);
          setIsBuffering(false);
          setError(`No se pudo cargar la señal (${currentStream.name})`);
        });
      } catch (err: any) {
        console.error('[SportsPlayer] Shaka init exception:', err);
        setIsBuffering(false);
        setError(`Error inicializando reproductor DASH (${currentStream.name})`);
      }
    } else if (isHls && Hls && Hls.isSupported()) {
      // Browser / Hls.js fallback
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        xhrSetup: (xhr: XMLHttpRequest) => {
          if (currentStream.headers) {
            for (const [k, v] of Object.entries(currentStream.headers)) {
              try {
                xhr.setRequestHeader(k, v);
              } catch {}
            }
          }
        }
      });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(err => {
          video.muted = true;
          video.play().catch(() => {});
        });
      });
      hls.on(Hls.Events.FRAG_LOADED, () => setIsBuffering(false));
      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (data.fatal) {
          setIsBuffering(false);
          setError(`Error de señal: ${currentStream.name}`);
        }
      });
    } else {
      video.src = streamUrl;
      video.play().catch(err => {
        video.muted = true;
        video.play().catch(() => {});
      });
      video.onplaying = () => setIsBuffering(false);
      video.onwaiting = () => setIsBuffering(true);
      video.onerror = () => {
        setIsBuffering(false);
        setError(`No se pudo cargar la señal (${currentStream.name})`);
      };
    }

    return () => {
      cleanupPlayer();
    };
  }, [currentStreamIdx, currentStream, cleanupPlayer]);

  // A failed signal: mark it and open the list on the next one that has not failed
  useEffect(() => {
    errorRef.current = error;
    if (!error) return;
    setFailed(prev => new Set(prev).add(currentStreamIdx));
    if (streams.length > 1) {
      const next = streams.findIndex((_, i) => i !== currentStreamIdx && !failed.has(i));
      setServerMenuIdx(next >= 0 ? next : currentStreamIdx);
      setShowServerMenu(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // Key navigation in player
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      triggerOsd();

      if (showServerMenu) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setServerMenuIdx(i => Math.max(0, i - 1));
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setServerMenuIdx(i => Math.min(streams.length - 1, i + 1));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          setCurrentStreamIdx(serverMenuIdx);
          setShowServerMenu(false);
          return;
        }
        if (e.key === 'Escape' || e.key === 'Backspace' || (e as any).keyCode === 10009) {
          e.preventDefault();
          setShowServerMenu(false);
          return;
        }
      }

      // Normal player keys
      switch (e.key) {
        case 'Enter':
          setShowServerMenu(true);
          setServerMenuIdx(currentStreamIdx);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setShowServerMenu(true);
          setServerMenuIdx(currentStreamIdx);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (streams.length > 1) {
            setCurrentStreamIdx(i => (i + 1) % streams.length);
          }
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault();
          if (streams.length > 1) {
            const next = e.key === 'ArrowRight'
              ? (currentStreamIdx + 1) % streams.length
              : (currentStreamIdx - 1 + streams.length) % streams.length;
            setCurrentStreamIdx(next);
          }
          break;
        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          onClose();
          break;
        default:
          if ((e as any).keyCode === 10009) { // Tizen Return Key
            e.preventDefault();
            onClose();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showServerMenu, serverMenuIdx, currentStreamIdx, streams, triggerOsd, onClose]);

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
      inset: 0,
      backgroundColor: '#000',
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
        <div className={`spp-error is-loading ${showServerMenu ? 'is-beside-panel' : ''}`}>
          <MatchHeader event={event} />
          <div className="spp-loading"><span className="spp-spinner" />Conectando a {currentStream?.name || 'la señal'}…</div>
        </div>
      )}

      {/* The signal failed: what happened and the other signals, in one card */}
      {error && (
        <div className="spp-error">
          <MatchHeader event={event} />
          <div className="spp-error-msg">Esta señal no está disponible</div>
          <div className="spp-error-detail">{error}</div>
          {streams.length > 1 && showServerMenu ? (
            <>
              <div className="spp-hint">Elige otra señal · OK para ver · Atrás para salir</div>
              {signalList}
            </>
          ) : (
            <div className="spp-hint">{streams.length > 1 ? 'OK para elegir otra señal · Atrás para salir' : 'Atrás para salir'}</div>
          )}
        </div>
      )}

      {/* Overlay Header OSD */}
      {showOsd && !showServerMenu && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '32px 48px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: '#fff',
          transition: 'opacity 0.3s ease'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div className="sports-badge-live">
                <span className="badge-dot" />
                EN VIVO
              </div>
              <span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {event.league}
              </span>
            </div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: '#ffffff' }}>
              {event.home} {event.away ? `vs ${event.away}` : ''}
            </h2>
          </div>

          {/* Current Server Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(255, 255, 255, 0.08)',
            padding: '10px 18px',
            borderRadius: 14,
            border: '1px solid rgba(255, 255, 255, 0.12)'
          }}>
            <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700 }}>Señal:</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#00e5ff' }}>
              {currentStream?.name}
            </span>
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>
              ({currentStreamIdx + 1}/{streams.length})
            </span>
          </div>
        </div>
      )}

      {/* Signal picker while watching: a compact panel at the right */}
      {showServerMenu && !error && (
        <div className="spp-panel">
          <div className="spp-panel-title">Elegir señal</div>
          <div className="spp-hint">▲ ▼ para elegir · OK para ver</div>
          {signalList}
        </div>
      )}
    </div>
  );
};

