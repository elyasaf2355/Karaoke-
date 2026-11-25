// Tests for the smaller core modules: smoothing, stats, timeline, judging, wording, settings.
import test from "node:test";
import assert from "node:assert/strict";
import { SessionStats } from "../src/core/session-stats.js";
import { buildTimeline, noteAt } from "../src/core/song-timeline.js";
import { SongJudge } from "../src/core/song-judge.js";
import { feedbackFor, summaryFor } from "../src/core/feedback.js";
import { createSettings, STRICTNESS, RESPONSE } from "../src/core/settings.js";
import { SONGS } from "../src/core/songs.js";
import { rms } from "../src/core/signal.js";

// ---------- SessionStats ----------
test("SessionStats: empty stats don't divide by zero", () => {
  const s = new SessionStats();
  assert.equal(s.total, 0); assert.equal(s.percent("inTune"), 0); assert.equal(s.biasCents, 0);
  assert.equal(s.tendency(), "balanced");
});

test("SessionStats: percentages add up to 100", () => {
  const s = new SessionStats();
  for (let i = 0; i < 6; i++) s.record("inTune", 5);
  for (let i = 0; i < 3; i++) s.record("sharp", 50);
  s.record("silent");
  const sum = ["inTune", "sharp", "flat", "octave", "silent"].reduce((a, k) => a + s.percent(k), 0);
  assert.ok(Math.abs(sum - 100) < 1e-9);
  assert.equal(s.percent("inTune"), 60);
});

test("SessionStats: a flat singer is reported as flat, with a negative bias", () => {
  const s = new SessionStats();
  for (let i = 0; i < 30; i++) s.record(i % 2 ? "flat" : "inTune", i % 2 ? -40 : -12);
  assert.ok(s.biasCents < -20);
  assert.equal(s.tendency(), "flat");
});

test("SessionStats: errors in both directions cancel out to 'balanced'", () => {
  const s = new SessionStats();
  for (let i = 0; i < 20; i++) s.record(i % 2 ? "sharp" : "flat", i % 2 ? 40 : -40);
  assert.equal(s.tendency(), "balanced");
});

test("SessionStats: octave slips and silence don't distort the bias", () => {
  const s = new SessionStats();
  for (let i = 0; i < 20; i++) s.record("inTune", 0);
  for (let i = 0; i < 20; i++) s.record("octave", 1100);
  for (let i = 0; i < 20; i++) s.record("silent");
  assert.equal(s.biasCents, 0);
});

test("SessionStats: too few pitched frames never claim a tendency", () => {
  const s = new SessionStats();
  for (let i = 0; i < 5; i++) s.record("flat", -90);
  assert.equal(s.tendency(), "balanced");
});

// ---------- timeline ----------
test("buildTimeline: converts beats to seconds and finds the range", () => {
  const t = buildTimeline({ bpm: 120, beats: 8, melody: [[0, 1, 60], [1, 2, 67]], chords: [] });
  assert.equal(t.secPerBeat, 0.5);
  assert.equal(t.durationSec, 4);
  assert.deepEqual(t.notes[1], { start: 0.5, end: 1.5, midi: 67 });
  assert.equal(t.lowest, 60); assert.equal(t.highest, 67);
});

test("noteAt: boundaries are start-inclusive and end-exclusive, and rests return null", () => {
  const notes = [{ start: 0, end: 1, midi: 60 }, { start: 2, end: 3, midi: 62 }];
  assert.equal(noteAt(notes, 0).midi, 60);
  assert.equal(noteAt(notes, 1), null);
  assert.equal(noteAt(notes, 1.5), null);
  assert.equal(noteAt(notes, 2).midi, 62);
  assert.equal(noteAt(notes, -1), null);
});

