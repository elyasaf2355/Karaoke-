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

  const half = Math.min(opts.window || Math.floor(buf.length / 2), Math.floor(buf.length / 2));
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(buf.length - half - 1, Math.floor(sampleRate / minFreq));

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
  if (tau === -1 && opts.fallback) { // YIN: אין חציית סף, לוקחים את המינימום הגלובלי אם הוא נמוך מספיק
    let m = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (cmnd[t] < cmnd[m]) m = t;
    if (cmnd[m] < opts.fallback) tau = m;
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
  const ok = Math.abs(cents) <= tolCents + 1e-9 && (!strictOctave || octave === 0); // אפסילון: שגיאת עיגול בגבול
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

/** ציון ההתאמה (קורלציה) של chroma לסולם מסוים. */
function scoreKey(chroma, root, scale) {
  const prof = scale === "major" ? KS_MAJOR : KS_MINOR;
  return correlation(chroma, chroma.map((_, pc) => prof[(pc - root + 12) % 12]));
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

/** הסבר בעברית לשגיאת מיקרופון. */
function micErrorText(e) {
  const name = (e && e.name) || "";
  if (!window.isSecureContext || !navigator.mediaDevices)
    return "הדף לא נפתח בכתובת מאובטחת (https). פתחו אותו מהכתובת של GitHub Pages בדפדפן רגיל, ולא מתוך אפליקציה או מקובץ.";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "הרשאת המיקרופון נחסמה. בדפדפן: סמל המנעול ליד הכתובת, אחר כך הרשאות, מיקרופון, אפשר. בכרום באנדרואיד: הגדרות, הגדרות אתר, מיקרופון. באייפון: הגדרות, Safari, מיקרופון. אחרי זה רעננו את הדף. (" + name + ")";
  if (name === "NotFoundError") return "לא נמצא מיקרופון במכשיר. (" + name + ")";
  if (name === "NotReadableError") return "המיקרופון תפוס על ידי אפליקציה אחרת. סגרו אותה ונסו שוב. (" + name + ")";
  return "לא הצלחנו לפתוח את המיקרופון. (" + (name || String(e)) + ")";
}

/** מסכת סיביות של 12 הצלילים בסולם (מז'ור/מינור טבעי). מז'ור ומינור יחסי נותנים אותה מסכה. */
function keyMask(root, scale) {
  let m = 0;
  for (const st of SCALES[scale].steps) m |= 1 << ((root + st) % 12);
  return m;
}

/**
 * chroma (12 צלילים) מתוך ספקטרום עוצמות (לא dB), לפי פסגות ספקטרליות בלבד.
 * פסגות חלשות מ-minRel מהחזקה ביותר נזרקות, כדי שרעש רחב-סרט (תופים) לא יזייף את התוצאה.
 */
function chromaFromMagnitudes(mags, sampleRate, fftSize, opts = {}) {
  const minHz = opts.minHz || 80, maxHz = opts.maxHz || 2000, minRel = opts.minRel || 0.05;
  const f0 = opts.f0 || 0, notch = opts.notchCents || 60; // f0: מוחקים את ההרמוניות של הזמר
  const hz = sampleRate / fftSize;
  const lo = Math.max(2, Math.ceil(minHz / hz)), hi = Math.min(mags.length - 2, Math.floor(maxHz / hz));
  let max = 0;
  for (let k = lo; k <= hi; k++) if (mags[k] > max) max = mags[k];
  const chroma = new Float64Array(12);
  if (max <= 0) return chroma;
  for (let k = lo; k <= hi; k++) {
    const m = mags[k];
    if (m < max * minRel || m <= mags[k - 1] || m < mags[k + 1]) continue;
    const a = Math.log(mags[k - 1] + 1e-12), b = Math.log(m + 1e-12), c = Math.log(mags[k + 1] + 1e-12);
    const d = a - 2 * b + c;
    const off = d !== 0 ? (0.5 * (a - c)) / d : 0;
    const freq = (k + Math.max(-0.5, Math.min(0.5, off))) * hz;
    if (f0) {
      const h = Math.round(freq / f0);
      if (h >= 1 && h <= 24 && Math.abs(1200 * Math.log2(freq / (h * f0))) < notch) continue;
    }
    chroma[((Math.round(freqToMidi(freq)) % 12) + 12) % 12] += m;
  }
  return chroma;
}

/**
 * עוקב אחרי הסולם של המוזיקה לאורך זמן (כולל שינויי סולם באמצע שיר).
 * שני חלונות דועכים: איטי (יציב) ומהיר (מגיב). מחליפים סולם רק כשהחלון האיטי מעדיף סולם חדש
 * בהפרש ברור מהסולם הנוכחי, החלון המהיר מסכים, וזה נמשך כמה הערכות רצופות.
 * כך אקורד כרומטי חולף לא מחליף סולם, ומעבר סולם אמיתי מתגלה תוך שניות ספורות.
 * push() מחזיר {key, event}: event הוא "lock" (זיהוי ראשון), "change" (החלפה) או null.
 */
class KeyTracker {
  constructor(o = {}) {
    this.slowHalf = o.halfLifeSec ?? 6;
    this.fastHalf = o.fastHalfLifeSec ?? 2.5;
    this.minSec = o.minSec ?? 3;
    this.evalSec = o.evalSec ?? 1;
    this.votes = o.votes ?? 3;
    this.minScore = o.minScore ?? 0.6;
    this.margin = o.margin ?? 0.04;
    this.minRms = o.minRms ?? 0.002;
    this.minWeight = o.minWeight ?? 0.5;
    this.onEval = o.onEval || null; // לניפוי שגיאות בבדיקות
    this.voicedWeight = o.voicedWeight ?? 0.5; // משקל פריים שבו יש שירה (אחרי מחיקת ההרמוניות של הזמר)
    this.reset();
  }
  reset() {
    this.slow = new Float64Array(12); this.fast = new Float64Array(12);
    this.w = 0; this.usable = 0; this.since = 0;
    this.key = null; this.cand = null; this.candVotes = 0; 
  }
  push({ chroma, rms, dt, voiced }) {
    const ds = Math.pow(0.5, dt / this.slowHalf), df = Math.pow(0.5, dt / this.fastHalf);
    for (let i = 0; i < 12; i++) { this.slow[i] *= ds; this.fast[i] *= df; }
    this.w *= ds;
    if (rms >= this.minRms) {
      let sum = 0; for (let i = 0; i < 12; i++) sum += chroma[i];
      if (sum > 0) {
        const wt = (voiced ? this.voicedWeight : 1) * dt;
        for (let i = 0; i < 12; i++) { this.slow[i] += (chroma[i] / sum) * wt; this.fast[i] += (chroma[i] / sum) * wt; }
        this.w += wt; this.usable += wt;
      }
    }
    this.since += dt;
    let event = null;
    if (this.since >= this.evalSec) { this.since = 0; event = this._evaluate(); }
    return { key: this.key, event };
  }
  _vote(m) {
    if (this.cand && this.cand.mask === m.mask) this.candVotes++; else { this.cand = m; this.candVotes = 1; }
  }
  _evaluate() {
    if (this.usable < this.minSec || this.w < this.minWeight) return null;
    const slow = Array.from(this.slow), est = estimateKey(slow);
    if (est.score < this.minScore) { this.cand = null; this.candVotes = 0; return null; }
    est.mask = keyMask(est.root, est.scale);
    if (!this.key) { this.key = est; return "lock"; }
    const cur = this.key;
    if (this.onEval) this.onEval({ best: est, curScore: scoreKey(slow, cur.root, cur.scale), fast: Array.from(this.fast), cur });
    // הסולם החדש חייב להיות הטוב ביותר בשני החלונות (תערובת מעבר לא תיתן הסכמה), ולנצח את הנוכחי בהפרש ברור
    let ok = est.mask !== cur.mask && est.score - scoreKey(slow, cur.root, cur.scale) >= this.margin;
    if (ok) {
      const fast = Array.from(this.fast), fe = estimateKey(fast);
      ok = keyMask(fe.root, fe.scale) === est.mask && fe.score >= this.minScore;
    }
    if (!ok) { this.cand = null; this.candVotes = 0; return null; }
    this._vote(est);
    if (this.candVotes >= this.votes) { this.key = est; this.cand = null; this.candVotes = 0; return "change"; }
    return null;
  }
}

if (typeof module !== "undefined") {
  module.exports = { micErrorText, detectPitch, freqToMidi, analyze, judge, estimateKey, scoreKey, keyMask, chromaFromMagnitudes, KeyTracker, median, SCALES, NOTE_NAMES_HE };
}
