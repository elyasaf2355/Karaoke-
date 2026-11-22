// כלי סינתזה וניתוח לבדיקות: מייצרים שמע ריאליסטי ומריצים עליו את אותו קוד של האפליקציה.
import { SCALES } from "../src/core/music-theory.js";
import { ExternalSession } from "../src/core/external-session.js";

function rng(seed) { // mulberry32: דטרמיניסטי
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

class Mix {
  constructor(sr, sec) { this.sr = sr; this.buf = new Float32Array(Math.round(sr * sec)); }
  /** תו עם הרמוניות, מעטפת, וברירת מחדל בלי ויברטו. cents: סטייה קבועה (כיוון). */
  note(midi, t0, dur, amp, o = {}) {
    const harm = o.harm || [1, 0.6, 0.4, 0.3, 0.2, 0.15];
    const vib = o.vibCents || 0, vibHz = o.vibHz || 5.5, cents = o.cents || 0;
    const att = o.attack ?? 0.02, rel = o.release ?? 0.08, decayTau = o.decayTau || 0;
    const f0 = mtof(midi) * Math.pow(2, cents / 1200);
    const n0 = Math.max(0, Math.round(t0 * this.sr)), n1 = Math.min(this.buf.length, Math.round((t0 + dur) * this.sr));
    let phase = 0;
    for (let n = n0; n < n1; n++) {
      const t = (n - n0) / this.sr;
      const f = vib ? f0 * Math.pow(2, (vib * Math.sin(2 * Math.PI * vibHz * t)) / 1200) : f0;
      phase += (2 * Math.PI * f) / this.sr;
      let env = Math.min(1, t / att, (dur - t) / rel);
      if (env <= 0) continue;
      if (decayTau) env *= Math.exp(-t / decayTau);
      let v = 0;
      for (let h = 0; h < harm.length; h++) if (f * (h + 1) < this.sr / 2) v += harm[h] * Math.sin(phase * (h + 1));
      this.buf[n] += amp * env * v;
    }
  }
  noise(t0, dur, amp, rand, o = {}) { // רעש לבן עם דעיכה (תוף) או קבוע
    const n0 = Math.round(t0 * this.sr), n1 = Math.min(this.buf.length, Math.round((t0 + dur) * this.sr));
    for (let n = n0; n < n1; n++) {
      const t = (n - n0) / this.sr;
      this.buf[n] += amp * (rand() * 2 - 1) * (o.tau ? Math.exp(-t / o.tau) : 1);
    }
  }
  gain(t0, t1, g) { for (let n = Math.round(t0 * this.sr); n < Math.min(this.buf.length, Math.round(t1 * this.sr)); n++) this.buf[n] *= g; }
}

/** אקורד טריאדי דיאטוני על דרגה d של סולם שבסיסו root (pc). */
function triad(root, scale, d) {
  const st = SCALES[scale].steps, base = 48 + root; // אוקטבה 3
  const at = (i) => base + st[i % 7] + 12 * Math.floor(i / 7);
  return [at(d), at(d + 2), at(d + 4)];
}
const PROG = { major: [0, 5, 3, 4], minor: [0, 5, 2, 6] }; // I-vi-IV-V ; i-VI-III-VII (מינור טבעי)

/**
 * מוסיף ליווי: אקורד לכל תיבה (2 שניות), חבטה בפעמה 1 ו-3, בס, ותוף (hi-hat) אם rand ניתן.
 * @param deg רשימת דרגות (ברירת מחדל: הפרוגרסיה הרגילה)
 */
function addBacking(mix, { root = 0, scale = "major", t0 = 0, t1, amp = 0.07, bar = 2, deg = null, chords = null, drums = 0, rand = null, cents = 0 }) {
  const degrees = deg || PROG[scale] || PROG.major;
  let i = 0;
  for (let t = t0; t < t1 - 1e-9; t += bar, i++) {
    const chord = chords ? chords[i % chords.length] : triad(root, scale, degrees[i % degrees.length]);
    const len = Math.min(bar, t1 - t);
    for (const half of [0, bar / 2]) {
      if (half >= len) continue;
      const dur = Math.min(bar / 2, len - half);
      for (const m of chord) mix.note(m, t + half, dur, amp, { decayTau: 0.9, cents });
      mix.note(chord[0] - 12, t + half, dur, amp * 1.4, { harm: [1, 0.5, 0.25], decayTau: 0.9, cents });
    }
  }
  if (drums && rand) for (let t = t0; t < t1; t += 0.25) mix.noise(t, 0.04, drums, rand, { tau: 0.012 });
}

/** מנגינה של זמר: [[midi, dur], ...] מתחילה ב-t0, עם ויברטו אופציונלי. מחזיר רשימת {t0,t1,midi}. */
function addVoice(mix, melody, { t0, amp = 0.25, vibCents = 35, gap = 0.1, harm = [1, 0.8, 0.5, 0.35, 0.2] }) {
  const out = []; let t = t0;
  for (const [midi, dur] of melody) {
    if (t >= mix.buf.length / mix.sr) break;
    mix.note(midi, t, dur - gap, amp, { vibCents, harm, attack: 0.04, release: 0.06 });
    out.push({ t0: t, t1: t + dur - gap, midi }); t += dur;
  }
  return out;
}

/** מנגינה שחוזרת על צלילי הסולם (פנטטוני/דיאטוני) לאורך duration שניות. */
function melodyInKey(root, scale, duration, oct = 60, seed = 7, noteDur = 0.5) {
  const r = rng(seed), st = SCALES[scale].steps, out = []; let deg = 0, t = 0;
  while (t < duration) {
    deg = Math.max(0, Math.min(8, deg + [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)]));
    out.push([oct + root + st[deg % 7] + 12 * Math.floor(deg / 7), noteDur]); t += noteDur;
  }
  return out;
}

