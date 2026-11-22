import { rms } from "./signal.js";

/**
 * Monophonic pitch detection with the YIN algorithm (de Cheveigné & Kawahara, 2002).
 * Works on a time-domain window; returns null when there is no confident pitch.
 */

const DEFAULTS = {
  minFreq: 70,
  maxFreq: 1100,
  /** YIN absolute threshold: first dip below this is taken as the period. */
  threshold: 0.12,
  /** Windows quieter than this (RMS) are treated as silence. */
  minRms: 0.01,
  /** If no dip crosses the threshold, accept the global minimum when below this (0 = never). */
  fallback: 0,
  /** Integration window in samples (0 = half the buffer). */
  window: 0,
};

/** Squared-difference function, then cumulative-mean normalisation (steps 2-3 of YIN). */
function normalizedDifference(samples, windowSize, maxLag) {
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let diffSum = 0;
    for (let i = 0; i < windowSize; i++) {
      const diff = samples[i] - samples[i + lag];
      diffSum += diff * diff;
    }
    runningSum += diffSum;
    cmnd[lag] = runningSum === 0 ? 1 : (diffSum * lag) / runningSum;
  }
  return cmnd;
}

/** First lag whose dip falls below the threshold (walked down to its local minimum). */
function pickLag(cmnd, minLag, maxLag, threshold, fallback) {
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (cmnd[lag] >= threshold) continue;
    while (lag + 1 <= maxLag && cmnd[lag + 1] < cmnd[lag]) lag++;
    return lag;
  }
  if (!fallback) return -1;
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (cmnd[lag] < cmnd[best]) best = lag;
  return cmnd[best] < fallback ? best : -1;
}

/** Parabolic interpolation around the chosen lag for sub-sample accuracy. */
function refineLag(cmnd, lag, maxLag) {
  if (lag <= 1 || lag >= maxLag) return lag;
  const left = cmnd[lag - 1], mid = cmnd[lag], right = cmnd[lag + 1];
  const denominator = 2 * (2 * mid - left - right);
  return denominator === 0 ? lag : lag + (right - left) / denominator;
}

/**
 * @param {Float32Array} samples time-domain window (4096 samples recommended)
 * @param {number} sampleRate
 * @param {Partial<typeof DEFAULTS>} [options]
 * @returns {{freq:number, clarity:number}|null} clarity is 0..1 (1 = perfectly periodic)
 */
export function detectPitch(samples, sampleRate, options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (rms(samples) < o.minRms) return null;

  const windowSize = Math.min(o.window || Math.floor(samples.length / 2), Math.floor(samples.length / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / o.maxFreq));
  const maxLag = Math.min(samples.length - windowSize - 1, Math.floor(sampleRate / o.minFreq));
  if (maxLag <= minLag) return null;

  const cmnd = normalizedDifference(samples, windowSize, maxLag);
  const lag = pickLag(cmnd, minLag, maxLag, o.threshold, o.fallback);
  if (lag < 0) return null;
  return { freq: sampleRate / refineLag(cmnd, lag, maxLag), clarity: 1 - cmnd[lag] };
}
