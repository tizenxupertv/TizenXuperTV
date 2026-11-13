/**
 * Movies and series through MSE (hls.js on an HTML <video>) instead of AVPlay.
 *
 * The portal serves each title as one large MPEG-TS file plus an `.idxg` index (byte offset of every keyframe).
 * AVPlay opens the whole file without the index, so it must probe it and every seek is slow. Here the index
 * becomes a byte-range HLS playlist: hls.js downloads ~6 s pieces with HTTP Range, keeps ~20 s ahead and
 * drops what is behind (no growing memory on 1 GB TVs), and a seek inside the buffer is instant.
 * AVPlay stays as the fallback (the player switches to it when anything here fails).
 */
import { buildVodTsPlaylist, groupIdxgSegments, parseIdxg } from './vodIdxg.ts';
import type { IdxgSegment } from './vodIdxg.ts';
import { backBufferFor } from './tvMemory.ts';
import { createAudioSelector } from './tsAudioSelect.ts';

/** Fake address of the generated playlist: the playlist loader answers it from memory */
export const MSE_PLAYLIST_URL = 'https://xuper-vod.invalid/playlist.m3u8';
/** localStorage switch: 'avplay' turns this engine off on a TV where it misbehaves */
export const VOD_ENGINE_KEY = 'xuper.vodEngine';
/** Seconds per downloaded piece: few requests, quick first frame */
const PIECE_SEC = 6;
const FETCH_TIMEOUT_MS = 8000;

export interface MseVodSource {
  url: string;
  idxUrl?: string;
  mime?: string;
  codec?: string;
  headers?: Record<string, string>;
  /** The same file on the other CDNs the portal listed (magis-client.js), each with its own index and headers */
  backupUrls?: Array<{ url: string; idxUrl?: string; headers?: Record<string, string> }>;
}

/** How many CDNs serve this title: the main one and its backups */
export function mseSourceCount(res: MseVodSource): number {
  return 1 + ((res.backupUrls && res.backupUrls.length) || 0);
}

/**
 * The title as served by its `n`-th CDN (0: the main one), the CDNs after it left as its backups; null when it has
 * no such CDN. A backup without headers of its own keeps the title's.
 */
export function mseSourceAt<T extends MseVodSource>(res: T, n: number): T | null {
  if (n === 0) return res;
  const backups = res.backupUrls || [];
  const b = backups[n - 1];
  if (!b || !b.url) return null;
  return { ...res, url: b.url, idxUrl: b.idxUrl, headers: b.headers || res.headers, backupUrls: backups.slice(n) };
}

/** Why this title cannot play through MSE on this TV ('' when it can), for the playback log */
export function mseUnsupportedReason(res: MseVodSource | null | undefined, w: any = window): string {
  if (!res) return 'sin datos del video';
  if (!res.idxUrl) return 'sin índice .idxg';
  if (res.mime !== 'video/mp2t') return `formato ${res.mime || 'desconocido'}`;
  try {
    if (w.localStorage && w.localStorage.getItem(VOD_ENGINE_KEY) === 'avplay') return 'desactivado en esta TV';
  } catch {
    // no storage: use the default
  }
  const MS = w.MediaSource;
  if (!MS || typeof MS.isTypeSupported !== 'function') return 'sin MediaSource';
  if (!w.Hls || typeof w.Hls.isSupported !== 'function' || !w.Hls.isSupported()) return 'sin hls.js';
  if (typeof w.__xuperCreateHls !== 'function') return 'sin hls.js';
  const hevc = /265|HEVC/.test(String(res.codec || '').toUpperCase());
  const types = hevc
    ? ['video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"']
    : ['video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="avc1.4d401f"', 'video/mp4; codecs="avc1.42E01E"'];
  return types.some(t => MS.isTypeSupported(t)) ? '' : `MSE no decodifica ${hevc ? 'HEVC' : 'H264'}`;
}

/** MPEG-TS title with an index, on a TV whose MSE plays its video codec, with hls.js loaded */
export function canPlayVodWithMse(res: MseVodSource | null | undefined, w: any = window): boolean {
  return mseUnsupportedReason(res, w) === '';
}

