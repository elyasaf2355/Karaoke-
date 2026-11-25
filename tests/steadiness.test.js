// Steadiness: the meter must not twitch with a wobbly human voice, must still follow real note changes quickly,
// and the key tracker must check often without false switches. Each behaviour has a control (the old behaviour)
// that fails the same thresholds, so these tests are known to be able to fail.
import test from "node:test";
import assert from "node:assert/strict";
import { PitchSmoother } from "../src/core/pitch-smoother.js";
import { ScaleNoteLatch, ToleranceLatch } from "../src/core/hysteresis.js";
import { ScaleJudge } from "../src/core/scale-judge.js";
import { SongJudge } from "../src/core/song-judge.js";
import { KeyTracker } from "../src/core/key-tracker.js";
import { ExternalSession } from "../src/core/external-session.js";
import { nearestScaleNote, keyMask } from "../src/core/music-theory.js";
import * as H from "./helpers.js";

const OLD_SMOOTHER = { medianWindowSec: 5 / 60, timeConstantSec: 0, jumpSemitones: 100 }; // median of 5 frames, no low-pass: the previous behaviour
const cents = (midi) => (midi - Math.round(midi)) * 100;

/** Runs readings through a smoother and returns [{t, value, truth}]. */
function smooth(readings, options) {
  const s = new PitchSmoother(options);
  return readings.map((r) => ({ t: r.t, value: s.push(r.midi, r.t), truth: r.truth }));
}
const steady = (v) => (v);

// ---------- PitchSmoother ----------
test("smoother: a wobbly steady note comes out steady (>= 8x less wobble, std <= 3 cents, no frame jump > 2 cents)", () => {
  const readings = H.wobblyReadings(() => 69, { sec: 8 });
  const rawStd = H.stability(readings.slice(60).map((r) => (r.midi - 69) * 100)).std;
  const out = smooth(readings).slice(60); // smooth everything, then look past the first second
  const st = H.stability(out.map((o) => (o.value - 69) * 100));
  assert.ok(rawStd > 25, `the test signal should be genuinely wobbly (std ${rawStd.toFixed(1)}c)`);
  assert.ok(st.std <= 3 && rawStd / st.std >= 8, `std ${st.std.toFixed(1)}c (${(rawStd / st.std).toFixed(1)}x reduction)`);
  assert.ok(st.maxJump <= 2, `max jump ${st.maxJump.toFixed(2)}c`);
});

test("smoother (control): the previous behaviour barely reduces the wobble and jumps around", () => {
  const readings = H.wobblyReadings(() => 69, { sec: 8 });
  const rawStd = H.stability(readings.slice(60).map((r) => (r.midi - 69) * 100)).std;
  const st = H.stability(smooth(readings, OLD_SMOOTHER).slice(60).map((o) => (o.value - 69) * 100));
  assert.ok(rawStd / st.std < 2, `old behaviour reduced the wobble ${(rawStd / st.std).toFixed(1)}x`);
  assert.ok(st.maxJump > 10, `old max jump only ${st.maxJump.toFixed(1)}c`);
});

test("smoother: a new note settles on its true pitch quickly (over 40 different voices)", () => {
  // Measured over 60 voices: error at 0.5 s median 4.6c / p90 8.3c, at 1.5 s median 1.7c / p90 3.9c.
  const errors = { 0.5: [], 1.5: [] };
  for (let seed = 1; seed <= 40; seed++) {
    const out = smooth(H.wobblyReadings(() => 62.4, { sec: 3, seed }));
    for (const t of [0.5, 1.5]) errors[t].push(Math.abs(out.find((o) => o.t >= t).value - 62.4) * 100);
  }
  const quantile = (list, p) => [...list].sort((x, y) => x - y)[Math.floor(p * (list.length - 1))];
  assert.ok(quantile(errors[0.5], 0.5) < 6 && quantile(errors[0.5], 0.9) < 10, `0.5 s: ${quantile(errors[0.5], 0.5).toFixed(1)}c / ${quantile(errors[0.5], 0.9).toFixed(1)}c`);
  assert.ok(quantile(errors[1.5], 0.5) < 3 && quantile(errors[1.5], 0.9) < 6, `1.5 s: ${quantile(errors[1.5], 0.5).toFixed(1)}c / ${quantile(errors[1.5], 0.9).toFixed(1)}c`);
});