// ---- FFT (רדיקס-2) וחלון בלקמן, כמו AnalyserNode ----
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
const winCache = new Map();
function blackman(n) {
  if (!winCache.has(n)) { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n); winCache.set(n, w); }
  return winCache.get(n);
}
function magnitudes(pcm, endIdx, N) {
  const re = new Float64Array(N), im = new Float64Array(N), w = blackman(N), start = endIdx - N;
  for (let i = 0; i < N; i++) { const k = start + i; re[i] = k >= 0 ? pcm[k] * w[i] : 0; }
  fft(re, im);
  const m = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) m[k] = Math.hypot(re[k], im[k]) / N;
  return m;
}
const fftSizeFor = (sr) => (sr > 32000 ? 16384 : 8192); // ~0.35-0.37 שניות, כמו בדפדפן

/**
 * מריץ ExternalSession על שמע שלם, בקצב hop, בדיוק כמו הדפדפן.
 * calSec: אורך כיול (מוזיקה בלבד). מחזיר ציר זמן של פריימים.
 */
function run(pcm, sr, { calSec = 5, hop = 0.1, chromaHop = null, sessionOpts = {}, noExclusion = false } = {}) {
  const N = fftSizeFor(sr), W = 4096;
  const ch = chromaHop || hop;
  const s = new ExternalSession(sr, { fftSize: N, chromaEverySec: ch, voiceHandling: noExclusion ? "none" : "notch", ...sessionOpts });
  const frames = [], total = pcm.length;
  const hopN = Math.round(hop * sr);
  let calibrated = false, lastMagT = -1e9;
  for (let end = N; end <= total; end += hopN) {
    const t = end / sr;
    const buf = pcm.subarray(end - W, end);
    if (!calibrated && t <= calSec) s.calibrate(buf);
    else if (!calibrated) { s.endCalibration(); calibrated = true; }
    const mags = t - lastMagT >= ch - 1e-9 ? (lastMagT = t, magnitudes(pcm, end, N)) : null;
    const r = s.process(buf, mags, t);
    frames.push({ t, ...r });
  }
  return frames;
}

/**
 * מוסיף לתערובת שירה בעוצמה יחסית לליווי: מכוון את הליווי כך שיחס RMS (זמר/ליווי) בזמן השירה יהיה snrDb.
 * 12dB זה טלפון קרוב לזמר ורמקול במרחק; 6dB זה ליווי חזק יחסית.
 */
function mixVoice(back, voiceMelodies, snrDb, { vibCents = 35, voiceAmp = 0.25, fromT = 6 } = {}) {
  const v = new Mix(back.sr, back.buf.length / back.sr), notes = [];
  for (const { melody, t0 } of voiceMelodies) notes.push(...addVoice(v, melody, { t0, amp: voiceAmp, vibCents }));
  const rms = (b, a, z) => { let e = 0; for (let i = a; i < z; i++) e += b[i] * b[i]; return Math.sqrt(e / Math.max(1, z - a)); };
  const a = Math.round(fromT * back.sr), z = back.buf.length;
  const g = rms(v.buf, a, z) / Math.pow(10, snrDb / 20) / rms(back.buf, a, z);
  for (let i = 0; i < back.buf.length; i++) back.buf[i] = back.buf[i] * g + v.buf[i];
  return notes;
}

/** האירועים (lock/change) מתוך ציר הזמן. */
function events(frames) { return frames.filter((f) => f.event).map((f) => ({ t: f.t, event: f.event, mask: f.key && f.key.mask })); }
const maskOf = (k) => (k ? k.mask : null);
const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const maskStr = (m) => (m == null ? "none" : names.filter((_, i) => m & (1 << i)).join(" "));

export { mixVoice, names, rng, Mix, triad, events, PROG, addBacking, addVoice, melodyInKey, run, maskOf, maskStr, magnitudes, fftSizeFor, mtof };