/** Audio languages inside the file, in the file's order, as the portal lists them ("spa,eng") */
export function fileAudioLanguages(audio: string | undefined): string[] {
  return String(audio || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Position, among the file's audios, of the first one in the wanted language; 0 (the first audio) when the file does
 * not have that language. lib/tsAudioSelect.ts makes hls.js play that one.
 */
export function wantedAudioIndex(audio: string | undefined, isWanted: (lang: string) => boolean): number {
  const at = fileAudioLanguages(audio).findIndex(isWanted);
  return at > 0 ? at : 0;
}

/** The portal headers the CDN checks (User-Agent cannot be set from a page) */
export function cdnHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const h = headers || {};
  ['Content-Auth', 'Content-License', 'App', 'App-Version'].forEach(k => {
    if (h[k]) out[k] = h[k];
  });
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: sin respuesta en ${ms / 1000} s`)), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}

export interface VodPlaylist {
  playlist: string;
  duration: number;
  pieces: number;
  /** CDNs passed over because they did not give the index: the playlist plays from mseSourceAt(src, skipped) */
  skipped: number;
}

/** Downloads the index and groups its keyframes into pieces. `fetchFn` is injectable for tests */
async function loadIndexPieces(src: MseVodSource, fetchFn: typeof fetch): Promise<IdxgSegment[]> {
  if (!src.idxUrl) throw new Error('El título no tiene índice');
  const bytes = await withTimeout(
    fetchFn(src.idxUrl, { headers: cdnHeaders(src.headers) }).then(r => {
      if (!r.ok) throw new Error(`índice HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
    FETCH_TIMEOUT_MS,
    'índice'
  );
  return groupIdxgSegments(parseIdxg(bytes), PIECE_SEC).segments;
}

/**
 * Downloads the index and turns it into a byte-range playlist (the index header carries the media size and
 * duration). `fetchFn` is injectable for tests.
 */
export async function buildVodPlaylist(src: MseVodSource, fetchFn: typeof fetch = fetch): Promise<VodPlaylist> {
  // A CDN without the index (404, a page that is not one, no answer) used to send the title to AVPlay, which cannot
  // open these files on Tizen 4.0: the other CDNs of the title are asked first
  const count = mseSourceCount(src);
  let firstError: unknown = null;
  for (let n = 0; n < count; n++) {
    const source = mseSourceAt(src, n);
    if (!source || !source.idxUrl) continue;
    try {
      const segments = await loadIndexPieces(source, fetchFn);
      const duration = segments.reduce((sum, s) => sum + s.duration, 0);
      return { playlist: buildVodTsPlaylist({ segments }, source.url), duration, pieces: segments.length, skipped: n };
    } catch (e) {
      if (firstError === null) firstError = e;
    }
  }
  const why = (firstError as any)?.message || String(firstError || 'El título no tiene índice');
  throw new Error(count > 1 ? `${why} (${count} CDN)` : why);
}

/**
 * Duration of a title in seconds, from its index; 0 when it has no index or it cannot be read. For AVPlay on older
 * TVs, which reports no duration for these files (and the portal sends 0): without one there is no timeline, no
 * time left, and the title never counts as finished.
 */
export async function indexDuration(src: MseVodSource, fetchFn: typeof fetch = fetch): Promise<number> {
  try {
    const segments = await loadIndexPieces(src, fetchFn);
    return segments.reduce((sum, s) => sum + s.duration, 0);
  } catch {
    return 0;
  }
}

/** HLS.js loader that serves the generated playlist from memory and everything else as usual */
export function playlistLoader(Hls: any, playlist: string): any {
  const Base = Hls.DefaultConfig.loader;
  return class extends Base {
    load(context: any, config: any, callbacks: any) {
      if (context.url !== MSE_PLAYLIST_URL) {
        super.load(context, config, callbacks);
        return;
      }
      const now = performance.now();
      const stats = (this as any).stats || { aborted: false, retry: 0, chunkCount: 0, bwEstimate: 0, parsing: {}, buffering: {} };
      stats.loading = stats.loading || {};
      stats.loading.start = stats.loading.first = stats.loading.end = now;
      stats.loaded = stats.total = playlist.length;
      setTimeout(() => callbacks.onSuccess({ url: context.url, data: playlist }, stats, context, null), 0);
    }
  };
}

/** Fragment loader that leaves audio number `audioIndex` as the only audio of each piece before hls.js reads it */
export function audioLoader(Hls: any, audioIndex: number): any {
  const Base = Hls.DefaultConfig.loader;
  const select = createAudioSelector(audioIndex);
  return class extends Base {
    load(context: any, config: any, callbacks: any) {
      const onSuccess = callbacks.onSuccess;
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response: any, stats: any, ctx: any, networkDetails: any) => {
          try {
            if (response && response.data instanceof ArrayBuffer) select(new Uint8Array(response.data));
          } catch {
            // left as downloaded: the file's first audio plays
          }
          onSuccess(response, stats, ctx, networkDetails);
        }
      });
    }
  };
}

/**
 * hls.js settings for VOD on TVs: ~20 s ahead, ~20 s kept behind (10 s on 1 GB TVs; the rest is freed), resume at
 * `startAt`, and the audio number `audioIndex` of the file (0: its first one, which needs no help)
 */
export function mseHlsConfig(Hls: any, playlist: string, startAt: number, audioIndex = 0): Record<string, unknown> {
  return {
    ...(audioIndex > 0 ? { fLoader: audioLoader(Hls, audioIndex) } : {}),
    pLoader: playlistLoader(Hls, playlist),
    startPosition: startAt > 5 ? startAt : -1,
    maxBufferLength: 20,
    maxMaxBufferLength: 30,
    backBufferLength: backBufferFor(20),
    fragLoadingTimeOut: 15000,
    fragLoadingMaxRetry: 4
  };
}
