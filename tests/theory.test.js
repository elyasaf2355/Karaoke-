// בדיקות לוגיקת הסולם והשיפוט: analyze / judge / keyMask / chroma, כולל מקרי גבול.
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, judge, keyMask, chromaFromMagnitudes, SCALES, median, KeyTracker } = require("../pitch.js");

test("analyze: צליל בסולם נותן יעד זהה וסטייה בסנטים עם הסימן הנכון", () => {
  const a = analyze(69.3, 0, "major"); // לה +30 סנט בדו מז'ור
  assert.equal(a.target, 69); assert.equal(a.inScale, true); assert.ok(Math.abs(a.cents - 30) < 1e-6);
  const b = analyze(68.7, 0, "major"); assert.ok(Math.abs(b.cents + 30) < 1e-6);
});

test("analyze: צליל מחוץ לסולם (דו# בדו מז'ור) מסומן, והיעד הקרוב ביותר נבחר", () => {
  const a = analyze(61.2, 0, "major"); // קרוב לדו# אבל קרוב יותר ל-דו (60)? 1.2 מול רה (62): 0.8 → רה
  assert.equal(a.inScale, false); assert.equal(a.target, 62);
  const b = analyze(60.8, 0, "major"); assert.equal(b.target, 60); assert.equal(b.inScale, false);
});

test("analyze: כל השורשים 0..11 במז'ור ובמינור כוללים בדיוק 7 צלילים, וצליל היעד תמיד בסולם", () => {
  for (let root = 0; root < 12; root++) for (const sc of ["major", "minor"]) {
    let m = keyMask(root, sc), cnt = 0; for (let i = 0; i < 12; i++) if (m & (1 << i)) cnt++;
    assert.equal(cnt, 7, `${root} ${sc}`);
    for (let x = 30; x < 100; x += 0.37) {
      const a = analyze(x, root, sc);
      assert.ok(m & (1 << (((a.target % 12) + 12) % 12)), `target ${a.target} not in scale (${root} ${sc}, ${x})`);
      assert.ok(Math.abs(x - a.target) <= 3 + 1e-9, "target too far");
    }
  }
});

test("analyze: שורש 11 (סי) מתעטף נכון (si מז'ור: 11 1 3 4 6 8 10)", () => {
  const m = keyMask(11, "major");
  const want = [11, 1, 3, 4, 6, 8, 10].reduce((a, p) => a | (1 << p), 0);
  assert.equal(m, want);
});

test("analyze: כרומטי כולל את כל 12 הצלילים: הסטייה תמיד בטווח ±50 סנט", () => {
  for (let x = 40; x < 90; x += 0.013) assert.ok(Math.abs(analyze(x, 5, "chromatic").cents) <= 50 + 1e-9);
});

test("analyze: ערכי MIDI שליליים או גדולים לא קורסים ומחזירים צליל בסולם", () => {
  for (const x of [-5.3, 0, 0.2, 127.9, 200]) {
    const a = analyze(x, 3, "minor");
    assert.ok(keyMask(3, "minor") & (1 << (((a.target % 12) + 12) % 12)), String(x));
  }
});

test("judge: כל מקרי הגבול של הסבילות (35 סנט)", () => {
  assert.equal(judge(60.35, 60, true, 35).ok, true);
  assert.equal(judge(60.36, 60, true, 35).ok, false);
  assert.equal(judge(59.65, 60, true, 35).ok, true);
  assert.equal(judge(59.64, 60, true, 35).ok, false);
});

test("judge: אוקטבה שגויה במצב קפדני נכשלת, במצב מקל עוברת, והסימן נכון", () => {
  const lo = judge(48, 60, true, 35); assert.equal(lo.ok, false); assert.equal(lo.octave, -1);
  const hi = judge(72, 60, true, 35); assert.equal(hi.ok, false); assert.equal(hi.octave, 1);
  assert.equal(judge(48, 60, false, 35).ok, true);
  assert.equal(judge(84, 60, false, 35).ok, true); // שתי אוקטבות
  assert.equal(judge(84, 60, true, 35).octave, 2);
});

