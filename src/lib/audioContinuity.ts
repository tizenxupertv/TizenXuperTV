/**
 * AAC Audio Continuity Clock (adapted from Cactus TV & hls.js remuxer).
 * Preserves PES timing consistency and inserts calibrated AAC-LC silence frames
 * across packet drops or network jitter to prevent audio-video desync in live HLS streams.
 */

// AAC-LC silent frames for 1 to 6 channels (hls.js Apache-2.0)
const SILENT_FRAMES: Record<number, number[]> = {
  1: [0x00, 0xc8, 0x00, 0x80, 0x23, 0x80],
  2: [0x21, 0x00, 0x49, 0x90, 0x02, 0x19, 0x00, 0x23, 0x80]
};

const PACKED_SILENCE: Record<number, string> = {
  3: '00c8008020840126400864008e',
  4: '00c80080208401264000802c80080238',
  5: '00c80080208401264000823004990021900238',
  6: '00c80080208401264000823004990021900200b2002008e0'
};

for (const [channels, hex] of Object.entries(PACKED_SILENCE)) {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  SILENT_FRAMES[Number(channels)] = bytes;
}

export interface AudioSample {
  dts: number;
  pts: number;
  key?: boolean;
  data: Uint8Array | number[];
}

export interface AudioTrackConfig {
  sampleRate: number;
  channels: number;
  codec?: string;
}

export interface AudioTrack {
  config: AudioTrackConfig;
  samples: AudioSample[];
  timescale?: number;
  frameDuration?: number;
}

export class AudioContinuityClock {
  public readonly sampleRate: number;
  public readonly channels: number;
  private nextExpectedDts: number | null = null;
  public filledCount = 0;
  public droppedCount = 0;
  private readonly silenceFrame: Uint8Array | null = null;

  constructor(config: AudioTrackConfig) {
    this.sampleRate = config.sampleRate || 44100;
    this.channels = config.channels || 2;
    const raw = SILENT_FRAMES[this.channels];
    if (raw) {
      this.silenceFrame = new Uint8Array(raw);
    }
  }

  public reset(): void {
    this.nextExpectedDts = null;
    this.filledCount = 0;
    this.droppedCount = 0;
  }

  /**
   * Processes a segment of audio samples, repairing timing gaps with silence frames.
   * Timebase for dts in incoming samples is 90kHz (MPEG-TS PES standard).
   */
  public processSegment(
    track: AudioTrack,
    originDts = 0
  ): { track: AudioTrack; baseOffset: number } {
    const rate = this.sampleRate;
    const step = 1024; // AAC frame duration in samples
    const gapThresholdLimit = Math.round(rate * 0.5); // 500ms max gap before hard re-sync
    const adjustedSamples: AudioSample[] = [];

    for (let i = 0; i < track.samples.length; i++) {
      const sample = track.samples[i];
      // Convert 90kHz PTS/DTS to audio sample units
      const at = Math.round((sample.dts * rate) / 90000);

      if (this.nextExpectedDts === null) {
        this.nextExpectedDts = at;
      }

      const delta = at - this.nextExpectedDts;

      if (Math.abs(delta) > gapThresholdLimit) {
        // Discontinuity too large: realign clock
        this.nextExpectedDts = at;
      } else if (delta > step / 2) {
        // Gap detected: fill with silence frames
        if (this.silenceFrame) {
          const fillCount = Math.round(delta / step);
          for (let n = 0; n < fillCount; n++) {
            adjustedSamples.push({
              dts: this.nextExpectedDts,
              pts: this.nextExpectedDts,
              key: true,
              data: this.silenceFrame
            });
            this.nextExpectedDts += step;
            this.filledCount++;
          }
        } else {
          this.nextExpectedDts = at;
        }
      } else if (delta < -step / 2) {
        // Overlapping or duplicate frame: drop it
        this.droppedCount++;
        continue;
      }

      adjustedSamples.push({
        dts: this.nextExpectedDts,
        pts: this.nextExpectedDts,
        key: sample.key,
        data: sample.data
      });
      this.nextExpectedDts += step;
    }

    const firstDts = adjustedSamples.length > 0 ? adjustedSamples[0].dts : 0;
    const baseOffset = Math.max(0, Math.round(firstDts - (originDts * rate) / 90000));

    return {
      track: {
        ...track,
        timescale: rate,
        frameDuration: step,
        samples: adjustedSamples
      },
      baseOffset
    };
  }
}

