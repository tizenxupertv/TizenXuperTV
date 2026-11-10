/**
 * `.idxg` index like the portal's (layout in src/lib/vodIdxg.ts): a header with the media file name, size and
 * duration, the entry count, then 12-byte entries (u32 time in ms, u64 byte offset)
 */
export function makeIdxg(
  entries: Array<{ off: number; ts: number }>,
  opts: { name?: string; total?: number; durationMs?: number } = {}
): Uint8Array {
  const name = opts.name ?? '0123456789ABCDEF0123456789ABCDEF.ts';
  const header = 13 + name.length;
  const tableStart = header + 38;
  const buf = new Uint8Array(tableStart + entries.length * 12);
  const view = new DataView(buf.buffer);
  const u64 = (pos: number, n: number) => {
    view.setUint32(pos, Math.floor(n / 4294967296));
    view.setUint32(pos + 4, n >>> 0);
  };
  view.setUint32(0, buf.length);
  buf.set([0x69, 0x64, 0x78, 0x67], 4); // "idxg"
  buf[12] = name.length;
  for (let i = 0; i < name.length; i++) buf[13 + i] = name.charCodeAt(i);
  u64(header, opts.total ?? 0);
  view.setUint32(header + 8, opts.durationMs ?? 0);
  buf.set([0, 0x74, 0x73, 0], header + 12); // "\0ts\0"
  view.setUint16(header + 16, 3);
  buf.set([0x68, 0x65, 0x76, 0x63], header + 18); // "hevc"
  buf.set([0x61, 0x61, 0x63, 0], header + 22); // "aac\0"
  view.setUint16(header + 26, 1280);
  view.setUint16(header + 28, 720);
  view.setUint32(header + 30, 24024);
  view.setUint32(header + 34, entries.length);
  entries.forEach((e, i) => {
    const pos = tableStart + i * 12;
    view.setUint32(pos, e.ts);
    u64(pos + 4, e.off);
  });
  return buf;
}