for (const fps of [30, 60, 120]) {
  test(`smoother: steadiness doesn't depend on the frame rate (${fps} fps)`, () => {
    const raw = H.wobblyReadings(() => 62.3, { sec: 8, fps, seed: 4 });
    const out = smooth(raw).slice(fps); // after the first second
    assert.ok(H.stability(out.map((o) => (o.value - 62.3) * 100)).std <= 5);
  });
}

test("smoother: the unwobbly part of the voice is kept (a centred note stays centred within 3 cents)", () => {
  for (const offset of [-35, 0, 30]) {
    const out = smooth(H.wobblyReadings(() => 69 + offset / 100, { sec: 8, seed: 9 })).slice(60); // after the first second
    const mean = out.reduce((a, o) => a + o.value, 0) / out.length;
    assert.ok(Math.abs((mean - 69) * 100 - offset) < 3, `offset ${offset}: mean at ${((mean - 69) * 100).toFixed(1)}c`);
  }
});

/** Seconds after a step until the smoothed value is within 20 cents of the new pitch (Infinity if never). */
function stepLag(semitones, options) {
  const stepAt = 3;
  const raw = H.wobblyReadings((t) => (t < stepAt ? 60 : 60 + semitones), { sec: 6, seed: 7 });
  const out = smooth(raw, options);
  const hit = out.find((o) => o.t > stepAt && Math.abs(o.value - (60 + semitones)) < 0.2);
  return hit ? hit.t - stepAt : Infinity;
}

for (const semitones of [1, -1, 2, -2, 3, 5, -7, 12, -12]) {
  test(`smoother: a real ${semitones > 0 ? "+" : ""}${semitones} semitone note change is followed within 0.25 s, even with vibrato`, () => {
    const lag = stepLag(semitones);
    assert.ok(lag <= 0.25, `lag ${lag.toFixed(3)}s`);
  });
}

test("smoother (control): a plain slow low-pass without jump detection is far too slow for a note change", () => {
  const lag = stepLag(1, { medianWindowSec: 0.15, timeConstantSec: 0.3, jumpSemitones: 100 });
  assert.ok(lag > 0.4, `only ${lag.toFixed(2)}s`);
});

test("smoother: a very short glitch (octave error, <= 3 frames) never reaches the output", () => {
  for (const glitchFrames of [1, 2, 3]) {
    const raw = H.wobblyReadings(() => 64, { sec: 6, seed: 2 });
    const start = 200;
    for (let i = 0; i < glitchFrames; i++) raw[start + i].midi += 12;
    const worst = Math.max(...smooth(raw).map((o) => Math.abs(o.value - 64)));
    assert.ok(worst < 0.3, `${glitchFrames}-frame glitch moved the output by ${worst.toFixed(2)} semitones`);
  }
});

test("smoother (control): without the median stage a glitch passes straight through", () => {
  const raw = H.wobblyReadings(() => 64, { sec: 6, seed: 2 });
  raw[200].midi += 12;
  const worst = Math.max(...smooth(raw, { medianWindowSec: 0, timeConstantSec: 0, jumpSemitones: 100 }).map((o) => Math.abs(o.value - 64)));
  assert.ok(worst > 5);
});

test("smoother: a change that lasts (0.3 s) is a real note and is accepted", () => {
  const raw = H.wobblyReadings((t) => (t > 3 && t < 3.3 ? 76 : 64), { sec: 6, seed: 3 });
  assert.ok(smooth(raw).some((o) => o.value > 75));
});

// A calm meter lags a glide by about  slope x (time constant + half the median window). Fast slides are
// caught up by the note-change detection, so the lag is bounded instead of growing with the speed.
function glideError(rateSemitonesPerSec, options) {
  const out = smooth(H.wobblyReadings((t) => 60 + rateSemitonesPerSec * t, { sec: 5, seed: 5 }), options).filter((o) => o.t > 2);
  return Math.max(...out.map((o) => Math.abs(o.value - o.truth) * 100));
}

