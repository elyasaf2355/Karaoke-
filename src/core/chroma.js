import { freqToMidi, pitchClass } from "./music-theory.js";

const DEFAULTS = {
  minHz: 80,
  maxHz: 2000,
  /** Spectral peaks weaker than this fraction of the strongest peak are ignored (broadband noise, drums). */
  minRelativeLevel: 0.05,
  /** Fundamental of a voice whose harmonics should be erased from the result (0 = none). */
  voiceF0: 0,
  voiceNotchCents: 60,
  voiceMaxHarmonic: 24,
};

const CENTS_PER_OCTAVE = 1200;

/** Sub-bin peak frequency from the log-magnitudes around bin k (parabolic interpolation). */
function peakFrequency(mags, k, binHz) {
  const a = Math.log(mags[k - 1] + 1e-12), b = Math.log(mags[k] + 1e-12), c = Math.log(mags[k + 1] + 1e-12);
  const curvature = a - 2 * b + c;
  const offset = curvature !== 0 ? (0.5 * (a - c)) / curvature : 0;
  return (k + Math.max(-0.5, Math.min(0.5, offset))) * binHz;
}

function isVoiceHarmonic(freq, f0, notchCents, maxHarmonic) {
  const harmonic = Math.round(freq / f0);
  if (harmonic < 1 || harmonic > maxHarmonic) return false;
  return Math.abs(CENTS_PER_OCTAVE * Math.log2(freq / (harmonic * f0))) < notchCents;
}

/**
 * 12-bin pitch-class energy vector from a magnitude spectrum, using spectral peaks only.
 * @param {Float32Array} mags magnitudes (not dB), length fftSize / 2
 */
export function chromaFromMagnitudes(mags, sampleRate, fftSize, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const binHz = sampleRate / fftSize;
  const first = Math.max(2, Math.ceil(o.minHz / binHz));
  const last = Math.min(mags.length - 2, Math.floor(o.maxHz / binHz));
  const chroma = new Float64Array(12);

  let strongest = 0;
  for (let k = first; k <= last; k++) if (mags[k] > strongest) strongest = mags[k];
  if (strongest <= 0) return chroma;

  for (let k = first; k <= last; k++) {
    const isPeak = mags[k] > mags[k - 1] && mags[k] >= mags[k + 1];
    if (!isPeak || mags[k] < strongest * o.minRelativeLevel) continue;
    const freq = peakFrequency(mags, k, binHz);
    if (o.voiceF0 && isVoiceHarmonic(freq, o.voiceF0, o.voiceNotchCents, o.voiceMaxHarmonic)) continue;
    chroma[pitchClass(freqToMidi(freq))] += mags[k];
  }
  return chroma;
}
