import { estimateKey, scoreKey } from "./key-estimation.js";
import { keyMask } from "./music-theory.js";

const DEFAULTS = {
  /** Half-life (s) of the slow, stable window and the fast, reactive one. */
  slowHalfLifeSec: 6,
  fastHalfLifeSec: 2.5,
  /** Seconds of usable audio required before the first key is announced. */
  minSec: 3,
  /** How often (s) the key is re-evaluated. */
  evalEverySec: 1,
  /** Consecutive agreeing evaluations needed to switch key. */
  votes: 3,
  /** Correlation below this is "no clear key". */
  minScore: 0.6,
  /** A new key must beat the current one by this much (correlation) in the slow window. */
  margin: 0.04,
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
    this.candidate = null;
    this.candidateVotes = 0;
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
    if (this.sinceEval >= this.o.evalEverySec) {
      this.sinceEval = 0;
      event = this.#evaluate();
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

  #resetCandidate() { this.candidate = null; this.candidateVotes = 0; }

  #evaluate() {
    if (this.usableSec < this.o.minSec || this.weight < this.o.minWeight) return null;
    const slow = Array.from(this.slow);
    const best = estimateKey(slow);
    if (best.score < this.o.minScore) { this.#resetCandidate(); return null; }
    best.mask = keyMask(best.root, best.scale);

    if (!this.key) { this.key = best; return "lock"; }

    const current = this.key;
    if (this.o.onEvaluate) this.o.onEvaluate({ best, current, currentScore: scoreKey(slow, current.root, current.scale), fast: Array.from(this.fast) });

    if (!this.#fastWindowAgrees(best, slow)) { this.#resetCandidate(); return null; }
    if (this.candidate && this.candidate.mask === best.mask) this.candidateVotes++;
    else { this.candidate = best; this.candidateVotes = 1; }

    if (this.candidateVotes < this.o.votes) return null;
    this.key = best;
    this.#resetCandidate();
    return "change";
  }

  /** The new key must differ from the current one, win by a margin, and be the fast window's favourite too. */
  #fastWindowAgrees(best, slow) {
    const current = this.key;
    if (best.mask === current.mask) return false;
    if (best.score - scoreKey(slow, current.root, current.scale) < this.o.margin) return false;
    const fastBest = estimateKey(Array.from(this.fast));
    return keyMask(fastBest.root, fastBest.scale) === best.mask && fastBest.score >= this.o.minScore;
  }
}
