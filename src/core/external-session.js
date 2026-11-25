import { detectPitch } from "./pitch-detector.js";
import { chromaFromMagnitudes } from "./chroma.js";
import { KeyTracker } from "./key-tracker.js";
import { PitchSmoother } from "./pitch-smoother.js";
import { freqToMidi } from "./music-theory.js";
import { rms } from "./signal.js";

const MIN_CLARITY = 0.85;
/** Timestamps are floating point: a frame that is 0.1999999 s after the last one is still "0.2 s later". */
const TIME_TOLERANCE_SEC = 1e-6;
/** How long after hearing the singer a frame still counts as "voiced". */
const VOICED_HANG_SEC = 0.3;
/** YIN threshold loose enough to find a voice over loud accompaniment (tuned on mixes, see tests). */
const VOICE_YIN_THRESHOLD = 0.2;

/**
 * "Karaoke over a speaker" logic: finds the singer's pitch above the music and follows the music's key.
 * Pure (no DOM / audio APIs): feed it time-domain windows and magnitude spectra, read results back.
 * Lifecycle: calibrate() on music-only audio, endCalibration(), then process() frame by frame.
 */
export class ExternalSession {
  /**
   * @param {number} sampleRate
   * @param {{fftSize?:number, voiceGate?:number, chromaEverySec?:number, tracker?:object, smoothing?:object, voiceHandling?:"notch"|"none"}} options
   *   voiceHandling "none" disables removing the singer from the key analysis (used by control tests).
   */
  constructor(sampleRate, options = {}) {
    this.sampleRate = sampleRate;
    this.fftSize = options.fftSize ?? 16384;
    this.voiceGate = options.voiceGate ?? 1.8;
    this.chromaEverySec = options.chromaEverySec ?? 0.1;
    this.voiceHandling = options.voiceHandling ?? "notch";
    this.tracker = new KeyTracker(options.tracker);
    this.smoother = new PitchSmoother(options.smoothing);
    this.baseline = 0.01;
    this.calibrating = true;
    this.calibrationSum = 0;
    this.calibrationFrames = 0;
    this.lastVoiceAt = -Infinity;
    this.lastVoiceFreq = 0;
    this.lastChromaAt = null;
  }

  /** Feed music-only windows while calibrating. */
  calibrate(samples) {
    this.calibrationSum += rms(samples);
    this.calibrationFrames++;
  }

  endCalibration() {
    if (this.calibrationFrames) this.baseline = Math.max(0.005, this.calibrationSum / this.calibrationFrames);
    this.calibrating = false;
  }

  get musicHeard() { return this.calibrationFrames > 0 && this.calibrationSum / this.calibrationFrames > 0.002; }
  get key() { return this.tracker.key; }

  /** True when a new spectrum is needed for key analysis (lets callers skip the FFT read on other frames). */
  chromaDue(timeSec) { return this.lastChromaAt === null || timeSec - this.lastChromaAt >= this.chromaEverySec - TIME_TOLERANCE_SEC; }

  /**
   * @param {Float32Array} samples time-domain window
   * @param {Float32Array|null} magnitudes spectrum (not dB) of the latest window, or null to skip key analysis this frame
   * @param {number} timeSec
   * @returns {{midi:number|null, key:object|null, event:"lock"|"change"|null}}
   */
  process(samples, magnitudes, timeSec) {
    const midi = this.#detectVoice(samples, timeSec);
    const event = magnitudes ? this.#updateKey(samples, magnitudes, timeSec) : null;
    return { midi, key: this.tracker.key, event };
  }

  #detectVoice(samples, timeSec) {
    const found = this.calibrating ? null : detectPitch(samples, this.sampleRate, {
      minRms: this.baseline * this.voiceGate,
      threshold: VOICE_YIN_THRESHOLD,
    });
    if (found && found.clarity > MIN_CLARITY) {
      this.lastVoiceAt = timeSec;
      this.lastVoiceFreq = found.freq;
      return this.smoother.push(freqToMidi(found.freq), timeSec);
    }
    this.smoother.miss(timeSec);
    return null;
  }

  #updateKey(samples, magnitudes, timeSec) {
    if (this.lastChromaAt === null) this.lastChromaAt = timeSec - this.chromaEverySec;
    const dt = timeSec - this.lastChromaAt;
    if (dt < this.chromaEverySec - TIME_TOLERANCE_SEC) return null;
    this.lastChromaAt = timeSec;

    const voiced = this.voiceHandling !== "none" && timeSec - this.lastVoiceAt < VOICED_HANG_SEC;
    const chroma = chromaFromMagnitudes(magnitudes, this.sampleRate, this.fftSize, { voiceF0: voiced ? this.lastVoiceFreq : 0 });
    return this.tracker.push({ chroma, rms: rms(samples), dt, voiced }).event;
  }
}