test("judge: סטייה של חצי אוקטבה (טריטון) לא נחשבת בטעות לאוקטבה נכונה", () => {
  for (const d of [5.9, 6.1, -5.9, -6.1]) {
    const j = judge(60 + d, 60, true, 35);
    assert.equal(j.ok, false, String(d));
  }
});

test("judge: אוקטבה פלוס סטייה קטנה: הסטייה נשמרת, האוקטבה לא נבלעת", () => {
  const j = judge(48.2, 60, true, 35);
  assert.equal(j.octave, -1); assert.ok(Math.abs(j.cents - 20) < 1e-6);
  assert.equal(judge(48.2, 60, false, 35).ok, true);
  assert.equal(judge(48.5, 60, false, 35).ok, false);
});

test("keyMask: מז'ור ומינור יחסי נותנים אותה מסכה, אחרים לא", () => {
  for (let r = 0; r < 12; r++) {
    assert.equal(keyMask(r, "major"), keyMask((r + 9) % 12, "minor"));
    assert.notEqual(keyMask(r, "major"), keyMask((r + 1) % 12, "major"));
    assert.notEqual(keyMask(r, "major"), keyMask(r, "minor"));
  }
});

test("median: אורך זוגי, איבר בודד, ושלילי", () => {
  assert.equal(median([3]), 3); assert.equal(median([1, 9, 5]), 5); assert.equal(median([-1, -5, -3]), -3);
});

test("chromaFromMagnitudes: ספקטרום אפס או קצר לא קורס", () => {
  assert.equal(chromaFromMagnitudes(new Float32Array(4096), 44100, 8192).reduce((a, b) => a + b, 0), 0);
  assert.doesNotThrow(() => chromaFromMagnitudes(new Float32Array(8), 44100, 16));
});

test("chromaFromMagnitudes: פסגה יחידה ב-440Hz נכנסת בדיוק לצליל לה, ועם f0 מחוק נעלמת", () => {
  const sr = 44100, N = 16384, mags = new Float32Array(N / 2), k = Math.round(440 / (sr / N));
  mags[k - 1] = 0.3; mags[k] = 1; mags[k + 1] = 0.3;
  const c = chromaFromMagnitudes(mags, sr, N);
  assert.ok(c[9] > 0.9 && c.reduce((a, b) => a + b, 0) - c[9] < 1e-9, `chroma ${Array.from(c)}`);
  const c2 = chromaFromMagnitudes(mags, sr, N, { f0: 440 });
  assert.equal(c2.reduce((a, b) => a + b, 0), 0);
  const c3 = chromaFromMagnitudes(mags, sr, N, { f0: 220 }); // 440 = ההרמוניה השנייה של 220
  assert.equal(c3.reduce((a, b) => a + b, 0), 0);
  const c4 = chromaFromMagnitudes(mags, sr, N, { f0: 300 }); // לא הרמוניה: נשאר
  assert.ok(c4[9] > 0.9);
});

test("KeyTracker: קלט לא תקין (chroma אפס, dt גדול מאוד, rms אפס) לא קורס ולא ממציא סולם", () => {
  const t = new KeyTracker();
  for (let i = 0; i < 100; i++) assert.doesNotThrow(() => t.push({ chroma: new Float64Array(12), rms: 0.1, dt: 0.1, voiced: false }));
  assert.equal(t.key, null);
  assert.doesNotThrow(() => t.push({ chroma: new Float64Array(12).fill(1), rms: 0.1, dt: 1000, voiced: false }));
  for (let i = 0; i < 50; i++) t.push({ chroma: new Float64Array(12).fill(1), rms: 0, dt: 0.1, voiced: false });
  assert.equal(t.key, null);
});

test("KeyTracker.reset מנקה מצב: אחרי reset אין סולם ואין אירוע", () => {
  const t = new KeyTracker({ minSec: 0.5, evalSec: 0.5 });
  const c = new Float64Array(12); [0, 2, 4, 5, 7, 9, 11].forEach((p) => (c[p] = 1)); c[0] = 2; c[7] = 1.5;
  let locked = false; for (let i = 0; i < 40; i++) if (t.push({ chroma: c, rms: 0.1, dt: 0.1, voiced: false }).event === "lock") locked = true;
  assert.ok(locked); t.reset(); assert.equal(t.key, null);
});
