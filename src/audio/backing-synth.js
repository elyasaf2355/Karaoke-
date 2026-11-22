import { midiToFreq } from "../core/music-theory.js";

const COUNT_IN_BEATS = 4;
const START_DELAY_SEC = 0.3;

function scheduleTone(context, oscillators, { freq, start, duration, gain, type }) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = freq;
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(gain, start + 0.02);
  envelope.gain.setValueAtTime(gain, start + duration - 0.05);
  envelope.gain.linearRampToValueAtTime(0, start + duration);
  oscillator.connect(envelope).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
  oscillators.push(oscillator);
}

/**
 * Schedules a count-in, chords, and (optionally) a guide melody on the audio clock.
 * @returns {{songStart:number, stop:()=>void}} songStart is the audio-clock time of beat 0
 */
export function scheduleBacking(context, song, timeline, { guideMelody }) {
  const oscillators = [];
  const songStart = context.currentTime + START_DELAY_SEC + COUNT_IN_BEATS * timeline.secPerBeat;

  for (let beat = 1; beat <= COUNT_IN_BEATS; beat++) {
    scheduleTone(context, oscillators, { freq: 1000, start: songStart - beat * timeline.secPerBeat, duration: 0.08, gain: 0.12, type: "square" });
  }
  for (const [startBeat, lengthBeats, midis] of song.chords) {
    for (const midi of midis) {
      scheduleTone(context, oscillators, { freq: midiToFreq(midi), start: songStart + startBeat * timeline.secPerBeat, duration: lengthBeats * timeline.secPerBeat, gain: 0.05, type: "triangle" });
    }
  }
  if (guideMelody) {
    for (const note of timeline.notes) {
      scheduleTone(context, oscillators, { freq: midiToFreq(note.midi), start: songStart + note.start, duration: note.end - note.start, gain: 0.12, type: "sine" });
    }
  }
  return {
    songStart,
    stop() { oscillators.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } }); },
  };
}
