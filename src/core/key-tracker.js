import { estimateKey, scoreKey } from "./key-estimation.js";
import { keyMask } from "./music-theory.js";

/** Accumulated float timestamps can fall a hair short of a round interval; don't let that skip a check. */
const TIME_TOLERANCE_SEC = 1e-6;

const DEFAULTS = {
  /** Half-life (s) of the slow, stable window and the fast, reactive one. */
  slowHalfLifeSec: 5,
  fastHalfLifeSec: 2.5,
  /** Seconds of usable audio required before the first key is announced. */
  minSec: 3,
  /** How often (s) the key is re-evaluated. */
  evalEverySec: 0.1,
  /**
   * Evidence (correlation x seconds) needed before switching. Each evaluation adds
   * (how much better the best key fits than the current one - margin) x elapsed time, never going below 0.
   * Strong evidence therefore switches sooner than weak evidence, short-lived evidence never does,
   * and the result doesn't depend on exactly when the evaluations happen to fall.
   */
  evidenceNeeded: 0.4,
  /** Correlation below this is "no clear key". */
  minScore: 0.6,
  /**
   * How much better (correlation, slow window) another key must fit before it counts as evidence at all.
   * After a real key change the old key's fit collapses (a big gap); a borrowed chord only makes
   * another key look slightly better.
   */
  margin: 0.15,
  /** Frames quieter than this (RMS) are ignored. */
  minRms: 0.002,
  minWeight: 0.5,
  /** Frames containing singing still count, but less (their harmonics are already removed). */
  voicedWeight: 0.5,
  /** Debug hook: called on every evaluation of an existing key. */
  onEvaluate: null,
};

/**
 * Follows the key of the backing music over time, including key changes mid-song.
 *
 * Two exponentially-decaying chroma windows (slow = stable, fast = reactive). The key only changes when
 * both windows agree on the same new key, the slow window prefers it by a clear margin, and that holds for
 * several consecutive evaluations. A single borrowed chord therefore doesn't flip the key, while a real
 * modulation is picked up within one chord cycle or two.
 */
export class KeyTracker {
  constructor(options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.slow = new Float64Array(12);
    this.fast = new Float64Array(12);
    this.weight = 0;
    this.usableSec = 0;
    this.sinceEval = 0;
    this.key = null;
    this.evidence = 0;
  }

  /**
   * @param {{chroma:ArrayLike<number>, rms:number, dt:number, voiced:boolean}} frame
   * @returns {{key:object|null, event:"lock"|"change"|null}}
   */
  push({ chroma, rms, dt, voiced }) {
    this.#decay(dt);
    if (rms >= this.o.minRms) this.#accumulate(chroma, dt, voiced);
    this.sinceEval += dt;
    let event = null;
    if (this.sinceEval >= this.o.evalEverySec - TIME_TOLERANCE_SEC) {
      const elapsed = this.sinceEval;
      this.sinceEval = 0;
      event = this.#evaluate(elapsed);
    }
    return { key: this.key, event };
  }

  #decay(dt) {
    const slowFactor = Math.pow(0.5, dt / this.o.slowHalfLifeSec);
    const fastFactor = Math.pow(0.5, dt / this.o.fastHalfLifeSec);
    for (let i = 0; i < 12; i++) { this.slow[i] *= slowFactor; this.fast[i] *= fastFactor; }
    this.weight *= slowFactor;
  }

  #accumulate(chroma, dt, voiced) {
    let total = 0;
    for (let i = 0; i < 12; i++) total += chroma[i];
    if (total <= 0) return;
    const w = (voiced ? this.o.voicedWeight : 1) * dt;
    for (let i = 0; i < 12; i++) {
      const share = (chroma[i] / total) * w;
      this.slow[i] += share;
      this.fast[i] += share;
    }
    this.weight += w;
    this.usableSec += w;
  }

  #evaluate(elapsedSec) {
    if (this.usableSec < this.o.minSec || this.weight < this.o.minWeight) return null;
    const slow = Array.from(this.slow);
    const best = estimateKey(slow);
    if (best.score < this.o.minScore) { this.evidence = Math.max(0, this.evidence - this.o.margin * elapsedSec); return null; }
    best.mask = keyMask(best.root, best.scale);

    if (!this.key) { this.key = best; return "lock"; }

    const current = this.key;
    const currentScore = scoreKey(slow, current.root, current.scale);
    if (this.o.onEvaluate) this.o.onEvaluate({ best, current, currentScore, fast: Array.from(this.fast) });

    const gap = best.mask === current.mask ? 0 : best.score - currentScore;
    this.evidence = Math.max(0, this.evidence + (gap - this.o.margin) * elapsedSec);
    if (this.evidence < this.o.evidenceNeeded || !this.#fastWindowAgrees(best)) return null;

    this.key = best;
    this.evidence = 0;
    return "change";
  }

  /** The fast window must independently pick the same new key, so a half-blended window can't trigger a switch. */
  #fastWindowAgrees(best) {
    const fastBest = estimateKey(Array.from(this.fast));
    return keyMask(fastBest.root, fastBest.scale) === best.mask && fastBest.score >= this.o.minScore;
  }
}
