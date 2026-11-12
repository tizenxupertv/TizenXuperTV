import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeTvCapabilities } from '../src/lib/tvCapabilities.ts';

test('probeTvCapabilities detects MSE codecs, AVPlay and generates a clear summary', () => {
  const mockWindow = {
    navigator: {
      userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.5 TV Safari/537.36'
    },
    webapis: {
      avplay: {}
    },
    AudioContext: function () {},
    MediaSource: {
      isTypeSupported: (mime: string) => {
        if (mime.includes('avc1')) return true;
        if (mime.includes('mp4a.40.2')) return true;
        // HEVC not supported in this mock
        return false;
      }
    }
  };

  const caps = probeTvCapabilities(mockWindow);
  assert.equal(caps.tier, 'mid');
  assert.equal(caps.tizen, 5.5);
  assert.equal(caps.hasAVPlay, true);
  assert.equal(caps.hasMSE, true);
  assert.equal(caps.hasWebAudio, true);
  assert.equal(caps.mseH264, true);
  assert.equal(caps.mseHevc, false);
  assert.equal(caps.mseAac, true);
  assert.ok(caps.summary.includes('Tier mid (Tizen 5.5)'));
  assert.ok(caps.summary.includes('AVPlay ✓'));
  assert.ok(caps.summary.includes('H264 ✓'));
  assert.ok(caps.summary.includes('HEVC ✗'));
  assert.ok(caps.summary.includes('AAC ✓'));
});

test('probeTvCapabilities handles environment without MediaSource gracefully', () => {
  const mockWindow = {
    navigator: {
      userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 3.0) AppleWebKit/538.1 Version/3.0'
    }
  };

  const caps = probeTvCapabilities(mockWindow);
  assert.equal(caps.tier, 'legacy');
  assert.equal(caps.hasMSE, false);
  assert.equal(caps.hasAVPlay, false);
  assert.ok(caps.summary.includes('MSE ✗'));
  assert.ok(caps.summary.includes('AVPlay ✗'));
});