test("smoother: a slow glide (0.4 semitone/s) lags by what the time constant predicts, plus a little wobble", () => {
  const predicted = 0.4 * (0.5 + 0.075) * 100; // slope x (tau + half the median window), in cents
  const error = glideError(0.4);
  assert.ok(error <= predicted + 10, `error ${error.toFixed(0)}c, predicted ${predicted.toFixed(0)}c`);
});

test("smoother: fast slides lag by a bounded amount, not in proportion to speed (the note-change detection catches up)", () => {
  // bound: the jump threshold (50c) + what the median window and confirmation delay cost at that speed + wobble margin
  for (const rate of [2, 5, 8]) {
    const bound = 50 + rate * 12.5 + 40;
    assert.ok(glideError(rate) < bound, `${rate} st/s: ${glideError(rate).toFixed(0)}c, bound ${bound}c`);
  }
});

test("smoother: a quick meter follows a 1 semitone/s glide within 40 cents", () => {
  assert.ok(glideError(1, { timeConstantSec: 0.15 }) < 40);
});

test("smoother: the time constant is a real dial (calm moves less than quick on the same wobble)", () => {
  const raw = H.wobblyReadings(() => 69, { sec: 8, seed: 6 });
  const std = (tc) => H.stability(smooth(raw, { timeConstantSec: tc }).slice(60).map((o) => (o.value - 69) * 100)).std;
  assert.ok(std(0.5) < std(0.3) && std(0.3) < std(0.15), `${std(0.5)} ${std(0.3)} ${std(0.15)}`);
});

test("smoother: first reading is returned as is, silence is tracked, a short gap keeps the value, a long one forgets", () => {
  const s = new PitchSmoother({ forgetAfterSec: 0.4 });
  assert.equal(s.silentFor(1), Infinity);
  assert.equal(s.push(65.2, 1), 65.2);
  assert.ok(Math.abs(s.silentFor(1.5) - 0.5) < 1e-9);
  s.miss(1.2);
  assert.notEqual(s.value, null, "a 0.2 s gap should keep the value");
  s.miss(1.6);
  assert.equal(s.value, null);
  assert.equal(s.push(70, 2), 70, "old readings must not leak into the new note");
});

test("smoother: irregular frame timing and a gap in the middle don't break it", () => {
  const s = new PitchSmoother();
  const rand = H.rng(3);
  let t = 0, last = 0;
  for (let i = 0; i < 400; i++) { t += 0.005 + rand() * 0.04; last = s.push(60 + Math.sin(t * 30) * 0.3, t); if (i === 200) t += 0.3; }
  assert.ok(Number.isFinite(last) && Math.abs(last - 60) < 0.2);
});

// ---------- hysteresis ----------
/** Counts how many times a series changes value. */
const flips = (series) => series.reduce((n, x, i) => n + (i && x !== series[i - 1] ? 1 : 0), 0);

test("note latch: hovering between two notes doesn't flip the target (control: nearestScaleNote flips constantly)", () => {
  // The latch comes after the smoother, so its input wobbles by a few cents (see the smoother tests), not by tens.
  const rand = H.rng(8), latch = new ScaleNoteLatch();
  const pitches = Array.from({ length: 300 }, () => 69.5 + (rand() - 0.5) * 0.1); // ±5 cents around the boundary
  const latched = pitches.map((m) => latch.update(m, 0, "chromatic").target);
  const plain = pitches.map((m) => nearestScaleNote(m, 0, "chromatic").target);
  assert.ok(flips(plain) > 30, `control only flipped ${flips(plain)} times`);
  assert.ok(flips(latched) <= 1, `latched flipped ${flips(latched)} times`);
});

test("note latch: still moves on once another note is clearly closer", () => {
  const latch = new ScaleNoteLatch();
  assert.equal(latch.update(69.0, 0, "chromatic").target, 69);
  assert.equal(latch.update(69.55, 0, "chromatic").target, 69, "barely past the middle: stay");
  assert.equal(latch.update(69.8, 0, "chromatic").target, 70, "clearly closer to the next note: move");
  assert.equal(latch.update(69.45, 0, "chromatic").target, 70, "and now stick to the new one");
});

