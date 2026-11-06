import { LiveChannel } from '../types/channel';
import { normalizeChannel } from '../lib/channelKey';

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

class PlayerService {
  private activeChannelCode: string = '';
  private currentVideoEl: HTMLVideoElement | null = null;
  private resolveTimer: any = null;
  private isFullscreen: boolean = false;
  private lastChannel: LiveChannel | null = null;

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

    if (window.__xuperPreviewHls) {
      try {
        window.__xuperPreviewHls.stopLoad();
        window.__xuperPreviewHls.detachMedia();
        window.__xuperPreviewHls.destroy();
      } catch {}
      window.__xuperPreviewHls = null;
    }

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

    // If channel has direct stream URL (M3U / IPTV)
    if (channel.url && channel.url.startsWith('http')) {
      if (channel.url.includes('.m3u8')) {
        this.streamHls(channel.url, videoEl);
      } else if (fullscreen && window.XuperAVPlay && window.XuperAVPlay.playStream) {
        this.playLiveStream(channel.url, null, videoEl);
      } else if (window.XuperAVPlay && window.XuperAVPlay.playPreview) {
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
          if (err && /aaa10002/i.test(err.portalCode || err.message || '')) {
            try { localStorage.removeItem('xuper_magis_session_v1'); } catch (e) {}
            setTimeout(() => {
              if (this.activeChannelCode === code) {
                window.MagisClient?.resolveLive(code, (rErr: any, rMeta: any) => {
                  if (!rErr && rMeta && rMeta.url && this.activeChannelCode === code) {
                    window.__xuperCurrentStreamMeta = rMeta;
                    if (rMeta.url.includes('.m3u8')) {
                      this.streamHls(rMeta.url, videoEl, rMeta);
                    } else if (fullscreen && window.XuperAVPlay && window.XuperAVPlay.playStream) {
                      this.playLiveStream(rMeta.url, rMeta.headers, videoEl);
                    } else if (window.XuperAVPlay && window.XuperAVPlay.playPreview) {
                      window.XuperAVPlay.playPreview(rMeta.url, videoEl);
                    } else {
                      this.streamHls(rMeta.url, videoEl, rMeta);
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
          this.streamHls(streamMeta.url, videoEl, streamMeta);
        } else if (fullscreen && window.XuperAVPlay && window.XuperAVPlay.playStream) {
          this.playLiveStream(streamMeta.url, streamMeta.headers, videoEl);
        } else if (window.XuperAVPlay && window.XuperAVPlay.playPreview) {
          window.XuperAVPlay.playPreview(streamMeta.url, videoEl);
        } else {
          this.streamHls(streamMeta.url, videoEl, streamMeta);
        }
      });
    }
  }

  private playLiveStream(url: string, headers: any, videoEl: HTMLVideoElement | null) {
    window.XuperAVPlay._nextKind = 'live';
    return window.XuperAVPlay.playStream(url, headers, videoEl);
  }

  private streamHls(url: string, videoEl: HTMLVideoElement, streamMeta?: any) {
    if (!videoEl) return;

    if (window.__xuperPreviewHls) {
      try {
        window.__xuperPreviewHls.stopLoad();
        window.__xuperPreviewHls.detachMedia();
        window.__xuperPreviewHls.destroy();
      } catch {}
      window.__xuperPreviewHls = null;
    }

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
            if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
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
