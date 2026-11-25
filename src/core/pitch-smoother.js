import { median } from "./signal.js";

const DEFAULTS = {
  /**
   * Window (s) of the first-stage median. It is longer than half a vibrato cycle (~5-6 Hz), so wobble averages
   * out, and a glitch (such as an octave error) has to dominate most of it to get through.
   */
  medianWindowSec: 0.15,
  /**
   * Time constant (s) of the low-pass after the median. A human voice wobbles (vibrato plus irregular jitter),
   * so the display should follow the average pitch, not every wobble. 0 disables it.
   */
  timeConstantSec: 0.5,
  /** When the median is this far (semitones) from the smoothed value for a while, it is a new note, not a wobble... */
  jumpSemitones: 0.5,
  /** ...as soon as it has stayed that far away this long (s). */
  jumpConfirmSec: 0.05,
  /** Everything is forgotten after this much silence (s). */
  forgetAfterSec: 0.4,
};

/** The longest gap (s) between readings that still counts as continuous when advancing the low-pass. */
const MAX_STEP_SEC = 0.25;

/**
 * Turns noisy per-frame pitch readings into a steady pitch.
 * Stage 1: median over a short time window (removes glitches and averages out the wobble).
 * Stage 2: running average that starts as a plain cumulative mean (so a new note settles on its true pitch within
 *          a fraction of a second) and becomes a slow exponential low-pass (so the display never twitches).
 * A real note change is recognised and followed quickly instead of being smeared.
 */
export class PitchSmoother {
  constructor(options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.recent = [];
    this.value = null;
    this.ageSec = 0; // time since the value was (re)started: first reading or last accepted note change
    this.jumpSince = null;
    this.lastHeardAt = -Infinity;
  }

  /** Adds a reading (MIDI, fractional) and returns the smoothed pitch. */
  push(midi, timeSec) {
    this.recent.push({ t: timeSec, midi });
    while (this.recent.length > 1 && this.recent[0].t < timeSec - this.o.medianWindowSec) this.recent.shift();
    const windowMedian = median(this.recent.map((r) => r.midi));

    if (this.value === null) { this.value = windowMedian; this.ageSec = 0; }
    else this.#follow(windowMedian, timeSec);

    this.lastHeardAt = timeSec;
    return this.value;
  }

  #follow(windowMedian, timeSec) {
    const step = Math.min(Math.max(timeSec - this.lastHeardAt, 0), MAX_STEP_SEC);
    const difference = windowMedian - this.value;
    if (Math.abs(difference) > this.o.jumpSemitones) {
      this.jumpSince ??= timeSec;
      if (timeSec - this.jumpSince >= this.o.jumpConfirmSec) { this.value = windowMedian; this.ageSec = 0; this.jumpSince = null; }
      return; // otherwise hold: it may only be a wobble or a glitch
    }
    this.jumpSince = null;
    this.ageSec += step;
    const exponential = this.o.timeConstantSec > 0 ? 1 - Math.exp(-step / this.o.timeConstantSec) : 1;
    const cumulative = step / (this.ageSec + step || 1); // equal-weight mean of everything since the start
    this.value += Math.max(exponential, cumulative) * difference;
  }

  /** Reports that nothing was heard at this moment. */
  miss(timeSec) {
    if (timeSec - this.lastHeardAt > this.o.forgetAfterSec) this.reset();
  }

  /** Seconds since the last real reading. */
  silentFor(timeSec) { return timeSec - this.lastHeardAt; }
}