test("built-in songs are well-formed: sorted, non-overlapping, inside their length, chords cover the song", () => {
  for (const song of SONGS) {
    let end = 0;
    for (const [start, length, midi] of song.melody) {
      assert.ok(start >= end - 1e-9, `${song.id}: note at beat ${start} overlaps the previous one`);
      assert.ok(length > 0 && midi >= 36 && midi <= 96, `${song.id}: bad note ${[start, length, midi]}`);
      end = start + length;
    }
    assert.ok(end <= song.beats + 1e-9, `${song.id}: melody runs past the end`);
    const chordEnd = Math.max(...song.chords.map(([s, l]) => s + l));
    assert.equal(chordEnd, song.beats, `${song.id}: chords should run to the end of the song`);
    assert.ok(song.id && song.title && song.bpm > 0);
  }
  assert.equal(new Set(SONGS.map((s) => s.id)).size, SONGS.length, "song ids must be unique");
});

// ---------- SongJudge ----------
const NOTES = [{ start: 1, end: 2, midi: 64 }, { start: 3, end: 4, midi: 67 }];
const judgeOf = (o = {}) => new SongJudge(NOTES, { octaveMode: "strict", toleranceCents: 35, ...o });

test("SongJudge: rests are not scored", () => {
  const j = judgeOf();
  assert.equal(j.update(0.5, 64).verdict, "rest");
  assert.equal(j.stats.total, 0);
});

test("SongJudge: the grace period at the start of a note is never scored", () => {
  const j = judgeOf();
  const r = j.update(1.05, 50);
  assert.equal(r.scored, false);
  assert.equal(j.stats.total, 0);
});

test("SongJudge: in tune, sharp, flat, octave and silent all get the right verdict", () => {
  const j = judgeOf();
  assert.equal(j.update(1.5, 64).verdict, "inTune");
  assert.equal(j.update(1.5, 64.6).verdict, "sharp");
  assert.equal(j.update(1.5, 63.4).verdict, "flat");
  assert.equal(j.update(1.5, 52).verdict, "octave");
  assert.equal(j.update(1.5, null).verdict, "silent");
  assert.equal(j.stats.total, 5);
});

test("SongJudge: loose octave mode accepts the same note an octave away", () => {
  const j = judgeOf({ octaveMode: "loose" });
  assert.equal(j.update(1.5, 52).verdict, "inTune");
});

test("SongJudge: strictness changes the verdict for the same pitch", () => {
  assert.equal(judgeOf({ toleranceCents: 50 }).update(1.5, 64.45).verdict, "inTune");
  assert.equal(judgeOf({ toleranceCents: 20 }).update(1.5, 64.45).verdict, "sharp");
});

test("SongJudge: a perfect performance scores 100% in tune", () => {
  const j = judgeOf();
  for (const n of NOTES) for (let t = n.start + 0.2; t < n.end; t += 0.05) j.update(t, n.midi);
  assert.equal(j.stats.percent("inTune"), 100);
});

// ---------- feedback wording ----------
test("feedbackFor: every verdict gives a non-empty headline, and direction words match the verdict", () => {
  const view = (verdict, cents = 0, octave = 0) => feedbackFor({ verdict, cents, octave, targetMidi: 64 });
  assert.equal(view("inTune").headline, "בול");
  assert.match(view("sharp", 20).headline, /גבוה/);
  assert.match(view("sharp", 20).headline, /רדו/);
  assert.match(view("flat", -20).headline, /נמוך/);
  assert.match(view("flat", -20).headline, /עלו/);
  assert.match(view("octave", 0, -1).headline, /נמוכה.*עלו/);
  assert.match(view("octave", 0, 1).headline, /גבוהה.*רדו/);
  for (const v of ["inTune", "sharp", "flat", "octave", "silent", "rest"]) assert.ok(view(v).headline.length > 0);
});

test("feedbackFor: small misses are softer than big misses", () => {
  const small = feedbackFor({ verdict: "sharp", cents: 20, octave: 0 }).headline;
  const big = feedbackFor({ verdict: "sharp", cents: 90, octave: 0 }).headline;
  assert.notEqual(small, big);
  assert.match(small, /קצת/); assert.doesNotMatch(big, /קצת/);
});

test("feedbackFor: out-of-scale notes are called out, in-scale notes are not", () => {
  assert.match(feedbackFor({ verdict: "sharp", cents: 30, octave: 0, inScale: false }).detail, /מחוץ לסולם/);
  assert.doesNotMatch(feedbackFor({ verdict: "sharp", cents: 30, octave: 0 }).detail, /מחוץ לסולם/);
});

