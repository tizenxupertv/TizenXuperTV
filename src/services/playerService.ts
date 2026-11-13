import { LiveChannel } from '../types/channel';
import { isRegionBlocked } from '../lib/portalErrors';
import { backBufferFor } from '../lib/tvMemory';
import { normalizeChannel } from '../lib/channelKey';
import { hostOf, isIspBlockPage, logPlayback, setPlaybackContext } from '../lib/playbackLog';
import { createSequenceFixer } from '../lib/mediaSequence';
import { shouldMoveLiveToAvPlay, videoCodecRejected } from '../lib/liveVideoFallback';
import { isStaleLinkStatus } from '../lib/liveLink';
import { epicSportsService } from './epicSportsService';

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
  /** Why it failed, when known: 'isp' = the internet provider blocks the server */
  reason?: 'isp' | 'region';
}

// Without a picture after this long, the channel counts as down
const START_TIMEOUT_MS = 25000;
// Fatal HLS errors retried before giving up: a dead stream must not retry forever
const MAX_HLS_RETRIES = 2;
/** Retries of the same server when a live playlist refresh comes back broken */
const MAX_REFRESH_RETRIES = 3;
const REFRESH_RETRY_MS = 1500;
/** Refresh retries count within this window, so a server that keeps failing ends up on the backups */
const REFRESH_WINDOW_MS = 60000;

const segCache = new Map<string, { buffer?: ArrayBuffer; promise?: Promise<ArrayBuffer> }>();

function resolveSegmentUrl(uri: string, baseUrl: string): string {
  try {
    return new URL(uri, baseUrl).href;
  } catch {
    const base = baseUrl.slice(0, baseUrl.lastIndexOf('/') + 1);
    return base + uri;
  }
}

function prefetchUpcomingSegments(manifestText: string, manifestUrl: string, headers?: Record<string, string>) {
  if (typeof fetch === 'undefined') return;
  const lines = manifestText.split('\n');
  const segUrls: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#')) {
      segUrls.push(resolveSegmentUrl(line, manifestUrl));
    }
  }
  // HLS.js plays near the live edge (liveSyncDurationCount 3): the newest segments are the ones it asks for next
  if (manifestText.includes('#EXT-X-ENDLIST')) return;
  const toPrefetch = segUrls.slice(-3);
  for (const u of toPrefetch) {
    if (!segCache.has(u)) {
      const item: { buffer?: ArrayBuffer; promise?: Promise<ArrayBuffer> } = {};
      item.promise = fetch(u, { headers: headers || {}, cache: 'no-store' })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then(buf => {
          item.buffer = buf;
          delete item.promise;
          return buf;
        })
        .catch(() => {
          segCache.delete(u);
          return undefined;
        });
      segCache.set(u, item);
    }
  }
  if (segCache.size > 8) {
    const it = segCache.keys();
    while (segCache.size > 8) {
      const k = it.next().value;
      if (k) segCache.delete(k);
    }
  }
}

/** Load stats for a segment served from the prefetch cache, in the shape HLS.js 1.x reads (stats.loading.first/end) */
function cachedStats(loader: any, bytes: number): any {
  const now = performance.now();
  const stats = loader.stats || { aborted: false, retry: 0, chunkCount: 0, bwEstimate: 0, loading: {}, parsing: {}, buffering: {} };
  stats.loading = stats.loading || {};
  stats.loading.start = stats.loading.first = stats.loading.end = now;
  stats.loaded = stats.total = bytes;
  return stats;
}

/** HLS.js playlist and fragment loader that fixes media sequences and prefetches upcoming segments for instant zapping */
function liveOptimizedLoader(Hls: any): any {
  const fix = createSequenceFixer();
  const Base = Hls.DefaultConfig.loader;
  return class extends Base {
    load(context: any, config: any, callbacks: any) {
      const isSegment = context.type === 'fragment' || context.type === 'segment' || context.frag != null;
      if (isSegment && segCache.has(context.url)) {
        const cached = segCache.get(context.url);
        segCache.delete(context.url);
        if (cached?.buffer) {
          callbacks.onSuccess({ url: context.url, data: cached.buffer, code: 200 }, cachedStats(this, cached.buffer.byteLength), context, null);
          return;
        }
        if (cached?.promise) {
          cached.promise.then(buf => {
            if (buf) {
              callbacks.onSuccess({ url: context.url, data: buf, code: 200 }, cachedStats(this, buf.byteLength), context, null);
            } else {
              super.load(context, config, callbacks);
            }
          }).catch(() => {
            super.load(context, config, callbacks);
          });
          return;
        }
      }

      const onSuccess = callbacks.onSuccess;
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response: any, stats: any, ctx: any, networkDetails: any) => {
          if (response && typeof response.data === 'string') {
            response.data = fix(response.data);
            if (response.data.includes('#EXTINF:')) {
              prefetchUpcomingSegments(response.data, ctx.url, context.headers);
            }
          }
          onSuccess(response, stats, ctx, networkDetails);
        }
      });
    }
  };
}

