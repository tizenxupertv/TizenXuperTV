/**
 * Some live sources (EPIC+'s ESPN channels, the "tiktok" family) hide each MPEG-TS segment inside a PNG served by an
 * image CDN, so it passes as a picture. The video is the data of one chunk: on 14-nov a private "prVt" chunk after
 * IHDR, the TS from byte 41, with IDAT and IEND after it. Before that the TS started at byte 67. The chunks are read
 * instead of trusting a fixed offset, which broke every such channel when the wrapper changed.
 * No imports, so tests can load this file in Node.
 */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TS_PACKET = 188;
const TS_SYNC = 0x47;

function isPng(b: Uint8Array): boolean {
  if (b.length < 16) return false;
  for (let i = 0; i < PNG_MAGIC.length; i++) if (b[i] !== PNG_MAGIC[i]) return false;
  return true;
}

/** Whether `len` bytes from `at` look like TS packets (sync byte every 188 bytes, a few checked) */
function looksLikeTs(b: Uint8Array, at: number, len: number): boolean {
  if (len < TS_PACKET || b[at] !== TS_SYNC) return false;
  const checks = Math.min(5, Math.floor(len / TS_PACKET));
  for (let k = 1; k < checks; k++) if (b[at + k * TS_PACKET] !== TS_SYNC) return false;
  return true;
}

/**
 * The TS inside a PNG-wrapped segment, or null when the bytes are not a PNG (the segment is used as it came).
 * The chunk holding TS packets is taken; if the chunks cannot be walked, the bytes from the first TS sync run.
 */
export function unwrapPngTs(b: Uint8Array): Uint8Array | null {
  if (!isPng(b)) return null;
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const data = i + 8;
    if (data + len > b.length) break;
    if (looksLikeTs(b, data, len)) return b.subarray(data, data + len - (len % TS_PACKET));
    i = data + len + 4;
  }
  // Not walkable: the first run of TS packets, cut to whole packets
  for (let at = 8; at + TS_PACKET * 2 < b.length; at++) {
    if (looksLikeTs(b, at, b.length - at)) {
      const whole = Math.floor((b.length - at) / TS_PACKET) * TS_PACKET;
      return b.subarray(at, at + whole);
    }
  }
  return null;
}