test("note latch: works across the gap between scale notes (C major, C and D are 2 semitones apart)", () => {
  const latch = new ScaleNoteLatch();
  assert.equal(latch.update(60.0, 0, "major").target, 60);
  assert.equal(latch.update(61.05, 0, "major").target, 60);
  assert.equal(latch.update(61.3, 0, "major").target, 62);
});

test("note latch: reports cents against the latched target, and flags notes outside the scale", () => {
  const latch = new ScaleNoteLatch();
  latch.update(69.0, 0, "chromatic");
  const r = latch.update(69.52, 0, "chromatic");
  assert.equal(r.target, 69);
  assert.ok(Math.abs(r.cents - 52) < 1e-6);
  assert.equal(new ScaleNoteLatch().update(61.0, 0, "major").inScale, false);
});

test("note latch: a changed scale or a reset re-evaluates; unknown scale throws", () => {
  const latch = new ScaleNoteLatch();
  latch.update(61.0, 0, "chromatic");                      // C#
  assert.notEqual(latch.update(61.0, 0, "major").target, 61, "C# isn't in C major any more");
  latch.update(66, 0, "chromatic"); latch.reset();
  assert.equal(latch.update(60.52, 0, "chromatic").target, 61);
  assert.throws(() => latch.update(60, 0, "klingon"), RangeError);
});

test("tolerance latch: hovering at the tolerance edge doesn't flip (control: a plain threshold does)", () => {
  const rand = H.rng(5), latch = new ToleranceLatch();
  const edge = Array.from({ length: 300 }, () => 35 + (rand() - 0.5) * 8); // 31..39 cents
  const latched = edge.map((c) => latch.update(c, 35));
  const plain = edge.map((c) => c <= 35);
  assert.ok(flips(plain) > 30);
  assert.ok(flips(latched) <= 1);
});

test("tolerance latch: enters at the tolerance, leaves only beyond tolerance + margin, resets", () => {
  const latch = new ToleranceLatch({ exitMarginCents: 8 });
  assert.equal(latch.update(36, 35), false, "outside: not in tune yet");
  assert.equal(latch.update(35, 35), true);
  assert.equal(latch.update(42, 35), true, "inside the dead band: stays in tune");
  assert.equal(latch.update(44, 35), false);
  assert.equal(latch.update(40, 35), false, "and must come back inside the tolerance itself to re-enter");
  latch.update(10, 35); latch.reset();
  assert.equal(latch.update(40, 35), false);
});

test("scale judge: verdict is steady at the edge, and notes outside the scale are never 'in tune'", () => {
  const rand = H.rng(12), judge = new ScaleJudge();
  const verdicts = Array.from({ length: 300 }, () => judge.judge(69 + (35 + (rand() - 0.5) * 8) / 100, 0, "chromatic", 35).verdict);
  assert.ok(flips(verdicts) <= 1, `${flips(verdicts)} flips`);
  const out = new ScaleJudge().judge(61.0, 0, "major", 35);
  assert.equal(out.scaleNote.inScale, false);
  assert.notEqual(out.verdict, "inTune");
  const reset = new ScaleJudge(); reset.judge(69, 0, "chromatic", 35); reset.reset();
  assert.equal(reset.judge(69.38, 0, "chromatic", 35).verdict, "sharp", "after a reset the next note starts fresh");
});

test("song judge: the verdict at the tolerance edge is steady, and each new note starts fresh", () => {
  const notes = [{ start: 0, end: 1, midi: 64 }, { start: 1, end: 2, midi: 64 }];
  const rand = H.rng(2), judge = new SongJudge(notes, { octaveMode: "strict", toleranceCents: 35 });
  const verdicts = [];
  for (let t = 0.2; t < 1; t += 0.02) verdicts.push(judge.update(t, 64 + (35 + (rand() - 0.5) * 8) / 100).verdict);
  assert.ok(flips(verdicts) <= 1, `${flips(verdicts)} flips`);
  assert.equal(judge.update(1.3, 64.38).verdict, "sharp", "the dead band belongs to one note only");
});

