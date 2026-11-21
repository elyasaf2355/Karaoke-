// זיהוי גובה צליל (אלגוריתם YIN) ופונקציות עזר מוזיקליות.
// קובץ זה אינו תלוי בדפדפן, ולכן אפשר לבדוק אותו גם ב-Node.

const NOTE_NAMES_HE = ["דו", "דו♯", "רה", "רה♯", "מי", "פה", "פה♯", "סול", "סול♯", "לה", "לה♯", "סי"];

const SCALES = {
  major: { label: "מז'ור", steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: "מינור", steps: [0, 2, 3, 5, 7, 8, 10] },
  chromatic: { label: "כרומטי (כל הצלילים)", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

/**
 * YIN pitch detection.
 * @param {Float32Array} buf חלון דגימות (מומלץ 4096)
 * @param {number} sampleRate
 * @returns {{freq:number, clarity:number}|null}
 */
function detectPitch(buf, sampleRate, opts = {}) {
  const minFreq = opts.minFreq || 70;
  const maxFreq = opts.maxFreq || 1100;
  const threshold = opts.threshold || 0.12;
  const minRms = opts.minRms || 0.01;

  const half = Math.floor(buf.length / 2);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(half - 1, Math.floor(sampleRate / minFreq));

  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
  if (Math.sqrt(sumSq / buf.length) < minRms) return null; // שקט

  // difference function + cumulative mean normalized difference
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < half; i++) {
      const diff = buf[i] - buf[i + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }

  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return null;

  // parabolic interpolation
  let better = tau;
  if (tau > 1 && tau < tauMax) {
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
    const denom = 2 * (2 * b - a - c);
    if (denom !== 0) better = tau + (c - a) / denom;
  }
  return { freq: sampleRate / better, clarity: 1 - cmnd[tau] };
}

/** תדר -> מספר MIDI רציף (69 = לה 440). */
function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

/**
 * מוצא את צליל היעד: הצליל הקרוב ביותר בסולם (בלי קשר לאוקטבה).
 * @returns {{target:number, noteName:string, cents:number, inScale:boolean}}
 *   cents > 0: הזמר גבוה מדי; cents < 0: נמוך מדי.
 */
function analyze(midi, rootPc, scaleKey) {
  const steps = SCALES[scaleKey].steps;
  const allowed = new Set(steps.map((s) => (s + rootPc) % 12));
  const base = Math.round(midi);
  let best = null;
  for (let m = base - 6; m <= base + 6; m++) {
    if (!allowed.has(((m % 12) + 12) % 12)) continue;
    const dist = Math.abs(midi - m);
    if (best === null || dist < best.dist) best = { m, dist };
  }
  const cents = (midi - best.m) * 100;
  const nearest = Math.round(midi);
  return {
    target: best.m,
    noteName: NOTE_NAMES_HE[((best.m % 12) + 12) % 12],
    cents,
    inScale: allowed.has(((nearest % 12) + 12) % 12),
  };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * משווה צליל של זמר לצליל היעד במנגינה.
 * strictOctave=true: שירה באוקטבה אחרת נחשבת טעות.
 * @returns {{ok:boolean, octave:number, cents:number}}
 *   octave: בכמה אוקטבות הזמר רחוק מהיעד (שלילי = נמוך מדי)
 *   cents: הסטייה שנותרה אחרי הורדת האוקטבות (חיובי = גבוה מדי)
 */
function judge(voiceMidi, targetMidi, strictOctave, tolCents) {
  const diff = (voiceMidi - targetMidi) * 100;
  const octave = Math.round(diff / 1200);
  const cents = diff - octave * 1200;
  const ok = Math.abs(cents) <= tolCents && (!strictOctave || octave === 0);
  return { ok, octave, cents };
}

// זיהוי סולם (Krumhansl-Schmuckler) מתוך וקטור chroma של 12 צלילים.
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a, b) {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** @returns {{root:number, scale:"major"|"minor", score:number}} */
function estimateKey(chroma) {
  let best = { root: 0, scale: "major", score: -2 };
  for (let root = 0; root < 12; root++) {
    for (const [scale, prof] of [["major", KS_MAJOR], ["minor", KS_MINOR]]) {
      const rotated = chroma.map((_, pc) => prof[(pc - root + 12) % 12]);
      const score = correlation(chroma, rotated);
      if (score > best.score) best = { root, scale, score };
    }
  }
  return best;
}

if (typeof module !== "undefined") {
  module.exports = { detectPitch, freqToMidi, analyze, judge, estimateKey, median, SCALES, NOTE_NAMES_HE };
}
