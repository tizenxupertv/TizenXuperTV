import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioSelector, keepOnlyAudio } from '../src/lib/tsAudioSelect.ts';

const PMT_PID = 0x1000;

function packet(pid: number, payload: number[], start = true): Uint8Array {
  const p = new Uint8Array(188).fill(0xff);
  p[0] = 0x47;
  p[1] = (start ? 0x40 : 0) | ((pid >> 8) & 0x1f);
  p[2] = pid & 0xff;
  p[3] = 0x10; // payload only
  p.set(payload, 4);
  return p;
}

/** PAT: one program whose PMT is on PMT_PID */
function pat(): Uint8Array {
  const body = [0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe0 | (PMT_PID >> 8), PMT_PID & 0xff, 0, 0, 0, 0];
  return packet(0, [0x00, 0x00, 0xb0, body.length, ...body]);
}

/** PMT listing the given streams: [type, pid, language?] */
function pmt(streams: Array<[number, number, string?]>): Uint8Array {
  const es: number[] = [];
  for (const [type, pid, lang] of streams) {
    const desc = lang ? [0x0a, 0x04, lang.charCodeAt(0), lang.charCodeAt(1), lang.charCodeAt(2), 0x00] : [];
    es.push(type, 0xe0 | (pid >> 8), pid & 0xff, 0xf0, desc.length, ...desc);
  }
  const body = [0x00, 0x01, 0xc1, 0x00, 0x00, 0xe1, 0x00, 0xf0, 0x00, ...es, 0, 0, 0, 0];
  return packet(PMT_PID, [0x00, 0x02, 0xb0, body.length, ...body]);
}

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** The stream types a PMT packet lists, in order */
function types(bytes: Uint8Array, packetIndex: number): number[] {
  const at = packetIndex * 188;
  let k = at + 5 + 12;
  const end = at + 5 + 3 + (((bytes[at + 6] & 0x0f) << 8) | bytes[at + 7]) - 4;
  const out: number[] = [];
  for (; k + 5 <= end; k += 5 + (((bytes[k + 3] & 0x0f) << 8) | bytes[k + 4])) out.push(bytes[k]);
  return out;
}

const HEVC = 0x24, AAC = 0x0f;
const spaEng = (): Uint8Array => join(pat(), pmt([[HEVC, 256], [AAC, 257, 'spa'], [AAC, 258, 'eng']]), packet(256, [1, 2, 3], false));

test('choosing the second audio leaves it as the only audio stream; the video is untouched', () => {
  const file = spaEng();
  const res = keepOnlyAudio(file, 1);
  assert.equal(res.pmtPid, PMT_PID);
  assert.equal(res.patched, 1);
  assert.deepEqual(types(file, 1), [HEVC, 0xff, AAC], 'Spanish is ignored, English stays');
  assert.equal(file[2 * 188], 0x47, 'the other packets are not moved');
});

test('choosing the first audio hides the others (five audios: four Spanish, one English)', () => {
  const file = join(pat(), pmt([[HEVC, 256], [AAC, 257, 'spa'], [AAC, 258, 'spa'], [AAC, 259, 'spa'], [AAC, 260, 'spa'], [AAC, 261, 'eng']]));
  keepOnlyAudio(file, 4);
  assert.deepEqual(types(file, 1), [HEVC, 0xff, 0xff, 0xff, 0xff, AAC]);
  const first = join(pat(), pmt([[HEVC, 256], [AAC, 257, 'spa'], [AAC, 258, 'eng']]));
  keepOnlyAudio(first, 0);
  assert.deepEqual(types(first, 1), [HEVC, AAC, 0xff]);
});

test('a file with fewer audios than asked, or bytes that are not MPEG-TS, are left as they are', () => {
  const one = join(pat(), pmt([[HEVC, 256], [AAC, 257, 'spa']]));
  const before = one.slice();
  assert.equal(keepOnlyAudio(one, 1).patched, 0);
  assert.deepEqual(one, before);
  const noise = new Uint8Array(1000).fill(7);
  assert.deepEqual(keepOnlyAudio(noise, 1), { pmtPid: 0, patched: 0 });
  assert.deepEqual(keepOnlyAudio(new Uint8Array(0), 1), { pmtPid: 0, patched: 0 });
});

test('a later piece without the program table still gets its PMT edited', () => {
  const select = createAudioSelector(1);
  select(spaEng()); // the first piece says where the PMT is
  const later = join(pmt([[HEVC, 256], [AAC, 257, 'spa'], [AAC, 258, 'eng']]), packet(256, [9], false));
  select(later);
  assert.deepEqual(types(later, 0), [HEVC, 0xff, AAC]);
});

test('every PMT of a piece is edited, and a piece that starts off a packet boundary is handled', () => {
  const twice = join(new Uint8Array([1, 2, 3]), pat(), pmt([[HEVC, 256], [AAC, 257], [AAC, 258]]), packet(256, [0], false), pmt([[HEVC, 256], [AAC, 257], [AAC, 258]]));
  const res = keepOnlyAudio(twice, 1);
  assert.equal(res.patched, 2);
});
