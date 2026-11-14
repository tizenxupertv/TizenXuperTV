/**
 * Live channels whose video the TV's MediaSource cannot take (HEVC, or a profile too high for an older decoder on
 * Tizen 3-5): hls.js 1.6 drops the video SourceBuffer, reports a non-fatal `bufferAddCodecError` and keeps
 * playing the audio, so the viewer hears the channel over a black box. AVPlay decodes those streams in hardware,
 * so the channel moves there instead.
 * No relative imports, so tests can load this file in Node.
 */

/** The video MIME type hls.js could not add ('' when this error did not cost the picture) */
export function videoCodecRejected(data: any): string {
  if (!data || data.details !== 'bufferAddCodecError') return '';
  const name = String(data.sourceBufferName || '');
  if (name !== 'video' && name !== 'audiovideo') return '';
  return String(data.mimeType || name);
}

export interface LiveAvPlayContext {
  /** The TV has webapis.avplay and the bridge (not a desktop browser) */
  hasAvPlay: boolean;
  /** Channel playing now */
  code: string;
  /** Channel already moved to AVPlay once: when AVPlay fails it comes back to hls.js, which must not move it again */
  triedCode: string;
}

/** Move this live channel from hls.js to AVPlay: its picture was dropped and AVPlay was not tried for it yet */
export function shouldMoveLiveToAvPlay(data: any, ctx: LiveAvPlayContext): boolean {
  return !!videoCodecRejected(data) && ctx.hasAvPlay && !!ctx.code && ctx.triedCode !== ctx.code;
}
