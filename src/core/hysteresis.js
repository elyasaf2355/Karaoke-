import { SCALES, maskContains, keyMask, noteNameOf, nearestNoteInMask } from "./music-theory.js";

/**
 * Small state machines that stop a display from flickering when a value hovers around a decision boundary.
 */

const CENTS_PER_SEMITONE = 100;

/**
 * Picks the scale note a pitch is being compared to, but sticks with the previous choice until a different
 * note is clearly closer. Without this, a pitch near the middle between two notes makes the target (and the
 * deviation, +50 to -50 cents) flip back and forth on every frame.
 */
export class ScaleNoteLatch {
  /** @param {{switchMarginSemitones?:number}} [options] how much closer another note must be before switching */
  constructor({ switchMarginSemitones = 0.2 } = {}) {
    this.margin = switchMarginSemitones;
    this.target = null;
  }

  reset() { this.target = null; }

  /** @returns {{target:number, noteName:string, cents:number, inScale:boolean}} (same shape as nearestScaleNote) */
  update(midi, root, scaleKey) {
    if (!SCALES[scaleKey]) throw new RangeError(`Unknown scale ${scaleKey}`);
    const mask = keyMask(root, scaleKey);
    const nearest = nearestNoteInMask(midi, mask);
    const keep = this.target !== null && maskContains(mask, this.target);
    if (!keep || Math.abs(midi - this.target) - Math.abs(midi - nearest) >= this.margin) this.target = nearest;
    return {
      target: this.target,
      noteName: noteNameOf(this.target),
      cents: (midi - this.target) * CENTS_PER_SEMITONE,
      inScale: maskContains(mask, midi),
    };
  }
}

/**
 * "In tune" with a dead band: enters at the tolerance, but only leaves a few cents beyond it.
 * A pitch hovering at the edge therefore stays "in tune" instead of flipping every frame.
 */
export class ToleranceLatch {
  constructor({ exitMarginCents = 8 } = {}) {
    this.exitMargin = exitMarginCents;
    this.inside = false;
  }

  reset() { this.inside = false; }

  /** @returns {boolean} whether the pitch currently counts as in tune */
  update(absCents, toleranceCents) {
    this.inside = this.inside ? absCents <= toleranceCents + this.exitMargin : absCents <= toleranceCents;
    return this.inside;
  }
}
