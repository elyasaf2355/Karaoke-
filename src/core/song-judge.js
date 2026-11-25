import { compareToTarget } from "./music-theory.js";
import { noteAt } from "./song-timeline.js";
import { SessionStats } from "./session-stats.js";
import { median } from "./signal.js";
import { ToleranceLatch } from "./hysteresis.js";

/**
 * How strictly the singer's pitch is matched to the melody:
 *  strict - the exact notes, same octave
 *  loose  - the right notes in any octave
 *  free   - the singer's own key: the whole melody may be shifted by whole semitones (and octaves);
 *           the shift is learned while singing. Judges accuracy relative to the singer, not to the score.
 */
export const OCTAVE_MODES = ["strict", "loose", "free"];

const SHIFT_MIN_SAMPLES = 15;
const SHIFT_WINDOW = 80;
/** The learned shift only moves when the evidence clearly points to another whole semitone. */
const SHIFT_HYSTERESIS = 0.65;

/**
 * Judges a singer against a known melody, frame by frame.
 * The first moments of each note are a grace period: transitions aren't counted against the singer.
 */
export class SongJudge {
  /**
   * @param {Array<{start:number,end:number,midi:number}>} notes
   * @param {{octaveMode:"strict"|"loose"|"free", toleranceCents:number, graceSec?:number}} options
   */
  constructor(notes, { octaveMode, toleranceCents, graceSec = 0.15 }) {
    this.notes = notes;
    this.octaveMode = octaveMode;
    this.toleranceCents = toleranceCents;
    this.graceSec = graceSec;
    this.stats = new SessionStats();
    this.shift = 0;
    this.recentDiffs = [];
    this.toleranceLatch = new ToleranceLatch();
    this.currentNote = null;
  }

  /** Learns the singer's offset from the melody (semitones) while in "free" mode. */
  #learnShift(voiceMidi, noteMidi) {
    this.recentDiffs.push(voiceMidi - noteMidi);
    if (this.recentDiffs.length > SHIFT_WINDOW) this.recentDiffs.shift();
    if (this.recentDiffs.length < SHIFT_MIN_SAMPLES) return;
    const estimate = median(this.recentDiffs);
    if (Math.abs(estimate - this.shift) > SHIFT_HYSTERESIS) this.shift = Math.round(estimate);
  }

  get #shiftKnown() { return this.octaveMode !== "free" || this.recentDiffs.length >= SHIFT_MIN_SAMPLES; }

  /**
   * @param {number} songTimeSec time in the song that this audio frame corresponds to
   * @param {number|null} midi the singer's smoothed pitch, or null when nobody is singing
   * @returns {{note:object|null, verdict:"rest"|"silent"|"inTune"|"sharp"|"flat"|"octave", cents:number, octave:number, scored:boolean, shift:number}}
   */
  update(songTimeSec, midi) {
    const note = noteAt(this.notes, songTimeSec);
    if (!note) return { note: null, verdict: "rest", cents: 0, octave: 0, scored: false, shift: this.shift };
    if (note !== this.currentNote) { this.currentNote = note; this.toleranceLatch.reset(); } // each note starts fresh
    const pastGrace = songTimeSec - note.start >= this.graceSec;

    if (midi === null) {
      if (pastGrace && this.#shiftKnown) this.stats.record("silent");
      return { note, verdict: "silent", cents: 0, octave: 0, scored: pastGrace, shift: this.shift };
    }
    if (this.octaveMode === "free" && pastGrace) this.#learnShift(midi, note.midi);

    const target = note.midi + (this.octaveMode === "free" ? this.shift : 0);
    const { octave, cents } = compareToTarget(midi, target, { strictOctave: false, toleranceCents: this.toleranceCents });
    const withinTolerance = this.toleranceLatch.update(Math.abs(cents), this.toleranceCents);
    const ok = withinTolerance && (this.octaveMode !== "strict" || octave === 0);
    const verdict = ok ? "inTune" : this.octaveMode === "strict" && octave !== 0 ? "octave" : cents > 0 ? "sharp" : "flat";
    const scored = pastGrace && this.#shiftKnown;
    if (scored) this.stats.record(verdict, cents);
    return { note, verdict, cents, octave, scored, shift: this.shift };
  }
}
