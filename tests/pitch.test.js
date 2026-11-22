// בדיקות זיהוי גובה צליל (YIN) ומקרי קצה: אותות מסונתזים, בלי הנחות נוחות.
import test from "node:test";
import assert from "node:assert/strict";
import { detectPitch } from "../src/core/pitch-detector.js";
import { freqToMidi } from "../src/core/music-theory.js";
import * as H from "./helpers.js";

const cents = (f, ref) => 1200 * Math.log2(f / ref);
function sig(sr, f, { n = 4096, amp = 0.3, harm = [1], vib = 0, vibHz = 5.5, phase0 = 0 } = {}) {
  const b = new Float32Array(n); let ph = phase0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, ff = vib ? f * Math.pow(2, (vib * Math.sin(2 * Math.PI * vibHz * t)) / 1200) : f;
    ph += (2 * Math.PI * ff) / sr;
    let v = 0; harm.forEach((a, h) => { if (a) v += a * Math.sin(ph * (h + 1)); });
    b[i] = amp * v;
  }
  return b;
}

for (const sr of [16000, 22050, 44100, 48000]) {
  test(`סינוס טהור בכל הטווח הווקאלי @${sr}Hz: שגיאה פחות מ-5 סנט`, () => {
    for (const f of [82.41, 110, 146.83, 196, 261.63, 329.63, 440, 587.33, 783.99, 987.77]) {
      const r = detectPitch(sig(sr, f, { n: sr > 32000 ? 4096 : 4096 }), sr);
      assert.ok(r, `${f}Hz not detected @${sr}`);
      assert.ok(Math.abs(cents(r.freq, f)) < 5, `${f}Hz -> ${r.freq.toFixed(2)} (${cents(r.freq, f).toFixed(1)}c) @${sr}`);
    }
  });
}

test("קול עם הרמוניה שנייה חזקה מהבסיס: לא קופצים אוקטבה", () => {
  for (const f of [150, 200, 261.63, 330]) {
    const r = detectPitch(sig(44100, f, { harm: [0.5, 1, 0.6, 0.3, 0.2] }), 44100);
    assert.ok(r, `${f}`);
    assert.ok(Math.abs(cents(r.freq, f)) < 10, `${f}Hz detected as ${r.freq.toFixed(1)}`);
  }
});

test("בסיס חסר (רק הרמוניות 2,3,4): YIN עדיין מוצא את הגובה הנשמע", () => {
  const r = detectPitch(sig(44100, 200, { harm: [0, 1, 0.8, 0.6] }), 44100);
  assert.ok(r);
  assert.ok(Math.abs(cents(r.freq, 200)) < 10, `got ${r.freq.toFixed(1)}`);
});

test("ויברטו ±50 סנט ב-5.5Hz: הממוצע קרוב לגובה הנומינלי, ואף פריים לא סוטה יותר מ-80 סנט", () => {
  const sr = 44100, devs = [];
  for (let off = 0; off < 5000; off += 441) { // חלונות שונים לאורך מחזור הויברטו
    const b = sig(sr, 440, { n: 4096 + 5000, vib: 50, harm: [1, 0.5, 0.3] }).subarray(off, off + 4096);
    const r = detectPitch(b, sr);
    assert.ok(r, `window@${off} missed`);
    devs.push(cents(r.freq, 440));
  }
  assert.ok(Math.max(...devs.map(Math.abs)) < 80, `max dev ${Math.max(...devs.map(Math.abs)).toFixed(1)}c`);
  const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
  assert.ok(Math.abs(mean) < 15, `mean dev ${mean.toFixed(1)}c`);
});

test("סינוס חתוך (clipping) חמור: שגיאה פחות מ-10 סנט", () => {
  const b = sig(44100, 330, { amp: 4 }); for (let i = 0; i < b.length; i++) b[i] = Math.max(-1, Math.min(1, b[i]));
  const r = detectPitch(b, 44100);
  assert.ok(r); assert.ok(Math.abs(cents(r.freq, 330)) < 10);
});

