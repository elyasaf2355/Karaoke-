const TIME_WINDOW = 4096;
const SPECTRUM_SIZE = 16384;

/** Reads time-domain windows and magnitude spectra from a microphone source. */
export class MicTap {
  constructor(context, source) {
    this.context = context;
    this.timeAnalyser = context.createAnalyser();
    this.timeAnalyser.fftSize = TIME_WINDOW;
    this.spectrumAnalyser = context.createAnalyser();
    this.spectrumAnalyser.fftSize = SPECTRUM_SIZE;
    this.spectrumAnalyser.smoothingTimeConstant = 0; // no averaging: the key tracker does its own smoothing
    source.connect(this.timeAnalyser);
    source.connect(this.spectrumAnalyser);

    this.samples = new Float32Array(TIME_WINDOW);
    this.decibels = new Float32Array(this.spectrumAnalyser.frequencyBinCount);
    this.magnitudes = new Float32Array(this.spectrumAnalyser.frequencyBinCount);
  }

  get sampleRate() { return this.context.sampleRate; }
  get fftSize() { return SPECTRUM_SIZE; }
  get now() { return this.context.currentTime; }

  /** Latest window of raw samples (the same array is reused every call). */
  readSamples() {
    this.timeAnalyser.getFloatTimeDomainData(this.samples);
    return this.samples;
  }

  /** Latest magnitude spectrum, converted from the analyser's dB scale (array reused every call). */
  readMagnitudes() {
    this.spectrumAnalyser.getFloatFrequencyData(this.decibels);
    for (let k = 0; k < this.decibels.length; k++) this.magnitudes[k] = Math.pow(10, this.decibels[k] / 20);
    return this.magnitudes;
  }
}