// ---------- key tracker: check often, switch on evidence ----------
/** A chroma vector that looks like a key: strong tonic and fifth, other scale notes, almost nothing else. */
function keyChroma(root, scale, rand = null) {
  const mask = keyMask(root, scale), c = new Float64Array(12);
  for (let pc = 0; pc < 12; pc++) c[pc] = (mask >> pc) & 1 ? 1.5 : 0.1;
  c[root] = 3; c[(root + 7) % 12] = 2;
  if (rand) for (let i = 0; i < 12; i++) c[i] *= 0.85 + rand() * 0.3;
  return c;
}
/** Feeds a tracker `sec` seconds of one key; returns events with absolute times. */
function feed(tracker, clock, root, scale, sec, { dt = 0.1, seed = 1 } = {}) {
  const rand = H.rng(seed), events = [];
  for (let i = 0; i < Math.round(sec / dt); i++) {
    clock.t += dt;
    const r = tracker.push({ chroma: keyChroma(root, scale, rand), rms: 0.1, dt, voiced: false });
    if (r.event) events.push({ t: clock.t, event: r.event, mask: r.key.mask });
  }
  return events;
}

test("key tracker: checks the key at least 4 times a second by default", () => {
  assert.ok(new KeyTracker().o.evalEverySec <= 0.25);
});

test("key tracker: evaluation count follows the setting (10x more checks at 0.1 s than at 1 s)", () => {
  const count = (evalEverySec) => {
    let n = 0; const t = new KeyTracker({ evalEverySec, onEvaluate: () => n++ });
    const clock = { t: 0 }; feed(t, clock, 0, "major", 6); n = 0; feed(t, clock, 0, "major", 20);
    return n;
  };
  const fast = count(0.1), slow = count(1);
  assert.ok(fast >= 8 * slow, `${fast} vs ${slow}`);
});

test("key tracker: locks after a few seconds, then follows a real modulation with exactly one change", () => {
  const t = new KeyTracker(), clock = { t: 0 };
  const first = feed(t, clock, 0, "major", 12);
  assert.deepEqual(first.map((e) => e.event), ["lock"]);
  assert.ok(first[0].t >= 3 && first[0].t <= 5, `locked at ${first[0].t}`);
  const modulationAt = clock.t;
  const after = feed(t, clock, 1, "major", 20, { seed: 2 });
  assert.deepEqual(after.map((e) => e.event), ["change"]);
  assert.equal(after[0].mask, keyMask(1, "major"));
  assert.ok(after[0].t - modulationAt <= 7, `took ${(after[0].t - modulationAt).toFixed(1)}s`);
});

test("key tracker: a clear, sudden modulation (a tritone) is picked up within 8 s, with one change", () => {
  // Measured 6.2 s: the slow window's half-life is 5 s, so the old key has to fade before the evidence builds up.
  const t = new KeyTracker(), clock = { t: 0 };
  feed(t, clock, 0, "major", 15);
  const at = clock.t, ev = feed(t, clock, 6, "major", 15, { seed: 3 });
  assert.equal(ev.length, 1);
  assert.ok(ev[0].t - at <= 8, `took ${(ev[0].t - at).toFixed(1)}s`);
});

test("key tracker: a short excursion to another key (1.5 s) is ignored", () => {
  const t = new KeyTracker(), clock = { t: 0 };
  feed(t, clock, 0, "major", 15);
  const events = [...feed(t, clock, 6, "major", 1.5, { seed: 4 }), ...feed(t, clock, 0, "major", 15, { seed: 5 })];
  assert.deepEqual(events, []);
});

test("key tracker (control): the same other key held for 12 s is a modulation and does switch (the tracker isn't just frozen)", () => {
  const t = new KeyTracker(), clock = { t: 0 };
  feed(t, clock, 0, "major", 15);
  assert.ok(feed(t, clock, 6, "major", 12, { seed: 4 }).some((e) => e.event === "change"));
});

