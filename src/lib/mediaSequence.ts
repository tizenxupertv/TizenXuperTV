/**
 * Some portal servers renumber their live playlists: on the next refresh, the same #EXT-X-MEDIA-SEQUENCE number
 * points to the following file. HLS.js 1.6 rejects that ("media sequence mismatch", a levelParsingError) and the
 * channel stops. The fixer renumbers each playlist by its segments: a segment keeps the number it got the first
 * time it appeared, so the numbering HLS.js sees never changes. Playlists that are already consistent pass as is.
 * No relative imports, so test/mediaSequence.test.ts can load this file in Node.
 */

/** Segment identity: its address without the query (tokens change); behind the dev proxy, the proxied address */
function segmentKey(uri: string): string {
  const proxied = uri.indexOf('/stream-proxy') >= 0 ? /[?&]url=([^&]+)/.exec(uri) : null;
  const real = proxied ? decodeURIComponent(proxied[1]) : uri;
  return real.replace(/\?[^?]*$/, '');
}

/** One fixer per stream: it remembers the segments of the playlists it has seen */
export function createSequenceFixer(maxRemembered = 300): (playlist: string) => string {
  const seen = new Map<string, number>();
  let next = -1;
  return (playlist: string): string => {
    const tag = /#EXT-X-MEDIA-SEQUENCE:[ \t]*(\d+)/.exec(playlist);
    if (!tag || playlist.indexOf('#EXTINF') < 0) return playlist;
    const keys = playlist
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && line.charAt(0) !== '#')
      .map(segmentKey);
    if (!keys.length) return playlist;

    const fromServer = Number(tag[1]);
    let start = fromServer;
    let known = -1;
    for (let i = 0; i < keys.length; i++) {
      if (seen.has(keys[i])) { known = i; break; }
    }
    if (known >= 0) start = (seen.get(keys[known]) as number) - known;
    // No segment in common with the last playlist: never number backwards
    else if (next >= 0 && start < next) start = next;

    keys.forEach((key, i) => seen.set(key, start + i));
    next = Math.max(next, start + keys.length);
    if (seen.size > maxRemembered) {
      const it = seen.keys();
      while (seen.size > maxRemembered) seen.delete(it.next().value as string);
    }
    return start === fromServer ? playlist : playlist.replace(tag[0], `#EXT-X-MEDIA-SEQUENCE:${start}`);
  };
}