/** HLS.js fragment loader that strips the 67-byte fake PNG prefix from Epic Sports / Perelman segments */
function epicFragmentLoader(Hls: any): any {
  const Base = Hls.DefaultConfig.loader;
  return class extends Base {
    load(context: any, config: any, callbacks: any) {
      const onSuccess = callbacks.onSuccess;
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response: any, stats: any, ctx: any, networkDetails: any) => {
          if (response && response.data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(response.data);
            // Check PNG magic: 0x89 0x50 0x4E 0x47 and sync byte 0x47 at offset 67
            if (bytes.length > 67 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[67] === 0x47) {
              response.data = bytes.slice(67).buffer;
            }
          }
          onSuccess(response, stats, ctx, networkDetails);
        }
      });
    }
  };
}


/** AVPlay draws below the page: while it plays a live channel, the live layers must be see-through (index.css) */
function setLiveAvPlayLook(on: boolean) {
  try {
    document.documentElement.classList.toggle('xuper-live-avplay', on);
  } catch (e) {}
}

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
  /** Channel moved from hls.js to AVPlay because the TV's MediaSource refused its video (once per tune) */
  private avTriedCode = '';
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

  /** Preview box or fullscreen and the size of the video element on screen (sound without picture in the
   *  preview but not in fullscreen points to how the TV draws that box, not to the stream) */
  private screenInfo(): string {
    const v = this.currentVideoEl;
    const size = v ? ` ${v.clientWidth}x${v.clientHeight}` : '';
    return ` · ${this.isFullscreen ? 'pantalla completa' : 'vista previa'}${size}`;
  }

  /** Player of the current channel, for the problem report */
  private playerName(): string {
    return window.__xuperPreviewHls ? 'HLS.js' : 'AVPlay';
  }

  /** An internet provider's block page was seen this session (also explains VOD errors) */
  public ispBlocked = false;

  private setStatus(code: string, state: LiveSignal, reason?: 'isp' | 'region') {
    if (state === 'playing' && !(this.status.code === code && this.status.state === 'playing')) {
      logPlayback({ kind: 'start', player: this.playerName(), detail: `reproduciendo${this.pictureInfo()}${this.screenInfo()}` });
    }
    if (this.status.code === code && this.status.state === state && this.status.reason === reason) return;
    this.status = reason ? { code, state, reason } : { code, state };
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
  private failChannel(code: string, why: string, reason?: 'isp' | 'region') {
    if (this.activeChannelCode !== code) return;
    console.warn('[PlayerService] Channel down:', code, why);
    logPlayback({ kind: 'error', player: this.playerName(), detail: why + (this.lastHlsError ? ` · ${this.lastHlsError}` : '') });
    this.clearWatch();
    this.destroyHls();
    setLiveAvPlayLook(false);
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
    this.setStatus(code, 'error', reason);
  }

  private destroyHls() {
    segCache.clear();
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
    const changed = this.isFullscreen !== fullscreen;
    this.isFullscreen = fullscreen;
    if (changed && this.activeChannelCode && this.status.state === 'playing') {
      // After the layout settles, so the size is the one on screen
      setTimeout(() => logPlayback({ kind: 'info', player: this.playerName(), detail: `cambio a${this.screenInfo().slice(2)} · imagen${this.pictureInfo()}` }), 1500);
    }
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
    setLiveAvPlayLook(false);

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

  // ---------------------------------------------------------------------------
  // Pre-warming & Zero-Latency Zapping (DNS / Socket pre-connect + Stream Pre-Resolve)
  // ---------------------------------------------------------------------------
  private prewarmedCodes = new Set<string>();

  /**
   * Pre-warms network connection and stream URL in background without interrupting playback.
   * Can be called on cursor hover (dwell ~350ms) or for adjacent channels (CH- / CH+).
   */
  public prewarm(channel: LiveChannel | null | undefined): void {
    if (!channel) return;
    const code = String(channel.code || channel.id);
    if (!code || this.prewarmedCodes.has(code) || this.activeChannelCode === code) return;
    this.prewarmedCodes.add(code);

    // Limit cache set size
    if (this.prewarmedCodes.size > 25) {
      const it = this.prewarmedCodes.values();
      this.prewarmedCodes.delete(it.next().value!);
    }

    try {
      if (channel.url && channel.url.startsWith('http')) {
        // Direct stream: pre-connect TCP/TLS to host
        const match = channel.url.match(/^(https?:\/\/[^/]+)/i);
        if (match && match[1]) {
          const origin = match[1];
          if (!document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) {
            const link = document.createElement('link');
            link.rel = 'preconnect';
            link.href = origin;
            document.head.appendChild(link);
          }
        }
        if (channel.url.includes('epictvparaiphone.top') || channel.url.includes('playlatam.site')) {
          epicSportsService.getPulseraToken().catch(() => {});
        }
      } else if (window.MagisClient && typeof window.MagisClient.resolveLive === 'function') {
        // Portal stream: pre-resolve so it gets stored in liveResolveCache[code]
        window.MagisClient.resolveLive(code, (err: any, meta: any) => {
          if (!err && meta && meta.url) {
            const m = meta.url.match(/^(https?:\/\/[^/]+)/i);
            if (m && m[1]) {
              const link = document.createElement('link');
              link.rel = 'preconnect';
              link.href = m[1];
              document.head.appendChild(link);
            }
          }
        });
      }
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Replays (catch-up programmes played as a channel): seek and pause like a movie
  // ---------------------------------------------------------------------------
  private replayTarget: number | null = null;
  private replayTimer: ReturnType<typeof setTimeout> | null = null;

  private replayOnAvPlay(): boolean {
    return !!(window.XuperAVPlay && window.XuperAVPlay.isActive);
  }

  /** Position and length of the replay playing now, in seconds; a pending seek shows its target */
  public replayPosition(): { t: number; d: number; paused: boolean } {
    if (this.replayOnAvPlay()) {
      const av = window.XuperAVPlay;
      return { t: this.replayTarget ?? av.currentTimeSec ?? 0, d: av.durationSec || 0, paused: !!av.isPaused };
    }
    const v = this.currentVideoEl;
    if (!v) return { t: 0, d: 0, paused: false };
    return { t: this.replayTarget ?? v.currentTime ?? 0, d: isFinite(v.duration) ? v.duration : 0, paused: v.paused };
  }

  /**
   * Moves the replay by `delta` seconds. Presses add up on screen at once; the player gets a single seek 180 ms
   * after the last one, like movies.
   */
  public replaySeekBy(delta: number): void {
    const { t, d } = this.replayPosition();
    const target = Math.max(0, Math.min(d > 0 ? d - 5 : Infinity, t + delta));
    this.replayTarget = target;
    if (this.replayTimer) clearTimeout(this.replayTimer);
    this.replayTimer = setTimeout(() => {
      this.replayTimer = null;
      const done = () => { if (this.replayTarget === target) this.replayTarget = null; };
      if (this.replayOnAvPlay()) {
        window.XuperAVPlay.seekTo(target, done, (err: any) => {
          logPlayback({ kind: 'error', player: 'AVPlay', detail: `replay seek ${Math.round(target)} s: ${(err && (err.name || err.message)) || err}` });
          done();
        });
      } else if (this.currentVideoEl) {
        try { this.currentVideoEl.currentTime = target; } catch (e) {}
        setTimeout(done, 1500);
      } else {
        done();
      }
    }, 180);
  }

  /** Pauses or resumes the replay; `want` forces one of them (the remote's play and pause keys) */
  public replayTogglePause(want?: 'play' | 'pause'): void {
    const paused = this.replayPosition().paused;
    const pause = want ? want === 'pause' : !paused;
    if (this.replayOnAvPlay()) {
      if (pause) window.XuperAVPlay.pause();
      else window.XuperAVPlay.play();
      return;
    }
    const v = this.currentVideoEl;
    if (!v) return;
    if (pause) v.pause();
    else v.play().catch(() => {});
  }

  private doPlayChannel(channel: LiveChannel, videoEl: HTMLVideoElement | null, fullscreen: boolean) {
    if (!videoEl) return;
    window.XuperPlatform?.setScreenSaver?.(false);
    const code = String(channel.code || channel.id);
    console.log('[PlayerService] Resolving live channel:', channel.name, code);
    setPlaybackContext({ channel: channel.name, category: channel.categoryName, source: channel.url ? 'directo' : 'portal' });
    this.lastHlsError = '';
    this.usingAvPreview = false;
    this.avTriedCode = '';
    this.watchStart(code, videoEl);

    // Global fallback bridge for AVPlay -> Hls.js fallback (Eclectic 2.0.36b pattern)
    (window as any).__xuperPlayHlsFallback = (fallbackUrl: string, targetEl: HTMLVideoElement) => {
      console.log('[PlayerService] Executing transparent fallback to Hls.js for live stream:', hostOf(fallbackUrl));
      this.usingAvPreview = false;
      this.streamHls(fallbackUrl, targetEl, undefined, this.activeChannelCode || undefined);
    };

    // If channel has direct stream URL (M3U / IPTV / Epic Sports)
    if (channel.url && channel.url.startsWith('http')) {
      if (channel.url.includes('epictvparaiphone.top') || channel.url.includes('playlatam.site')) {
        epicSportsService.getPulseraToken().then(token => {
          if (this.activeChannelCode !== code) return;
          window.__xuperCurrentStreamMeta = {
            url: channel.url,
            headers: { 'X-Pulsera': token }
          };
          this.streamHls(channel.url!, videoEl, window.__xuperCurrentStreamMeta, code);
        }).catch(() => {
          if (this.activeChannelCode !== code) return;
          this.streamHls(channel.url!, videoEl, undefined, code);
        });
        return;
      }

      if (channel.url.includes('.m3u8')) {
        this.streamHls(channel.url, videoEl, undefined, code);
      } else if (fullscreen && window.XuperAVPlay && window.XuperAVPlay.playStream) {
        this.playLiveStream(channel.url, null, videoEl);
      } else if (window.XuperAVPlay && window.XuperAVPlay.playPreview) {
        // A direct link has no headers of its own: do not reuse the last portal channel's
        window.__xuperCurrentStreamMeta = null;
        this.playAvPreview(channel.url, videoEl);
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
            // The portal refuses this channel for the viewer's region or provider: say so, not "no signal"
            this.failChannel(code, 'resolve', isRegionBlocked(err) ? 'region' : undefined);
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
                      this.playAvPreview(rMeta.url, videoEl);
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

        console.log('[PlayerService] Stream resolved:', streamMeta.name, hostOf(streamMeta.url));
        window.__xuperCurrentStreamMeta = streamMeta;

        // Use HLS.js for .m3u8 streams on Tizen (handles custom chunk auth headers)
        if (streamMeta.url.includes('.m3u8')) {
          this.streamHls(streamMeta.url, videoEl, streamMeta, code);
        } else if (fullscreen && window.XuperAVPlay && window.XuperAVPlay.playStream) {
          this.playLiveStream(streamMeta.url, streamMeta.headers, videoEl);
        } else if (window.XuperAVPlay && window.XuperAVPlay.playPreview) {
          this.playAvPreview(streamMeta.url, videoEl);
        } else {
          this.streamHls(streamMeta.url, videoEl, streamMeta, code);
        }
      });
    }
  }

  private playLiveStream(url: string, headers: any, videoEl: HTMLVideoElement | null) {
    setLiveAvPlayLook(true);
    window.XuperAVPlay._nextKind = 'live';
    return window.XuperAVPlay.playStream(url, headers, videoEl);
  }

  private playAvPreview(url: string, videoEl: HTMLVideoElement) {
    setLiveAvPlayLook(true);
    this.usingAvPreview = true;
    window.XuperAVPlay.playPreview(url, videoEl);
  }

  /**
   * The TV's MediaSource refused the channel's video and hls.js went on with the sound alone: play the same link
   * with AVPlay, which decodes it in hardware. Its own fallback brings the channel back to hls.js if it fails.
   */
  private moveLiveToAvPlay(url: string, videoEl: HTMLVideoElement, code: string) {
    this.destroyHls();
    try {
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
    } catch {}
    this.avTriedCode = code;
    // Shows the channel cover again and waits for AVPlay's first picture
    this.watchStart(code, videoEl);
    const meta = window.__xuperCurrentStreamMeta;
    const headers = (meta && meta.headers) || null;
    if (this.isFullscreen && window.XuperAVPlay.playStream) this.playLiveStream(url, headers, videoEl);
    else this.playAvPreview(url, videoEl);
  }

  private streamHls(url: string, videoEl: HTMLVideoElement, streamMeta?: any, code?: string) {
    if (!videoEl) return;
    this.destroyHls();
    setLiveAvPlayLook(false);

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
        const pLoader = liveOptimizedLoader(window.Hls);
        const fLoader = epicFragmentLoader(window.Hls);
        const hls = window.__xuperCreateHls
          ? window.__xuperCreateHls({ pLoader, fLoader, backBufferLength: backBufferFor(15) })
          : new window.Hls({
              enableWorker: false,
              lowLatencyMode: false,
              backBufferLength: backBufferFor(15),
              maxBufferLength: 15,
              maxMaxBufferLength: 30,
              nudgeOffset: 0.1,
              nudgeMaxRetry: 5,
              liveSyncDurationCount: 3,
              pLoader,
              fLoader
            });
        window.__xuperPreviewHls = hls;

        let backupIdx = 0;
        let retries = 0;
        // A live playlist refresh that comes back broken (cut off, empty) while the channel plays is
        // usually a hiccup of that server: retry it a few times per minute before moving to the backups
        let refreshRetries: number[] = [];
        // Answered by an internet provider's block page instead of the playlist
        let sawBlockPage = false;
        let currentSource = effectiveUrl;
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

        let selfHealingAuth = false;
        /** Last 401/403 token refresh: within a minute of it, another 401/403 is a real error (geo or ISP block) */
        let lastAuthRefreshAt = 0;

        const onHlsError = (event: any, data: any) => {
          console.error('[HLS error]', data.type, data.details, data.fatal);
          // The TV refused the video codec: hls.js dropped the picture and plays the sound alone (Tizen 3-5)
          const lostVideo = videoCodecRejected(data);
          if (lostVideo) {
            logPlayback({ kind: 'error', player: 'HLS.js', detail: `MSE sin video (${lostVideo.slice(0, 60)})`, host: hostOf(currentSource) });
            const ctx = {
              hasAvPlay: !!(window.webapis && window.webapis.avplay && window.XuperAVPlay && window.XuperAVPlay.playPreview),
              code: code && code === this.activeChannelCode ? code : '',
              triedCode: this.avTriedCode
            };
            if (window.__xuperPreviewHls === hls && shouldMoveLiveToAvPlay(data, ctx)) {
              logPlayback({ kind: 'info', player: 'AVPlay', detail: 'el canal pasa a AVPlay' });
              this.moveLiveToAvPlay(currentSource, videoEl, ctx.code);
            }
            return;
          }
          const httpCode = data.response && data.response.code ? Number(data.response.code) : 0;
          const status = httpCode ? ` ${httpCode}` : '';

          // Self-healing token refresh when the link is refused, taken or gone (401/403/409/410)
          if (isStaleLinkStatus(httpCode) && code && !selfHealingAuth && Date.now() - lastAuthRefreshAt > 60000 &&
            window.MagisClient && typeof window.MagisClient.resolveLive === 'function') {
            selfHealingAuth = true;
            lastAuthRefreshAt = Date.now();
            console.log('[PlayerService] Live HTTP ' + httpCode + ' detected, refreshing SLB token...');
            window.MagisClient.resolveLive(code, (rErr: any, newMeta: any) => {
              selfHealingAuth = false;
              if (window.__xuperPreviewHls !== hls || this.activeChannelCode !== code) return;
              if (!rErr && newMeta && newMeta.url) {
                window.__xuperCurrentStreamMeta = newMeta;
                segCache.clear();
                let nextEffective = newMeta.url;
                if (isBrowserEnv && newMeta.url.startsWith('http') && !newMeta.url.includes('/stream-proxy')) {
                  const auth = newMeta?.headers?.['Content-Auth'] || '';
                  const license = newMeta?.headers?.['Content-License'] || '';
                  nextEffective = `/stream-proxy?url=${encodeURIComponent(newMeta.url)}&auth=${encodeURIComponent(auth)}&license=${encodeURIComponent(license)}`;
                }
                currentSource = nextEffective;
                hls.loadSource(nextEffective);
                hls.startLoad();
              } else {
                // No new token: handle the original error as usual (backups, retries, the error on screen)
                onHlsError(event, data);
              }
            }, { fresh: true });
            return;
          }
          // What the server sent instead of a playlist (an ISP block page, a portal error): links removed
          let body = '';
          if (/Parsing|Load/i.test(String(data.details || ''))) {
            try {
              const nd = data.networkDetails;
              const text = nd && typeof nd.responseText === 'string' ? nd.responseText : '';
              body = text.replace(/https?:\/\/\S+/g, '[url]').replace(/\s+/g, ' ').trim().slice(0, 70);
            } catch (e) {}
          }
          // HLS.js explains parsing errors in `reason` (e.g. "media sequence mismatch 11500:"): first line, no links
          const reason = String(data.reason || '').split('\n')[0].replace(/https?:\/\/\S+/g, '').trim().slice(0, 50);
          this.lastHlsError = `${data.type}/${data.details}${status}${reason ? ` (${reason})` : ''}${body ? ` «${body}»` : ''}`;
          try {
            const nd = data.networkDetails;
            if (nd && isIspBlockPage(typeof nd.responseText === 'string' ? nd.responseText : '', nd.responseURL)) {
              sawBlockPage = true;
              this.ispBlocked = true;
            }
          } catch (e) {}
          const host = hostOf((data.frag && data.frag.url) || data.url || (data.context && data.context.url) || (streamMeta && streamMeta.url) || url);
          if (data.fatal) logPlayback({ kind: 'error', player: 'HLS.js', detail: this.lastHlsError, host });
          else if (data.details === 'bufferStalledError') logPlayback({ kind: 'stall', player: 'HLS.js', detail: 'bufferStalledError', host });
          if (data.fatal) {
            const refreshHiccup = /^level(ParsingError|LoadError|LoadTimeOut)$/.test(String(data.details)) &&
              !!code && this.status.code === code && this.status.state === 'playing';
            const now = Date.now();
            refreshRetries = refreshRetries.filter(at => now - at < REFRESH_WINDOW_MS);
            if (refreshHiccup && refreshRetries.length < MAX_REFRESH_RETRIES) {
              refreshRetries.push(now);
              logPlayback({ kind: 'stall', player: 'HLS.js', detail: `lista incompleta, reintento ${refreshRetries.length}`, host });
              setTimeout(() => {
                if (window.__xuperPreviewHls !== hls) return;
                hls.loadSource(currentSource);
                hls.startLoad();
              }, REFRESH_RETRY_MS);
              return;
            }
            if (backupIdx < backups.length) {
              const next = backups[backupIdx++];
              const nextUrl = typeof next === 'string' ? next : next?.url;
              if (nextUrl) {
                console.log('[PlayerService] Retrying backup CDN:', hostOf(nextUrl));
                let nextEffective = nextUrl;
                if (isBrowserEnv && nextUrl.startsWith('http') && !nextUrl.includes('/stream-proxy')) {
                  const auth = streamMeta?.headers?.['Content-Auth'] || '';
                  const license = streamMeta?.headers?.['Content-License'] || '';
                  nextEffective = `/stream-proxy?url=${encodeURIComponent(nextUrl)}&auth=${encodeURIComponent(auth)}&license=${encodeURIComponent(license)}`;
                }
                currentSource = nextEffective;
                refreshRetries = [];
                hls.loadSource(nextEffective);
                hls.startLoad();
                return;
              }
            }
            // A dead stream (404, refused, bad format) stops after a few tries and shows the error
            if (retries++ >= MAX_HLS_RETRIES || (data.type !== window.Hls.ErrorTypes.NETWORK_ERROR && data.type !== window.Hls.ErrorTypes.MEDIA_ERROR)) {
              if (code && window.__xuperPreviewHls === hls) this.failChannel(code, `hls ${data.details}`, sawBlockPage ? 'isp' : undefined);
              return;
            }
            if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else {
              hls.recoverMediaError();
            }
          }
        };
        hls.on(window.Hls.Events.ERROR, onHlsError);
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
