/**
 * VOD `.idxg` binary index parser, byte-range HLS playlist builder, and
 * media size recovery fallback when CDN omits total length in Content-Range.
 */

export interface IdxgSegment {
  start: number;
  length: number;
  duration: number;
}

export interface ParsedIdxg {
  name: string;
  mediaTotal: number;
  segments: IdxgSegment[];
}

export interface RangeProbeResponse {
  status: number;
  byteLength: number;
  contentRange?: string | null;
}

const TAIL_PROBE_MAX = 8 * 1024 * 1024;

function toUint8(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) >>> 0) +
    ((buf[offset + 1] << 16) >>> 0) +
    ((buf[offset + 2] << 8) >>> 0) +
    (buf[offset + 3] >>> 0)
  );
}

function readUint64BE(buf: Uint8Array, offset: number): number {
  const hi = readUint32BE(buf, offset);
  const lo = readUint32BE(buf, offset + 4);
  return hi * 4294967296 + lo;
}

function hasIdxgMagic(buf: Uint8Array): boolean {
  return (
    buf.byteLength >= 64 &&
    buf[4] === 0x69 && // 'i'
    buf[5] === 0x64 && // 'd'
    buf[6] === 0x78 && // 'x'
    buf[7] === 0x67    // 'g'
  );
}

function findTableStart(buf: Uint8Array, mediaTotal?: number): number {
  const maxPos = Math.min(256, buf.byteLength - 24);
  for (let pos = 32; pos <= maxPos; pos++) {
    if ((buf.byteLength - pos) % 12 !== 0) continue;
    const off0 = readUint64BE(buf, pos);
    const ts0 = readUint32BE(buf, pos + 8);
    const off1 = readUint64BE(buf, pos + 12);
    const ts1 = readUint32BE(buf, pos + 20);
    const validOff0 = mediaTotal !== undefined ? off0 < mediaTotal : off0 >= 0 && off0 <= 65536;
    const validOff1 = mediaTotal !== undefined ? off1 > off0 && off1 <= mediaTotal : off1 > off0;
    if (ts0 === 0 && validOff0 && validOff1 && ts1 > 0 && ts1 < 60000) {
      return pos;
    }
  }
  return -1;
}

/**
 * Extracts the total size from an HTTP Content-Range header (e.g. "bytes 0-0/1234567")
 * or falls back to Content-Length when valid.
 */
export function parseContentRangeTotal(
  contentRange: string | null | undefined,
  contentLength?: string | number | null
): number {
  const cr = String(contentRange || '');
  const m = /\/(\d+)\s*$/.exec(cr);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0) return n;
  }
  if (contentLength !== undefined && contentLength !== null) {
    const cl = parseInt(String(contentLength), 10);
    if (cl > 1) return cl;
  }
  return 0;
}

/**
 * Finds the last valid byte offset recorded in a `.idxg` index file.
 * Returns 0 if the buffer is not a valid `.idxg` index.
 */
export function indexEnd(input: ArrayBuffer | Uint8Array): number {
  const buf = toUint8(input);
  if (!hasIdxgMagic(buf)) return 0;
  const tableStart = findTableStart(buf);
  if (tableStart < 0) return 0;

  let prevOff = -1;
  let prevTs = -1;
  let lastOff = 0;

  for (let p = tableStart; p + 12 <= buf.byteLength; p += 12) {
    const off = readUint64BE(buf, p);
    const ts = readUint32BE(buf, p + 8);
    if (prevOff >= 0 && (off <= prevOff || ts < prevTs || ts > prevTs + 120000)) {
      break;
    }
    lastOff = off;
    prevOff = off;
    prevTs = ts;
  }

  return lastOff;
}

/**
 * Parses a `.idxg` binary index into byte-range segments with durations in seconds.
 */
