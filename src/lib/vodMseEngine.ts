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
import { backBufferFor } from './tvMemory.ts';

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
    ? ['video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"']
    : ['video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="avc1.4d401f"'];
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
 * hls.js plays the first audio of an MPEG-TS file and cannot switch to another one; AVPlay can. MSE fits when the
 * wanted language is that first audio, or when the file does not have it at all
 */
export function mseAudioFits(audio: string | undefined, isWanted: (lang: string) => boolean): boolean {
  const langs = fileAudioLanguages(audio);
  if (langs.length < 2 || isWanted(langs[0])) return true;
  return !langs.some(isWanted);
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
}

/**
 * Downloads the index and turns it into a byte-range playlist (the index header carries the media size and
 * duration). `fetchFn` is injectable for tests.
 */
export async function buildVodPlaylist(src: MseVodSource, fetchFn: typeof fetch = fetch): Promise<VodPlaylist> {
  if (!src.idxUrl) throw new Error('El título no tiene índice');
  const bytes = await withTimeout(
    fetchFn(src.idxUrl, { headers: cdnHeaders(src.headers) }).then(r => {
      if (!r.ok) throw new Error(`índice HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
    FETCH_TIMEOUT_MS,
    'índice'
  );
  const grouped = groupIdxgSegments(parseIdxg(bytes), PIECE_SEC);
  const duration = grouped.segments.reduce((sum, s) => sum + s.duration, 0);
  return { playlist: buildVodTsPlaylist(grouped, src.url), duration, pieces: grouped.segments.length };
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

/** hls.js settings for VOD on TVs: ~20 s ahead, ~20 s kept behind (10 s on 1 GB TVs; the rest is freed), resume at `startAt` */
export function mseHlsConfig(Hls: any, playlist: string, startAt: number): Record<string, unknown> {
  return {
    pLoader: playlistLoader(Hls, playlist),
    startPosition: startAt > 5 ? startAt : -1,
    maxBufferLength: 20,
    maxMaxBufferLength: 30,
    backBufferLength: backBufferFor(20),
    fragLoadingTimeOut: 15000,
    fragLoadingMaxRetry: 4
  };
}
