import { LiveChannel } from '../types/channel';
import { normalizeChannel } from '../lib/channelKey';
import { hostOf, logPlayback, setPlaybackContext } from '../lib/playbackLog';

declare global {
  interface Window {
    MagisClient?: any;
    XuperAVPlay?: any;
    XuperPlatform?: any;
    __xuperCurrentStreamMeta?: any;
    __xuperPreviewHls?: any;
    __xuperCreateHls?: any;
    Hls?: any;
    webapis?: any;
  }
}

/** Signal of the live channel being played: the views show an error instead of a black screen */
export type LiveSignal = 'idle' | 'loading' | 'playing' | 'error';
export interface LiveStatus {
  code: string;
  state: LiveSignal;
}

// Without a picture after this long, the channel counts as down
const START_TIMEOUT_MS = 25000;
// Fatal HLS errors retried before giving up: a dead stream must not retry forever
const MAX_HLS_RETRIES = 2;

class PlayerService {
  private activeChannelCode: string = '';
  private currentVideoEl: HTMLVideoElement | null = null;
  private resolveTimer: any = null;
  private isFullscreen: boolean = false;
  private lastChannel: LiveChannel | null = null;
  private status: LiveStatus = { code: '', state: 'idle' };
  private statusListeners: Array<(s: LiveStatus) => void> = [];
  private watchdog: any = null;
  private avPoll: any = null;
  private watchedEl: HTMLVideoElement | null = null;
  private usingAvPreview = false;
  private onVideoPlaying = () => {
    if (this.status.state === 'loading' && this.status.code === this.activeChannelCode) {
      this.setStatus(this.status.code, 'playing');
    }
  };

  public getLiveStatus(): LiveStatus {
    return this.status;
  }

