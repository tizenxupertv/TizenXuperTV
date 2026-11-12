import { getTvProfile, type TvTier } from './tvProfile.ts';

export interface TvCapabilities {
  tier: TvTier;
  tizen: number;
  hasMSE: boolean;
  hasAVPlay: boolean;
  hasWebAudio: boolean;
  mseH264: boolean;
  mseHevc: boolean;
  mseAac: boolean;
  mseAc3: boolean;
  mseEac3: boolean;
  summary: string;
}

function checkMime(MS: any, mime: string): boolean {
  try {
    return !!(MS && typeof MS.isTypeSupported === 'function' && MS.isTypeSupported(mime));
  } catch {
    return false;
  }
}

export function probeTvCapabilities(w: any = typeof window !== 'undefined' ? window : null): TvCapabilities {
  const profile = getTvProfile(w && w.navigator ? w.navigator.userAgent : '');
  const MS = w ? (w.MediaSource || w.WebKitMediaSource) : null;
  const hasMSE = !!MS;
  const hasAVPlay = !!(w && w.webapis && w.webapis.avplay);
  const hasWebAudio = !!(w && (w.AudioContext || w.webkitAudioContext));

  // Video codecs probe
  const mseH264 = checkMime(MS, 'video/mp4; codecs="avc1.640028"') ||
                  checkMime(MS, 'video/mp4; codecs="avc1.4d401f"') ||
                  checkMime(MS, 'video/mp4; codecs="avc1.42E01E"');

  const mseHevc = checkMime(MS, 'video/mp4; codecs="hvc1.1.6.L93.B0"') ||
                  checkMime(MS, 'video/mp4; codecs="hvc1.1.6.L120.90"') ||
                  checkMime(MS, 'video/mp4; codecs="hev1.1.6.L120.90"');

  // Audio codecs probe
  const mseAac = checkMime(MS, 'audio/mp4; codecs="mp4a.40.2"');
  const mseAc3 = checkMime(MS, 'audio/mp4; codecs="ac-3"');
  const mseEac3 = checkMime(MS, 'audio/mp4; codecs="ec-3"');

  const mark = (ok: boolean) => (ok ? '✓' : '✗');

  const parts = [
    `Tier ${profile.tier}${profile.tizen ? ` (Tizen ${profile.tizen})` : ''}`,
    `AVPlay ${mark(hasAVPlay)}`,
    hasMSE
      ? `MSE [H264 ${mark(mseH264)} · HEVC ${mark(mseHevc)} · AAC ${mark(mseAac)}${mseAc3 ? ' · AC3 ✓' : ''}${mseEac3 ? ' · EAC3 ✓' : ''}]`
      : 'MSE ✗'
  ];

  return {
    tier: profile.tier,
    tizen: profile.tizen,
    hasMSE,
    hasAVPlay,
    hasWebAudio,
    mseH264,
    mseHevc,
    mseAac,
    mseAc3,
    mseEac3,
    summary: parts.join(' · ')
  };
}

let cachedCaps: TvCapabilities | null = null;

export function getTvCapabilities(): TvCapabilities {
  if (!cachedCaps) {
    cachedCaps = probeTvCapabilities();
  }
  return cachedCaps;
}