test("key tracker: with an impossible evidence requirement it never switches (frozen)", () => {
  const t = new KeyTracker({ evidenceNeeded: 1e9 }), clock = { t: 0 };
  feed(t, clock, 0, "major", 10);
  assert.deepEqual(feed(t, clock, 6, "major", 40, { seed: 6 }), []);
});

test("key tracker: frames that arrive a hair early (float rounding) are not skipped", () => {
  let evaluations = 0;
  const t = new KeyTracker({ evalEverySec: 0.1, onEvaluate: () => evaluations++ });
  const clock = { t: 0 };
  feed(t, clock, 0, "major", 6);
  evaluations = 0;
  const dt = 0.1 - 3.6e-16; // what 0.1 often is after a subtraction of two timestamps
  const rand = H.rng(1);
  for (let i = 0; i < 200; i++) t.push({ chroma: keyChroma(0, "major", rand), rms: 0.1, dt, voiced: false });
  assert.ok(evaluations >= 195, `only ${evaluations} of 200 frames evaluated`);
});

test("external session: every chroma frame counts, even when timestamps are a hair short of the interval", () => {
  const sr = 44100, fft = 16384, binHz = sr / fft, mags = new Float32Array(fft / 2);
  const bin = Math.round(440 / binHz); mags[bin - 1] = 0.3; mags[bin] = 1; mags[bin + 1] = 0.3;
  const session = new ExternalSession(sr, { fftSize: fft, chromaEverySec: 0.1 });
  const samples = new Float32Array(4096).fill(0.1);
  for (let k = 1; k <= 100; k++) session.process(samples, mags, (k * 2205) / 22050); // "0.1 s" steps computed by division
  assert.ok(session.tracker.usableSec > 9.5, `only ${session.tracker.usableSec.toFixed(2)} of 10 s were used`);
});

// ---------- the whole display pipeline on audio ----------
test("pipeline: a wobbly synthetic voice (vibrato + jitter) through YIN, smoother and judge stays calm in every position", () => {
  const sr = 22050;
  function shown(centerCents, { old = false } = {}) {
    const mix = new H.Mix(sr, 6);
    mix.note(69, 0, 6, 0.3, { harm: [1, 0.8, 0.5, 0.3], vibCents: 35, jitterCents: 8, cents: centerCents, rand: H.rng(3), attack: 0.05 });
    const smoother = new PitchSmoother(old ? OLD_SMOOTHER : {}), judge = new ScaleJudge(), rows = [];
    for (const r of H.voiceReadings(mix.buf, sr).slice(60)) { // after the note has settled (1 s)
      if (r.midi === null) { smoother.miss(r.t); continue; }
      const m = smoother.push(r.midi, r.t);
      if (old) { const n = nearestScaleNote(m, 0, "chromatic"); rows.push({ cents: n.cents, target: n.target, ok: Math.abs(n.cents) <= 35 ? 1 : 0 }); }
      else { const { scaleNote, verdict } = judge.judge(m, 0, "chromatic", 35); rows.push({ cents: scaleNote.cents, target: scaleNote.target, ok: verdict === "inTune" ? 1 : 0 }); }
    }
    return { std: H.stability(rows.map((r) => r.cents)).std, jump: H.stability(rows.map((r) => r.cents)).maxJump, targetFlips: flips(rows.map((r) => r.target)), verdictFlips: flips(rows.map((r) => r.ok)) };
  }
  for (const [label, center] of [["centred", 0], ["at the note boundary", 48], ["at the tolerance edge", 35]]) {
    const now = shown(center), before = shown(center, { old: true });
    assert.ok(now.targetFlips <= 1 && now.verdictFlips <= 1, `${label}: ${JSON.stringify(now)}`);
    if (center === 0) { assert.ok(now.std <= 5 && now.jump <= 3, `${label}: ${JSON.stringify(now)}`); assert.ok(before.std > 10, `control ${JSON.stringify(before)}`); }
    if (center === 48) assert.ok(before.targetFlips >= 10, `control ${JSON.stringify(before)}`);
    if (center === 35) assert.ok(before.verdictFlips >= 10, `control ${JSON.stringify(before)}`);
  }
});