  public onLiveStatus(cb: (s: LiveStatus) => void): () => void {
    this.statusListeners.push(cb);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== cb);
    };
  }

  /** Last HLS.js error of the current channel, added to the report when the channel fails */
  private lastHlsError = '';

  /** Picture size and codecs when playback starts: 0x0 means sound without picture */
  private pictureInfo(): string {
    try {
      const hls = window.__xuperPreviewHls;
      if (hls) {
        const v = this.currentVideoEl;
        const level = hls.levels && hls.levels[hls.currentLevel >= 0 ? hls.currentLevel : 0];
        const codecs = level ? [level.videoCodec, level.audioCodec].filter(Boolean).join('/') : '';
        return ` ${v ? `${v.videoWidth}x${v.videoHeight}` : '?'}${codecs ? ` ${codecs}` : ''}`;
      }
      const av = window.webapis && window.webapis.avplay;
      const info = av && av.getCurrentStreamInfo ? av.getCurrentStreamInfo() : [];
      const video = (info || []).find((t: any) => t.type === 'VIDEO');
      if (video) {
        const extra = JSON.parse(video.extra_info || '{}');
        return ` ${extra.Width || '?'}x${extra.Height || '?'} ${extra.fourCC || ''}`.trimEnd();
      }
      return ' sin pista de video';
    } catch (e) {
      return '';
    }
  }

  /** Player of the current channel, for the problem report */
  private playerName(): string {
    return window.__xuperPreviewHls ? 'HLS.js' : 'AVPlay';
  }

  private setStatus(code: string, state: LiveSignal) {
    if (state === 'playing' && !(this.status.code === code && this.status.state === 'playing')) {
      logPlayback({ kind: 'start', player: this.playerName(), detail: `reproduciendo${this.pictureInfo()}` });
    }
    if (this.status.code === code && this.status.state === state) return;
    this.status = { code, state };
    this.statusListeners.forEach(cb => {
      try { cb(this.status); } catch (e) {}
    });
  }

  private clearWatch() {
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.avPoll) clearInterval(this.avPoll);
    this.watchdog = null;
    this.avPoll = null;
  }

  /** Waits for the first picture of a channel; marks it down after START_TIMEOUT_MS */
  private watchStart(code: string, videoEl: HTMLVideoElement) {
    this.clearWatch();
    this.setStatus(code, 'loading');
    if (this.watchedEl !== videoEl) {
      if (this.watchedEl) this.watchedEl.removeEventListener('playing', this.onVideoPlaying);
      videoEl.addEventListener('playing', this.onVideoPlaying);
      this.watchedEl = videoEl;
    }
    this.watchdog = setTimeout(() => {
      if (this.status.code === code && this.status.state === 'loading') this.failChannel(code, 'no picture');
    }, START_TIMEOUT_MS);
    // AVPlay draws outside the <video>: ask the player itself
    const av = window.webapis && window.webapis.avplay;
    if (av && window.XuperAVPlay) {
      this.avPoll = setInterval(() => {
        if (this.status.code !== code || this.status.state !== 'loading') {
          clearInterval(this.avPoll);
          this.avPoll = null;
          return;
        }
        let state = '';
        try { state = av.getState(); } catch (e) {}
        if (state === 'PLAYING') this.setStatus(code, 'playing');
        else if (this.usingAvPreview && window.XuperAVPlay.isPreviewActive === false) this.failChannel(code, 'avplay error');
      }, 1000);
    }
  }

  /** The channel does not play: stop trying (no endless retries) and report it */
  private failChannel(code: string, why: string) {
    if (this.activeChannelCode !== code) return;
    console.warn('[PlayerService] Channel down:', code, why);
    logPlayback({ kind: 'error', player: this.playerName(), detail: why + (this.lastHlsError ? ` · ${this.lastHlsError}` : '') });
    this.clearWatch();
    this.destroyHls();
    if (this.usingAvPreview && window.XuperAVPlay && typeof window.XuperAVPlay.stopLive === 'function') {
      window.XuperAVPlay.stopLive();
    }
    if (this.currentVideoEl) {
      try {
        this.currentVideoEl.pause();
        this.currentVideoEl.removeAttribute('src');
        this.currentVideoEl.load();
      } catch {}
    }
    this.setStatus(code, 'error');
  }

  private destroyHls() {
    if (window.__xuperPreviewHls) {
      try {
        window.__xuperPreviewHls.stopLoad();
        window.__xuperPreviewHls.detachMedia();
        window.__xuperPreviewHls.destroy();
      } catch {}
      window.__xuperPreviewHls = null;
    }
  }

  constructor() {
    // Coming back from the background when AVPlay could not be restored: reopen the live channel
    window.addEventListener('xuper-avplay-restore-failed', () => {
      if (!this.lastChannel || !this.currentVideoEl || !this.activeChannelCode) return;
      const channel = this.lastChannel;
      this.activeChannelCode = '';
      this.playLivePreview(channel, this.currentVideoEl);
    });

    // Auto-recover live channel playback when network reconnects after an outage
    window.addEventListener('xuper-network-change', (e: any) => {
      if (e?.detail?.online) {
        if (this.lastChannel && this.currentVideoEl && !this.activeChannelCode) {
          console.log('[PlayerService] Network recovered, retuning channel:', this.lastChannel.name);
          const channel = this.lastChannel;
          this.playLivePreview(channel, this.currentVideoEl);
        }
      }
    });
  }

  public playLivePreview(channel: LiveChannel, videoEl: HTMLVideoElement | null) {
    channel = normalizeChannel(channel);
    if (!channel || (!channel.code && !channel.url && !channel.id)) {
      console.warn('[PlayerService] channel without id/code/url, cannot tune:', channel && channel.name);
      return;
    }
    const code = String(channel.code || channel.id);

    // If channel is already playing, do NOT reload or recreate player!
    if (this.activeChannelCode === code && this.currentVideoEl === videoEl) {
      return;
    }

    if (this.resolveTimer) {
      clearTimeout(this.resolveTimer);
      this.resolveTimer = null;
    }

    this.currentVideoEl = videoEl;
    this.activeChannelCode = code;
    this.lastChannel = channel;

    this.resolveTimer = setTimeout(() => {
      this.resolveTimer = null;
      this.doPlayChannel(channel, videoEl, this.isFullscreen);
    }, 200);
  }

  public setFullscreen(fullscreen: boolean) {
    this.isFullscreen = fullscreen;
    if (fullscreen) {
      if (window.XuperAVPlay && typeof window.XuperAVPlay.switchToFullscreen === 'function') {
        window.XuperAVPlay.switchToFullscreen();
      }
    } else {
      if (window.XuperAVPlay && typeof window.XuperAVPlay.switchToPreview === 'function') {
        window.XuperAVPlay.switchToPreview(this.currentVideoEl);
      }
    }
  }

  public playFullscreen(channel: LiveChannel, videoEl: HTMLVideoElement | null) {
    this.setFullscreen(true);
    this.playLivePreview(channel, videoEl);
  }

  public exitFullscreen(previewVideoEl?: HTMLVideoElement | null) {
    this.setFullscreen(false);
    if (previewVideoEl) {
      this.currentVideoEl = previewVideoEl;
    }
  }

  public stop() {
    if (this.resolveTimer) {
      clearTimeout(this.resolveTimer);
      this.resolveTimer = null;
    }
    this.activeChannelCode = '';
    this.clearWatch();
    this.setStatus('', 'idle');
    this.destroyHls();

    if (window.XuperAVPlay && typeof window.XuperAVPlay.stopLive === 'function') {
      window.XuperAVPlay.stopLive();
    } else if (window.XuperAVPlay && typeof window.XuperAVPlay.stopPreview === 'function') {
      window.XuperAVPlay.stopPreview();
    }

    if (this.currentVideoEl) {
      try {
        this.currentVideoEl.pause();
        this.currentVideoEl.removeAttribute('src');
        this.currentVideoEl.load();
      } catch {}
    }
    window.XuperPlatform?.setScreenSaver?.(true);
  }

  private doPlayChannel(channel: LiveChannel, videoEl: HTMLVideoElement | null, fullscreen: boolean) {
    if (!videoEl) return;
    window.XuperPlatform?.setScreenSaver?.(false);
    const code = String(channel.code || channel.id);
    console.log('[PlayerService] Resolving live channel:', channel.name, code);
    setPlaybackContext({ channel: channel.name, category: channel.categoryName, source: channel.url ? 'directo' : 'portal' });
    this.lastHlsError = '';
    this.usingAvPreview = false;
    this.watchStart(code, videoEl);

    // If channel has direct stream URL (M3U / IPTV)
    if (channel.url && channel.url.startsWith('http')) {
      if (channel.url.includes('.m3u8')) {
        this.streamHls(channel.url, videoEl, undefined, code);
      } else if (fullscreen && window.XuperAVPlay && window.XuperAVPlay.playStream) {
        this.playLiveStream(channel.url, null, videoEl);
      } else if (window.XuperAVPlay && window.XuperAVPlay.playPreview) {
        // A direct link has no headers of its own: do not reuse the last portal channel's
        window.__xuperCurrentStreamMeta = null;
        this.usingAvPreview = true;
        window.XuperAVPlay.playPreview(channel.url, videoEl);
      } else {
        videoEl.src = channel.url;
        videoEl.play().catch(() => {});
      }
      return;
    }

    // Portal channel -> resolve with MagisClient
    if (window.MagisClient && typeof window.MagisClient.resolveLive === 'function') {
      window.MagisClient.resolveLive(code, (err: any, streamMeta: any) => {
        if (err || !streamMeta || !streamMeta.url) {
          console.error('[PlayerService] Failed to resolve channel:', err);
          this.lastHlsError = `portal ${(err && (err.portalCode || err.message)) || 'sin enlace'}`.slice(0, 80);
          if (!(err && /aaa10002/i.test(err.portalCode || err.message || ''))) {
            this.failChannel(code, 'resolve');
            return;
          }
          if (err && /aaa10002/i.test(err.portalCode || err.message || '')) {
            try { localStorage.removeItem('xuper_magis_session_v1'); } catch (e) {}
            setTimeout(() => {
              if (this.activeChannelCode === code) {
                window.MagisClient?.resolveLive(code, (rErr: any, rMeta: any) => {
                  if (!rErr && rMeta && rMeta.url && this.activeChannelCode === code) {
                    window.__xuperCurrentStreamMeta = rMeta;
                    if (rMeta.url.includes('.m3u8')) {
                      this.streamHls(rMeta.url, videoEl, rMeta, code);
                    } else if (fullscreen && window.XuperAVPlay && window.XuperAVPlay.playStream) {
                      this.playLiveStream(rMeta.url, rMeta.headers, videoEl);
                    } else if (window.XuperAVPlay && window.XuperAVPlay.playPreview) {
                      this.usingAvPreview = true;
                      window.XuperAVPlay.playPreview(rMeta.url, videoEl);
                    } else {
                      this.streamHls(rMeta.url, videoEl, rMeta, code);
                    }
                  }
                });
              }
            }, 600);
          }
          return;
        }

        if (this.activeChannelCode !== code) {
          return; // user already switched away
        }

        console.log('[PlayerService] Stream resolved:', streamMeta.name, streamMeta.url);
        window.__xuperCurrentStreamMeta = streamMeta;

        // Use HLS.js for .m3u8 streams on Tizen (handles custom chunk auth headers)
        if (streamMeta.url.includes('.m3u8')) {
          this.streamHls(streamMeta.url, videoEl, streamMeta, code);
        } else if (fullscreen && window.XuperAVPlay && window.XuperAVPlay.playStream) {
          this.playLiveStream(streamMeta.url, streamMeta.headers, videoEl);
        } else if (window.XuperAVPlay && window.XuperAVPlay.playPreview) {
          this.usingAvPreview = true;
          window.XuperAVPlay.playPreview(streamMeta.url, videoEl);
        } else {
          this.streamHls(streamMeta.url, videoEl, streamMeta, code);
        }
      });
    }
  }

  private playLiveStream(url: string, headers: any, videoEl: HTMLVideoElement | null) {
    window.XuperAVPlay._nextKind = 'live';
    return window.XuperAVPlay.playStream(url, headers, videoEl);
  }

  private streamHls(url: string, videoEl: HTMLVideoElement, streamMeta?: any, code?: string) {
    if (!videoEl) return;
    this.destroyHls();

    const isBrowserEnv = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      (typeof (window as any).tizen === 'undefined' && typeof (window as any).webOS === 'undefined')
    );

    let effectiveUrl = url;
    if (isBrowserEnv && url.startsWith('http') && !url.includes('/stream-proxy')) {
      const auth = streamMeta?.headers?.['Content-Auth'] || '';
      const license = streamMeta?.headers?.['Content-License'] || '';
      effectiveUrl = `/stream-proxy?url=${encodeURIComponent(url)}&auth=${encodeURIComponent(auth)}&license=${encodeURIComponent(license)}`;
    }

    if (window.__xuperCreateHls || (window.Hls && window.Hls.isSupported())) {
      try {
        const hls = window.__xuperCreateHls ? window.__xuperCreateHls() : new window.Hls({ enableWorker: false, lowLatencyMode: false });
        window.__xuperPreviewHls = hls;

        let backupIdx = 0;
        let retries = 0;
        const backups = (streamMeta && streamMeta.backupUrls) || [];

        hls.loadSource(effectiveUrl);
        hls.attachMedia(videoEl);

        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
          try {
            videoEl.muted = false;
            videoEl.volume = 1;
          } catch {}
          videoEl.play().catch((e: any) => {
            console.warn('[PlayerService] Unmuted play blocked, falling back to muted autoplay:', e);
            try {
              videoEl.muted = true;
              videoEl.play().catch(mErr => console.warn('[PlayerService] Muted play also blocked:', mErr));
            } catch {}
          });
        });

        hls.on(window.Hls.Events.ERROR, (event: any, data: any) => {
          console.error('[HLS error]', data.type, data.details, data.fatal);
          const status = data.response && data.response.code ? ` ${data.response.code}` : '';
          this.lastHlsError = `${data.type}/${data.details}${status}`;
          const host = hostOf((data.frag && data.frag.url) || data.url || (data.context && data.context.url));
          if (data.fatal) logPlayback({ kind: 'error', player: 'HLS.js', detail: this.lastHlsError, host });
          else if (data.details === 'bufferStalledError') logPlayback({ kind: 'stall', player: 'HLS.js', detail: 'bufferStalledError', host });
          if (data.fatal) {
            if (backupIdx < backups.length) {
              const next = backups[backupIdx++];
              const nextUrl = typeof next === 'string' ? next : next?.url;
              if (nextUrl) {
                console.log('[PlayerService] Retrying backup CDN:', nextUrl);
                let nextEffective = nextUrl;
                if (isBrowserEnv && nextUrl.startsWith('http') && !nextUrl.includes('/stream-proxy')) {
                  const auth = streamMeta?.headers?.['Content-Auth'] || '';
                  const license = streamMeta?.headers?.['Content-License'] || '';
                  nextEffective = `/stream-proxy?url=${encodeURIComponent(nextUrl)}&auth=${encodeURIComponent(auth)}&license=${encodeURIComponent(license)}`;
                }
                hls.loadSource(nextEffective);
                hls.startLoad();
                return;
              }
            }
            // A dead stream (404, refused, bad format) stops after a few tries and shows the error
            if (retries++ >= MAX_HLS_RETRIES || (data.type !== window.Hls.ErrorTypes.NETWORK_ERROR && data.type !== window.Hls.ErrorTypes.MEDIA_ERROR)) {
              if (code && window.__xuperPreviewHls === hls) this.failChannel(code, `hls ${data.details}`);
              return;
            }
            if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else {
              hls.recoverMediaError();
            }
          }
        });
        return;
      } catch (err) {
        console.error('[PlayerService] Error creating Hls:', err);
      }
    }

    // Native fallback
    try {
      videoEl.src = url;
      videoEl.load();
      videoEl.play().catch(() => {});
    } catch {}
  }
}

export const playerService = new PlayerService();