test("feedbackFor: cents are signed and rounded in the detail", () => {
  assert.match(feedbackFor({ verdict: "sharp", cents: 12.6, octave: 0, targetMidi: 64 }).detail, /\+13 סנט/);
  assert.match(feedbackFor({ verdict: "flat", cents: -12.6, octave: 0, targetMidi: 64 }).detail, /-13 סנט/);
});

test("summaryFor: nothing judged means no summary", () => {
  assert.equal(summaryFor(new SessionStats()), null);
});

test("summaryFor: a flat singer is told so, with the size of the bias", () => {
  const s = new SessionStats();
  for (let i = 0; i < 40; i++) s.record(i % 4 ? "flat" : "inTune", -30);
  const sum = summaryFor(s);
  assert.match(sum.tip, /נמוך בכ־30 סנט/);
  assert.match(sum.headline, /סיכום/);
});

test("summaryFor: lines only mention octave and silence when they happened", () => {
  const s = new SessionStats();
  for (let i = 0; i < 20; i++) s.record("inTune", 0);
  assert.equal(summaryFor(s).lines.some((l) => /אוקטבה|בלי שירה/.test(l)), false);
  s.record("octave", 1200); s.record("silent");
  assert.equal(summaryFor(s).lines.some((l) => /אוקטבה/.test(l)), true);
  assert.equal(summaryFor(s).lines.some((l) => /בלי שירה/.test(l)), true);
});

// ---------- settings ----------
const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
};

test("settings: defaults when nothing is stored", () => {
  const s = createSettings(memoryStorage());
  assert.equal(s.get("strictness"), "normal");
  assert.equal(s.toleranceCents, STRICTNESS.normal.toleranceCents);
});

test("settings: values persist and reload", () => {
  const storage = memoryStorage();
  createSettings(storage).set("strictness", "strict");
  assert.equal(createSettings(storage).get("strictness"), "strict");
  assert.equal(createSettings(storage).toleranceCents, 20);
});

test("settings: corrupt storage falls back to defaults instead of throwing", () => {
  assert.equal(createSettings(memoryStorage({ "karaoke.settings.v1": "{not json" })).get("strictness"), "normal");
  assert.equal(createSettings(memoryStorage({ "karaoke.settings.v1": "null" })).get("root"), 0);
});

test("settings: invalid stored values are dropped one by one, valid ones kept", () => {
  const stored = JSON.stringify({ strictness: "banana", root: 99, scale: "minor", headphones: "yes" });
  const s = createSettings(memoryStorage({ "karaoke.settings.v1": stored }));
  assert.equal(s.get("strictness"), "normal");
  assert.equal(s.get("root"), 0);
  assert.equal(s.get("scale"), "minor");
  assert.equal(s.get("headphones"), true);
});

test("settings: setting an invalid value throws and leaves the old value", () => {
  const s = createSettings(memoryStorage());
  assert.throws(() => s.set("strictness", "banana"), RangeError);
  assert.throws(() => s.set("nope", 1), RangeError);
  assert.equal(s.get("strictness"), "normal");
});

test("settings: subscribers hear real changes only, and can unsubscribe", () => {
  const s = createSettings(memoryStorage());
  const heard = [];
  const off = s.subscribe((k, v) => heard.push([k, v]));
  s.set("strictness", "strict"); s.set("strictness", "strict");
  assert.deepEqual(heard, [["strictness", "strict"]]);
  off(); s.set("strictness", "relaxed");
  assert.equal(heard.length, 1);
});

test("settings: unavailable storage (null, or throws) never breaks the app", () => {
  assert.doesNotThrow(() => createSettings(null).set("strictness", "strict"));
  const angry = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const s = createSettings(angry);
  assert.doesNotThrow(() => s.set("strictness", "relaxed"));
  assert.equal(s.get("strictness"), "relaxed");
});

// ---------- signal ----------
test("rms: empty buffer is 0, a full-scale square wave is 1, a sine is 1/sqrt(2)", () => {
  assert.equal(rms(new Float32Array(0)), 0);
  assert.equal(rms(new Float32Array(100).fill(-1)), 1);
  const sine = Float32Array.from({ length: 4410 }, (_, i) => Math.sin((2 * Math.PI * i * 441) / 44100));
  assert.ok(Math.abs(rms(sine) - Math.SQRT1_2) < 1e-3);
});

