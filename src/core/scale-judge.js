import { ScaleNoteLatch, ToleranceLatch } from "./hysteresis.js";

/**
 * "How is this pitch against the scale": picks the target note and decides in tune / sharp / flat,
 * with hysteresis on both decisions so the display doesn't flicker. Used by the tuner and karaoke modes.
 */
export class ScaleJudge {
  constructor() {
    this.noteLatch = new ScaleNoteLatch();
    this.toleranceLatch = new ToleranceLatch();
  }

  /** Call when the singer stops, so the next note starts fresh. */
  reset() {
    this.noteLatch.reset();
    this.toleranceLatch.reset();
  }

  /**
   * @returns {{scaleNote:{target:number,noteName:string,cents:number,inScale:boolean}, verdict:"inTune"|"sharp"|"flat"}}
   */
  judge(midi, root, scaleKey, toleranceCents) {
    const scaleNote = this.noteLatch.update(midi, root, scaleKey);
    const withinTolerance = this.toleranceLatch.update(Math.abs(scaleNote.cents), toleranceCents);
    const verdict = scaleNote.inScale && withinTolerance ? "inTune" : scaleNote.cents > 0 ? "sharp" : "flat";
    return { scaleNote, verdict };
  }
}