test("היסט DC גדול (0.4) לא מבלבל את הגובה", () => {
  const b = sig(44100, 262, { amp: 0.2 }); for (let i = 0; i < b.length; i++) b[i] += 0.4;
  const r = detectPitch(b, 44100);
  assert.ok(r, "DC offset broke detection");
  assert.ok(Math.abs(cents(r.freq, 262)) < 10);
});

test("DC קבוע בלבד, שקט, ואפסים: אין זיהוי", () => {
  assert.equal(detectPitch(new Float32Array(4096).fill(0.5), 44100), null);
  assert.equal(detectPitch(new Float32Array(4096), 44100), null);
});

test("רעש לבן חזק: אין זיהוי בטוח (clarity < 0.85) בכל 50 ניסיונות", () => {
  const rand = H.rng(99);
  for (let k = 0; k < 50; k++) {
    const b = new Float32Array(4096); for (let i = 0; i < b.length; i++) b[i] = (rand() * 2 - 1) * 0.5;
    const r = detectPitch(b, 44100, { threshold: 0.2 });
    assert.ok(!r || r.clarity < 0.85, `trial ${k}: noise detected as ${r && r.freq.toFixed(1)}Hz clarity ${r && r.clarity.toFixed(2)}`);
  }
});

test("סינוס בתוך רעש (SNR 10dB): עדיין מזוהה בדיוק", () => {
  const rand = H.rng(5), b = sig(44100, 330, { amp: 0.3 });
  for (let i = 0; i < b.length; i++) b[i] += (rand() * 2 - 1) * 0.3 * Math.sqrt(3) * 0.316 * 0.707;
  const r = detectPitch(b, 44100);
  assert.ok(r); assert.ok(Math.abs(cents(r.freq, 330)) < 10, `${r.freq}`);
});

test("מתחת לתדר המינימלי (50Hz): לא קורס, ואם מזהה אז בתוך הטווח המותר", () => {
  const r = detectPitch(sig(44100, 50, { harm: [1, 0.6, 0.4] }), 44100);
  if (r) assert.ok(r.freq >= 70 && r.freq <= 1100, `out of range ${r.freq}`);
});

test("מאגר קצר (1000 דגימות) או אי-זוגי: לא קורס", () => {
  assert.doesNotThrow(() => detectPitch(sig(44100, 440, { n: 1000 }), 44100));
  assert.doesNotThrow(() => detectPitch(sig(44100, 440, { n: 4095 }), 44100));
  assert.doesNotThrow(() => detectPitch(new Float32Array(10), 44100));
  assert.doesNotThrow(() => detectPitch(new Float32Array(0), 44100));
});

test("אות שקט מתחת ל-minRms לא מזוהה, וכשמורידים את הסף כן", () => {
  const b = sig(44100, 440, { amp: 0.004 });
  assert.equal(detectPitch(b, 44100), null);
  const r = detectPitch(b, 44100, { minRms: 0.001 });
  assert.ok(r && Math.abs(cents(r.freq, 440)) < 5);
});

test("חלון אינטגרציה קטן יותר (opts.window) עדיין מדויק על סינוס", () => {
  const r = detectPitch(sig(44100, 440, { n: 4096 }), 44100, { window: 1024 });
  assert.ok(r && Math.abs(cents(r.freq, 440)) < 5);
});

test("מיקסול של שני צלילים (קווינטה): לא מחזיר צליל שלישי שרירותי", () => {
  // 300Hz + 450Hz: היחס 3:2, הבסיס המשותף 150Hz. כל תשובה מתוך {150, 300, 450} (±15 סנט) היא סבירה.
  const a = sig(44100, 300), c = sig(44100, 450); const b = a.map((v, i) => v + c[i]);
  const r = detectPitch(b, 44100, { threshold: 0.2 });
  if (r) assert.ok([150, 300, 450].some((f) => Math.abs(cents(r.freq, f)) < 15), `odd answer ${r.freq.toFixed(1)}`);
});

test("freqToMidi: לה 440 הוא 69, ואוקטבה היא 12", () => {
  assert.ok(Math.abs(freqToMidi(440) - 69) < 1e-9);
  assert.ok(Math.abs(freqToMidi(880) - 81) < 1e-9);
  assert.ok(Math.abs(freqToMidi(261.6256) - 60) < 1e-3);
});
