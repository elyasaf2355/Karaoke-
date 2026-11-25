/** Pitch and scale vocabulary: note names, scales, and comparisons against a scale or a target note. */

export const NOTE_NAMES_HE = ["דו", "דו♯", "רה", "רה♯", "מי", "פה", "פה♯", "סול", "סול♯", "לה", "לה♯", "סי"];

export const SCALES = {
  major: { label: "מז'ור", steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: "מינור", steps: [0, 2, 3, 5, 7, 8, 10] },
  chromatic: { label: "כרומטי (כל הצלילים)", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

const SEMITONES_PER_OCTAVE = 12;
const CENTS_PER_SEMITONE = 100;
const CENTS_PER_OCTAVE = 1200;
const A4_MIDI = 69;
const SEARCH_RADIUS_SEMITONES = 6;
/** Absorbs floating-point noise so a note exactly on the tolerance boundary counts as in tune. */
const EPSILON = 1e-9;

export const freqToMidi = (freq, referenceA = 440) => A4_MIDI + SEMITONES_PER_OCTAVE * Math.log2(freq / referenceA);
export const midiToFreq = (midi, referenceA = 440) => referenceA * Math.pow(2, (midi - A4_MIDI) / SEMITONES_PER_OCTAVE);
export const pitchClass = (midi) => ((Math.round(midi) % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
export const noteNameOf = (midi) => NOTE_NAMES_HE[pitchClass(midi)];

/**
 * Bitmask of the 12 pitch classes in a key. Relative major and minor share a mask,
 * which is what matters when judging "is this note in the scale".
 */
export function keyMask(root, scaleKey) {
  let mask = 0;
  for (const step of SCALES[scaleKey].steps) mask |= 1 << ((root + step) % SEMITONES_PER_OCTAVE);
  return mask;
}

export const maskContains = (mask, midi) => (mask & (1 << pitchClass(midi))) !== 0;

/** The note in a key mask closest to a (fractional) MIDI pitch, regardless of octave. */
export function nearestNoteInMask(midi, mask) {
  const center = Math.round(midi);
  let best = null;
  for (let candidate = center - SEARCH_RADIUS_SEMITONES; candidate <= center + SEARCH_RADIUS_SEMITONES; candidate++) {
    if (!maskContains(mask, candidate)) continue;
    if (best === null || Math.abs(midi - candidate) < Math.abs(midi - best)) best = candidate;
  }
  return best;
}

/**
 * The scale note closest to a (fractional) MIDI pitch, regardless of octave.
 * @returns {{target:number, noteName:string, cents:number, inScale:boolean}}
 *   cents > 0 means the singer is sharp of the target; < 0 means flat.
 */
export function nearestScaleNote(midi, root, scaleKey) {
  const mask = keyMask(root, scaleKey);
  const target = nearestNoteInMask(midi, mask);
  return { target, noteName: noteNameOf(target), cents: (midi - target) * CENTS_PER_SEMITONE, inScale: maskContains(mask, midi) };
}

/**
 * Compares a sung pitch to a specific target note.
 * @param {{strictOctave:boolean, toleranceCents:number}} options
 * @returns {{ok:boolean, octave:number, cents:number}}
 *   octave: whole octaves between singer and target (negative = too low);
 *   cents: remaining deviation after removing those octaves (positive = sharp).
 */
export function compareToTarget(voiceMidi, targetMidi, { strictOctave, toleranceCents }) {
  const diffCents = (voiceMidi - targetMidi) * CENTS_PER_SEMITONE;
  const octave = Math.round(diffCents / CENTS_PER_OCTAVE);
  const cents = diffCents - octave * CENTS_PER_OCTAVE;
  const ok = Math.abs(cents) <= toleranceCents + EPSILON && (!strictOctave || octave === 0);
  return { ok, octave, cents };
}
