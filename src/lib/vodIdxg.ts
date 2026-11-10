/**
 * VOD `.idxg` binary index parser, byte-range HLS playlist builder, and
 * media size recovery fallback when CDN omits total length in Content-Range.
 *
 * Layout of a portal `.idxg`, checked against real files (movies and episodes); numbers are big-endian:
 *    0  u32  length of this index file
 *    4  "idxg"
 *    8  u32  0
 *   12  u8   length of the media file name, then the name
 *   then 38 bytes: u64 media size in bytes · u32 duration in ms · container ("\0ts\0") · u16 · video codec (4) ·
 *                  audio codec (4) · u16 width · u16 height · u32 frame rate x1000 · u32 number of entries
 *   then the entries, 12 bytes each: u32 time in ms, then u64 byte offset of a keyframe (188-aligned, ≤ 5 s apart)
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
const TS_PACKET_SIZE = 188;
const TS_SYNC_BYTE = 0x47;
const ENTRY_SIZE = 12;
/** Bytes between the end of the media file name and the first entry */
const HEADER_AFTER_NAME = 38;
/** No entry is further than this from the previous one (keyframes come every few seconds) */
const MAX_ENTRY_GAP_MS = 120000;

/**
 * Aligns a byte offset down to the nearest 188-byte MPEG-TS packet boundary, counted from `base` (the first
 * indexed packet), so a file whose packets do not start at byte 0 keeps its real boundaries.
 */
export function alignTsOffset(offset: number, base = 0): number {
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  const from = Number.isFinite(base) && base > 0 && base <= offset ? base : 0;
  return offset - ((offset - from) % TS_PACKET_SIZE);
}

/**
 * Aligns an MPEG-TS buffer so it starts on a valid 0x47 sync byte and has a length
 * that is an exact multiple of 188 bytes, preventing demuxer sync loss on legacy Tizen TVs.
 */
export function alignTsPacketBuffer(input: ArrayBuffer | Uint8Array): Uint8Array {
  const buf = toUint8(input);
  if (buf.byteLength < TS_PACKET_SIZE) return new Uint8Array(0);
  let start = 0;
  const maxSearch = Math.min(buf.byteLength - TS_PACKET_SIZE, TS_PACKET_SIZE * 4);
  for (let i = 0; i <= maxSearch; i++) {
    if (
      buf[i] === TS_SYNC_BYTE &&
      (i + TS_PACKET_SIZE >= buf.byteLength || buf[i + TS_PACKET_SIZE] === TS_SYNC_BYTE)
    ) {
      start = i;
      break;
    }
  }
  const usable = buf.byteLength - start;
  const alignedLen = usable - (usable % TS_PACKET_SIZE);
  if (alignedLen <= 0) return new Uint8Array(0);
  return buf.subarray(start, start + alignedLen);
}

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

/** Two entries that look like the start of a table: time and offset both grow, by sane amounts */
function looksLikeTable(buf: Uint8Array, pos: number): boolean {
  if (pos < 32 || pos + ENTRY_SIZE * 2 > buf.byteLength) return false;
  const ts0 = readUint32BE(buf, pos);
  const off0 = readUint64BE(buf, pos + 4);
  const ts1 = readUint32BE(buf, pos + ENTRY_SIZE);
  const off1 = readUint64BE(buf, pos + ENTRY_SIZE + 4);
  return ts1 > ts0 && ts1 - ts0 <= MAX_ENTRY_GAP_MS && off1 > off0 && off1 < Number.MAX_SAFE_INTEGER;
}

/** The entry count sits right before the table: the table starts where that count equals the entries left */
function countMatches(buf: Uint8Array, pos: number): boolean {
  if (pos < 32 || pos > buf.byteLength || (buf.byteLength - pos) % ENTRY_SIZE !== 0) return false;
  return readUint32BE(buf, pos - 4) === (buf.byteLength - pos) / ENTRY_SIZE;
}

function findTableStart(buf: Uint8Array): number {
  const expected = 13 + buf[12] + HEADER_AFTER_NAME;
  if (countMatches(buf, expected) && looksLikeTable(buf, expected)) return expected;
  // A header of another length: the count still marks where the table starts
  const maxPos = Math.min(512, buf.byteLength - ENTRY_SIZE * 2);
  for (let pos = 32; pos <= maxPos; pos++) {
    if (countMatches(buf, pos) && looksLikeTable(buf, pos)) return pos;
  }
  // A count that does not match (index cut short, or with bytes after the table): the usual place, when it reads well
  return looksLikeTable(buf, expected) ? expected : -1;
}

