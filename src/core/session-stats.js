/**
 * Running tally of how a singer is doing, for the end-of-session summary.
 * Records every judged frame as in tune / sharp / flat (octave slips and silence are counted separately).
 */
export class SessionStats {
  constructor() {
    this.counts = { inTune: 0, sharp: 0, flat: 0, octave: 0, silent: 0 };
    this.centsSum = 0;
    this.centsCount = 0;
  }

  /** @param {"inTune"|"sharp"|"flat"|"octave"|"silent"} outcome @param {number} [cents] signed deviation for pitched frames */
  record(outcome, cents) {
    this.counts[outcome]++;
    if (typeof cents === "number" && (outcome === "inTune" || outcome === "sharp" || outcome === "flat")) {
      this.centsSum += cents;
      this.centsCount++;
    }
  }

  get total() { return Object.values(this.counts).reduce((a, b) => a + b, 0); }

  /** Share (0..100) of all frames in an outcome. */
  percent(outcome) { return this.total ? (100 * this.counts[outcome]) / this.total : 0; }

  /** Average signed deviation in cents over pitched frames: negative = tends flat, positive = tends sharp. */
  get biasCents() { return this.centsCount ? this.centsSum / this.centsCount : 0; }

  /** @returns {"flat"|"sharp"|"balanced"} */
  tendency(thresholdCents = 8) {
    if (this.centsCount < 10 || Math.abs(this.biasCents) < thresholdCents) return "balanced";
    return this.biasCents < 0 ? "flat" : "sharp";
  }
}
