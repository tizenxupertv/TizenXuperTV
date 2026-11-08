import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioContinuityClock, type AudioTrack } from '../src/lib/audioContinuity.ts';

test('AudioContinuityClock initializes with sample rate and channels', () => {
  const clock = new AudioContinuityClock({ sampleRate: 48000, channels: 2 });
  assert.equal(clock.sampleRate, 48000);
  assert.equal(clock.channels, 2);
  assert.equal(clock.filledCount, 0);
  assert.equal(clock.droppedCount, 0);
});

test('AudioContinuityClock preserves seamless audio frames without alteration', () => {
  const clock = new AudioContinuityClock({ sampleRate: 48000, channels: 2 });
  // 1024 samples at 48000Hz in 90kHz ticks: (1024 / 48000) * 90000 = 1920 ticks
  const track: AudioTrack = {
    config: { sampleRate: 48000, channels: 2 },
    samples: [
      { dts: 0, pts: 0, data: new Uint8Array([1, 2, 3]) },
      { dts: 1920, pts: 1920, data: new Uint8Array([4, 5, 6]) },
      { dts: 3840, pts: 3840, data: new Uint8Array([7, 8, 9]) }
    ]
  };

  const result = clock.processSegment(track, 0);
  assert.equal(result.track.samples.length, 3);
  assert.equal(clock.filledCount, 0);
  assert.equal(clock.droppedCount, 0);
});

test('AudioContinuityClock fills gaps with calibrated AAC silence frames', () => {
  const clock = new AudioContinuityClock({ sampleRate: 48000, channels: 2 });
  // Jump from frame 0 to frame 2 (missing frame 1 at 1920 ticks, arriving at 3840 ticks)
  const track: AudioTrack = {
    config: { sampleRate: 48000, channels: 2 },
    samples: [
      { dts: 0, pts: 0, data: new Uint8Array([1, 2, 3]) },
      { dts: 3840, pts: 3840, data: new Uint8Array([7, 8, 9]) }
    ]
  };

  const result = clock.processSegment(track, 0);
  // Missing frame filled! Total should now be 3 frames
  assert.equal(result.track.samples.length, 3);
  assert.equal(clock.filledCount, 1);
  assert.equal(clock.droppedCount, 0);
  // Second sample is the injected silence frame
  assert.equal(result.track.samples[1].key, true);
});

test('AudioContinuityClock drops duplicate or overlapping frames', () => {
  const clock = new AudioContinuityClock({ sampleRate: 48000, channels: 2 });
  // Frame arriving too soon (negative delta)
  const track: AudioTrack = {
    config: { sampleRate: 48000, channels: 2 },
    samples: [
      { dts: 0, pts: 0, data: new Uint8Array([1, 2, 3]) },
      { dts: 100, pts: 100, data: new Uint8Array([9, 9, 9]) }, // duplicate/early
      { dts: 1920, pts: 1920, data: new Uint8Array([4, 5, 6]) }
    ]
  };

  const result = clock.processSegment(track, 0);
  assert.equal(result.track.samples.length, 2);
  assert.equal(clock.droppedCount, 1);
});