interface IdxgTable {
  name: string;
  /** Media size from the header (0 when it does not make sense) */
  mediaTotal: number;
  /** Media duration from the header, in ms (0 when it does not make sense) */
  durationMs: number;
  entries: Array<{ off: number; ts: number }>;
}

/** Header and entries of an index; entries stop at the first one that does not follow the previous */
function readIdxg(buf: Uint8Array): IdxgTable {
  if (!hasIdxgMagic(buf)) {
    throw new Error('Invalid .idxg header');
  }
  const tableStart = findTableStart(buf);
  if (tableStart < 0) {
    throw new Error('Could not locate .idxg segment table');
  }

  const nameEnd = Math.min(13 + buf[12], tableStart);
  let name = '';
  for (let i = 13; i < nameEnd && buf[i] !== 0; i++) {
    name += String.fromCharCode(buf[i]);
  }

  const entries: Array<{ off: number; ts: number }> = [];
  let prevOff = -1;
  let prevTs = -1;
  for (let p = tableStart; p + ENTRY_SIZE <= buf.byteLength; p += ENTRY_SIZE) {
    const ts = readUint32BE(buf, p);
    const off = readUint64BE(buf, p + 4);
    if (prevOff >= 0 && (off <= prevOff || ts < prevTs || ts > prevTs + MAX_ENTRY_GAP_MS)) break;
    entries.push({ off, ts });
    prevOff = off;
    prevTs = ts;
  }

  // Size and duration sit at a fixed distance before the table; a value the entries contradict is ignored
  const last = entries[entries.length - 1];
  const headerAt = tableStart - HEADER_AFTER_NAME;
  const headerTotal = headerAt >= 13 ? readUint64BE(buf, headerAt) : 0;
  const headerMs = headerAt >= 13 ? readUint32BE(buf, headerAt + 8) : 0;
  return {
    name,
    mediaTotal: last && headerTotal > last.off && headerTotal < Number.MAX_SAFE_INTEGER ? headerTotal : 0,
    durationMs: last && headerMs > last.ts && headerMs <= last.ts + MAX_ENTRY_GAP_MS ? headerMs : 0,
    entries
  };
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
  try {
    const entries = readIdxg(toUint8(input)).entries;
    return entries.length ? entries[entries.length - 1].off : 0;
  } catch {
    return 0;
  }
}

/**
 * Parses a `.idxg` binary index into byte-range segments with durations in seconds. The media size and duration
 * come from the index header; `mediaTotal` (the size the CDN reported) wins over the header's when given.
 */
export function parseIdxg(input: ArrayBuffer | Uint8Array, mediaTotal?: number): ParsedIdxg {
  const table = readIdxg(toUint8(input));
  const total = mediaTotal && mediaTotal > 0 ? mediaTotal : table.mediaTotal;
  const entries = total > 0 ? table.entries.filter(e => e.off < total) : table.entries;

  if (entries.length < 2) {
    throw new Error(`Too few .idxg entries (${entries.length})`);
  }

  const lastEntry = entries[entries.length - 1];
  const finalTotal = Math.max(total, lastEntry.off);
  // The last piece runs to the end of the media: its length from the header's duration, or 1 s when unknown
  const endTs = table.durationMs > lastEntry.ts ? table.durationMs : lastEntry.ts + 1000;
  const base = entries[0].off;
  const segments: IdxgSegment[] = [];

  for (let i = 0; i < entries.length; i++) {
    const start = alignTsOffset(entries[i].off, base);
    const rawNext = i + 1 < entries.length ? entries[i + 1].off : finalTotal;
    const nextOff = alignTsOffset(rawNext, base);
    const nextTs = i + 1 < entries.length ? entries[i + 1].ts : endTs;
    const length = nextOff - start;
    // The real distance, however short (keyframes 41 ms apart at a scene cut): rounding it up moved the timeline
    const duration = Math.max(0.001, (nextTs - entries[i].ts) / 1000);
    if (length > 0) {
      segments.push({ start, length, duration });
    }
  }

  return { name: table.name, mediaTotal: finalTotal, segments };
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
