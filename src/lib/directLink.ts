/**
 * Direct channels (M3U / IPTV lists such as the open TV ones). Some ask for their own Referer or User-Agent
 * (#EXTVLCOPT in the list). A desktop browser plays them through the /stream-proxy of vite.config.ts, which sends
 * both. On the TV there is no proxy: the web engine drops both headers from hls.js requests, and AVPlay can send
 * a User-Agent but never a Referer (its only request headers are USER_AGENT and COOKIE).
 * No relative imports, so tests can load this file in Node.
 */

export type DirectHeaders = Record<string, string> | null | undefined;

/** Value of a header whatever its case ('' when missing) */
export function headerValue(headers: DirectHeaders, name: string): string {
  if (!headers) return '';
  const want = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === want && headers[key]) return String(headers[key]);
  }
  return '';
}

/**
 * Player for a direct .m3u8 link on a TV with AVPlay: AVPlay only when the link asks for its own User-Agent, the
 * one header AVPlay can send and hls.js cannot. A Referer alone gains nothing there (neither player sends it), so
 * those links stay on hls.js, which has the backups, the retries and the move to AVPlay when the TV refuses the video.
 */
export function directHlsPlayer(headers: DirectHeaders, onTv: boolean): 'avplay' | 'hls' {
  return onTv && !!headerValue(headers, 'User-Agent') ? 'avplay' : 'hls';
}

/**
 * Stream meta of a direct link. Always set when one starts, so the players never reuse the last portal channel's
 * headers (Content-Auth, App...) or its code. `direct` keeps the AVPlay preview on the link's own https: many of
 * these servers have no plain http (Tele Yucatán answers 404 there).
 */
export function directStreamMeta(url: string, headers: DirectHeaders): { url: string; headers?: Record<string, string>; direct: true } {
  return headers && Object.keys(headers).length ? { url, headers, direct: true } : { url, direct: true };
}
