import { median } from "./signal.js";

/** Median filter over the last few pitch readings; forgets everything after a stretch of silence. */
export class PitchSmoother {
  constructor({ size = 5, forgetAfterSec = 0.4 } = {}) {
    this.size = size;
    this.forgetAfterSec = forgetAfterSec;
    this.readings = [];
    this.lastHeardAt = -Infinity;
  }

  /** Adds a reading and returns the smoothed pitch. */
  push(midi, timeSec) {
    this.readings.push(midi);
    if (this.readings.length > this.size) this.readings.shift();
    this.lastHeardAt = timeSec;
    return median(this.readings);
  }

  /** Reports that nothing was heard at this moment. */
  miss(timeSec) {
    if (timeSec - this.lastHeardAt > this.forgetAfterSec) this.readings = [];
  }

  /** Seconds since the last real reading. */
  silentFor(timeSec) { return timeSec - this.lastHeardAt; }
}
