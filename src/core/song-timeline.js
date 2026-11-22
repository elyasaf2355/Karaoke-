/** Turns a song definition (beats) into a timeline in seconds. */

/**
 * @typedef {{id:string, title:string, bpm:number, beats:number, melody:Array<[number,number,number]>, chords:Array<[number,number,number[]]>}} Song
 * melody entries are [startBeat, lengthBeats, midi]; chord entries are [startBeat, lengthBeats, midis[]].
 */

/** @returns {{secPerBeat:number, durationSec:number, notes:Array<{start:number,end:number,midi:number}>, lowest:number, highest:number}} */
export function buildTimeline(song) {
  const secPerBeat = 60 / song.bpm;
  const notes = song.melody.map(([startBeat, lengthBeats, midi]) => ({
    start: startBeat * secPerBeat,
    end: (startBeat + lengthBeats) * secPerBeat,
    midi,
  }));
  const pitches = notes.map((n) => n.midi);
  return { secPerBeat, durationSec: song.beats * secPerBeat, notes, lowest: Math.min(...pitches), highest: Math.max(...pitches) };
}

/** The note sounding at a given time, or null in a rest. */
export function noteAt(notes, timeSec) {
  return notes.find((n) => timeSec >= n.start && timeSec < n.end) ?? null;
}
