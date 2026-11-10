/**
 * Choosing the audio of an MPEG-TS file for hls.js.
 *
 * The portal's titles carry every audio language in one file ("spa,eng"), each on its own stream. hls.js plays the
 * first audio stream the file's table of contents (the PMT) lists and has no way to pick another. Here the PMT of
 * each downloaded piece is edited before hls.js reads it: every audio stream except the wanted one is marked as a
 * type hls.js ignores, so the wanted one is the first it finds. hls.js does not check the table's CRC.
 * No relative imports, so tests can load this file in Node.
 */
const PACKET = 188;
const SYNC = 0x47;
/** MPEG audio, AAC (ADTS and LATM), AC-3 and E-AC-3: the stream types that are audio */
const AUDIO_TYPES = [0x03, 0x04, 0x0f, 0x11, 0x81, 0x87, 0xc1, 0xc2];
/** A reserved type no demuxer plays */
const IGNORED_TYPE = 0xff;

/** Offset of the first packet: a sync byte followed by another one a packet later */
function firstPacket(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length - PACKET, PACKET * 4);
  for (let i = 0; i <= limit; i++) {
    if (bytes[i] === SYNC && (i + PACKET >= bytes.length || bytes[i + PACKET] === SYNC)) return i;
  }
  return -1;
}

/** Start of the table inside a packet that begins one (after the header, the adaptation field and the pointer) */
function sectionStart(bytes: Uint8Array, at: number): number {
  if (!(bytes[at + 1] & 0x40)) return -1; // not the start of a table
  const adaptation = (bytes[at + 3] >> 4) & 3;
  if (!(adaptation & 1)) return -1; // no payload
  let p = at + 4;
  if (adaptation & 2) p += 1 + bytes[p];
  p += 1 + bytes[p]; // pointer field
  return p < at + PACKET - 12 ? p : -1;
}

/**
 * Edits `bytes` in place so that only the audio stream number `keep` (0-based, in the file's order) is seen as
 * audio. `pmtPid`: the table's stream id when a previous piece already told it (0: look for it here).
 * Returns that id (0 when this piece does not say) and how many tables were edited.
 */
export function keepOnlyAudio(bytes: Uint8Array, keep: number, pmtPid = 0): { pmtPid: number; patched: number } {
  const start = firstPacket(bytes);
  if (start < 0 || keep < 0) return { pmtPid, patched: 0 };
  let pmt = pmtPid;
  // The program table (PAT, stream 0) says which stream carries the PMT
  for (let at = start; !pmt && at + PACKET <= bytes.length; at += PACKET) {
    if (bytes[at] !== SYNC || (((bytes[at + 1] & 0x1f) << 8) | bytes[at + 2]) !== 0) continue;
    const p = sectionStart(bytes, at);
    if (p < 0 || bytes[p] !== 0x00) continue;
    const end = Math.min(p + 3 + (((bytes[p + 1] & 0x0f) << 8) | bytes[p + 2]) - 4, at + PACKET);
    for (let k = p + 8; k + 4 <= end; k += 4) {
      if (((bytes[k] << 8) | bytes[k + 1]) !== 0) {
        pmt = ((bytes[k + 2] & 0x1f) << 8) | bytes[k + 3];
        break;
      }
    }
  }
  if (!pmt) return { pmtPid: 0, patched: 0 };

  let patched = 0;
  for (let at = start; at + PACKET <= bytes.length; at += PACKET) {
    if (bytes[at] !== SYNC || (((bytes[at + 1] & 0x1f) << 8) | bytes[at + 2]) !== pmt) continue;
    const p = sectionStart(bytes, at);
    if (p < 0 || bytes[p] !== 0x02) continue;
    const end = Math.min(p + 3 + (((bytes[p + 1] & 0x0f) << 8) | bytes[p + 2]) - 4, at + PACKET);
    let k = p + 12 + (((bytes[p + 10] & 0x0f) << 8) | bytes[p + 11]);
    // First count: a file with fewer audio streams than asked is left as it is (its first audio plays)
    let audios = 0;
    for (let q = k; q + 5 <= end; q += 5 + (((bytes[q + 3] & 0x0f) << 8) | bytes[q + 4])) {
      if (AUDIO_TYPES.indexOf(bytes[q]) !== -1) audios++;
    }
    if (keep >= audios) continue;
    let index = 0;
    let changed = false;
    for (; k + 5 <= end; k += 5 + (((bytes[k + 3] & 0x0f) << 8) | bytes[k + 4])) {
      if (AUDIO_TYPES.indexOf(bytes[k]) === -1) continue;
      if (index !== keep) {
        bytes[k] = IGNORED_TYPE;
        changed = true;
      }
      index++;
    }
    if (changed) patched++;
  }
  return { pmtPid: pmt, patched };
}

/** A selector for one playback: remembers where the PMT is between pieces */
export function createAudioSelector(keep: number): (bytes: Uint8Array) => void {
  let pmtPid = 0;
  return bytes => {
    pmtPid = keepOnlyAudio(bytes, keep, pmtPid).pmtPid || pmtPid;
  };
}