// ---------- SongJudge "free" mode (the singer's own key) ----------
/** A long melody so the shift has time to be learned. */
const LONG = Array.from({ length: 40 }, (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.45, midi: [60, 62, 64, 65, 67, 69][i % 6] }));
function sing(judge, offsetSemitones, { from = 0, to = 20, cents = 0 } = {}) {
  const results = [];
  for (let t = from; t < to; t += 0.02) {
    const note = LONG.find((n) => t >= n.start && t < n.end);
    results.push(judge.update(t, note ? note.midi + offsetSemitones + cents / 100 : null));
  }
  return results;
}
const freeJudge = (o = {}) => new SongJudge(LONG, { octaveMode: "free", toleranceCents: 35, ...o });

test("free mode: a singer a fourth below the melody is judged accurate", () => {
  const j = freeJudge();
  sing(j, -5);
  assert.equal(j.shift, -5);
  assert.ok(j.stats.percent("inTune") > 95, `${j.stats.percent("inTune")}`);
});

test("free mode: octave plus semitone offsets are learned too (+13)", () => {
  const j = freeJudge();
  sing(j, 13);
  assert.equal(j.shift, 13);
  assert.ok(j.stats.percent("inTune") > 95);
});

test("free mode: strict mode would have failed the same performance (control)", () => {
  const j = judgeOfLong("strict");
  sing(j, -5);
  assert.ok(j.stats.percent("inTune") < 5);
});
function judgeOfLong(octaveMode) { return new SongJudge(LONG, { octaveMode, toleranceCents: 35 }); }

test("free mode: a transposed singer who is out of tune is still caught", () => {
  const j = freeJudge();
  sing(j, -5, { cents: 0, to: 6 });                  // learn the shift on accurate notes
  const sharp = sing(j, -5, { from: 6, to: 20, cents: 60 }).filter((r) => r.scored);
  assert.ok(sharp.length > 100);
  assert.ok(sharp.filter((r) => r.verdict === "sharp").length / sharp.length > 0.9);
});

test("free mode: nothing is scored until the shift is known, so the start never counts against the singer", () => {
  const j = freeJudge();
  const early = sing(j, -7, { to: 0.25 });
  assert.equal(early.filter((r) => r.scored).length, 0);
  assert.equal(j.stats.total, 0);
});

test("free mode: shift doesn't flap for a consistently flat singer (-40 cents)", () => {
  const j = freeJudge();
  const shifts = new Set(sing(j, 0, { to: 20, cents: -40 }).map((r) => r.shift));
  assert.deepEqual([...shifts], [0]);
});

test("free mode: a singer who changes key part-way is followed", () => {
  const j = freeJudge();
  sing(j, -3, { to: 10 });
  assert.equal(j.shift, -3);
  sing(j, 2, { from: 10, to: 20 });
  assert.equal(j.shift, 2);
});

test("free mode: with no singing at all the shift stays 0 and silence is not an error", () => {
  const j = freeJudge();
  for (let t = 0; t < 10; t += 0.05) j.update(t, null);
  assert.equal(j.shift, 0);
});

test("strict and loose modes never learn a shift", () => {
  for (const mode of ["strict", "loose"]) {
    const j = judgeOfLong(mode);
    sing(j, -5);
    assert.equal(j.shift, 0, mode);
  }
});

test("settings: the meter response defaults to calm, is validated, persists, and maps to a time constant", () => {
  const storage = memoryStorage();
  const s = createSettings(storage);
  assert.equal(s.get("meterResponse"), "calm");
  assert.equal(s.smoothingSec, RESPONSE.calm.timeConstantSec);
  s.set("meterResponse", "quick");
  assert.equal(createSettings(storage).smoothingSec, RESPONSE.quick.timeConstantSec);
  assert.throws(() => s.set("meterResponse", "frantic"), RangeError);
  assert.ok(RESPONSE.calm.timeConstantSec > RESPONSE.normal.timeConstantSec && RESPONSE.normal.timeConstantSec > RESPONSE.quick.timeConstantSec);
});