export function parseIdxg(input: ArrayBuffer | Uint8Array, mediaTotal?: number): ParsedIdxg {
  const buf = toUint8(input);
  if (!hasIdxgMagic(buf)) {
    throw new Error('Invalid .idxg header');
  }
  const resolvedTotal = mediaTotal && mediaTotal > 0 ? mediaTotal : indexEnd(buf);
  const tableStart = findTableStart(buf, resolvedTotal > 0 ? resolvedTotal : undefined);
  if (tableStart < 0) {
    throw new Error('Could not locate .idxg segment table');
  }

  let nameEnd = 16;
  while (nameEnd < tableStart && buf[nameEnd] !== 0) nameEnd++;
  let name = '';
  for (let i = 16; i < nameEnd; i++) {
    name += String.fromCharCode(buf[i]);
  }

  const entries: Array<{ off: number; ts: number }> = [];
  let prevOff = -1;
  let prevTs = -1;

  for (let p = tableStart; p + 12 <= buf.byteLength; p += 12) {
    const off = readUint64BE(buf, p);
    const ts = readUint32BE(buf, p + 8);
    if (resolvedTotal > 0 && off >= resolvedTotal) break;
    if (prevOff >= 0 && (off <= prevOff || ts < prevTs || ts > prevTs + 120000)) break;
    entries.push({ off, ts });
    prevOff = off;
    prevTs = ts;
  }

  if (entries.length < 2) {
    throw new Error(`Too few .idxg entries (${entries.length})`);
  }

  const finalTotal = Math.max(resolvedTotal, entries[entries.length - 1].off);
  const segments: IdxgSegment[] = [];

  for (let i = 0; i < entries.length; i++) {
    const start = entries[i].off;
    const nextOff = i + 1 < entries.length ? entries[i + 1].off : finalTotal;
    const nextTs = i + 1 < entries.length ? entries[i + 1].ts : entries[i].ts + 1000;
    const length = nextOff - start;
    const duration = Math.max(0.1, (nextTs - entries[i].ts) / 1000);
    if (length > 0) {
      segments.push({ start, length, duration });
    }
  }

  return { name, mediaTotal: finalTotal, segments };
}

/**
 * Merges consecutive ~1s `.idxg` segments into ~targetSec chunks for smooth HLS byte-range playback.
 */
export function groupIdxgSegments(index: ParsedIdxg, targetSec = 4): ParsedIdxg {
  const src = index.segments;
  const out: IdxgSegment[] = [];
  let cur: IdxgSegment | null = null;

  for (let i = 0; i < src.length; i++) {
    const s = src[i];
    if (!cur) {
      cur = { start: s.start, length: s.length, duration: s.duration };
    } else if (cur.start + cur.length === s.start && cur.duration + s.duration <= targetSec + 0.5) {
      cur.length += s.length;
      cur.duration += s.duration;
    } else {
      out.push(cur);
      cur = { start: s.start, length: s.length, duration: s.duration };
    }
  }
  if (cur) out.push(cur);

  return { name: index.name, mediaTotal: index.mediaTotal, segments: out };
}

/**
 * Builds an `#EXTM3U` VOD playlist using `#EXT-X-BYTERANGE` over a single media URL.
 */
export function buildVodTsPlaylist(grouped: { segments: IdxgSegment[] }, mediaUrl: string): string {
  const segs = grouped.segments;
  let maxDur = 1;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].duration > maxDur) maxDur = segs[i].duration;
  }

  const lines: string[] = [
    '#EXTM3U',
    '#EXT-X-VERSION:4',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-TARGETDURATION:' + Math.ceil(maxDur),
    '#EXT-X-MEDIA-SEQUENCE:0'
  ];

  for (let j = 0; j < segs.length; j++) {
    const s = segs[j];
    lines.push('#EXTINF:' + s.duration.toFixed(3) + ',');
    lines.push('#EXT-X-BYTERANGE:' + s.length + '@' + s.start);
    lines.push(mediaUrl);
  }

  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n') + '\n';
}

/**
 * Recovers the exact byte size of a VOD `.ts` media file when the CDN omits the total
 * size in `Content-Range` on `bytes=0-0`:
 *  1. Finds the last valid segment offset `end` from the `.idxg` index.
 *  2. Verifies `bytes=(end-1)-(end-1)` exists (returns 1 byte, or extracts `/total` if present).
 *  3. Probes `bytes=end-(end+8MB-1)` (allowing HTTP 416):
 *     - HTTP 416 or 0 bytes -> exact size is `end`
 *     - 206 Partial Content -> exact size is `end + tail.byteLength`
 */
export async function recoverVodMediaSize(
  idxBytes: ArrayBuffer | Uint8Array,
  fetchRange: (range: string, allow416?: boolean) => Promise<RangeProbeResponse>
): Promise<number> {
  const end = indexEnd(idxBytes);
  if (end <= 0) {
    throw new Error('VOD .idxg has no valid end offset');
  }

  const check = await fetchRange(`bytes=${end - 1}-${end - 1}`, false);
  const totalFromHeader = parseContentRangeTotal(check.contentRange);
  if (totalFromHeader > 0) return totalFromHeader;

  if (check.byteLength !== 1) {
    throw new Error(`VOD media file shorter than .idxg end (${end})`);
  }

  const tail = await fetchRange(`bytes=${end}-${end + TAIL_PROBE_MAX - 1}`, true);
  const tailTotal = parseContentRangeTotal(tail.contentRange);
  if (tailTotal > 0) return tailTotal;

  if (tail.status === 416 || tail.byteLength === 0) {
    return end;
  }
  if (tail.byteLength >= TAIL_PROBE_MAX) {
    throw new Error('VOD tail exceeds 8 MB probe window');
  }
  return end + tail.byteLength;
}
