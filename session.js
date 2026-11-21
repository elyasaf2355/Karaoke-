// לוגיקת מצב "מוזיקה חיצונית": זיהוי קול מעל הרקע + מעקב סולם.
// אותו קוד רץ בדפדפן ובבדיקות (Node).
(function (root) {
  // בדפדפן pitch.js טעון לפני הקובץ הזה, ושמותיו זמינים כמשתנים גלובליים.
  const P = typeof module !== "undefined" ? require("./pitch.js")
    : { KeyTracker, detectPitch, freqToMidi, median, chromaFromMagnitudes };

  function rmsOf(b) { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); }

  class ExternalSession {
    /**
     * @param {number} sampleRate
     * @param {{fftSize?:number, gate?:number, chromaEverySec?:number}} o
     */
    constructor(sampleRate, o = {}) {
      this.sr = sampleRate;
      this.fftSize = o.fftSize || 16384;
      this.gate = o.gate || 1.8;
      this.chromaEvery = o.chromaEverySec || 0.1;
      this.voiceHandling = o.voiceHandling || "notch"; // "none" רק לבדיקות ביקורת
      this.lastF0 = 0;
      this.tracker = new P.KeyTracker(o.tracker || {});
      this.baseline = 0.01; this.calSum = 0; this.calN = 0;
      this.hist = []; this.lastVoiceT = -1e9; this.lastChromaT = null; this.calibrating = true;
    }
    /** מצטבר בזמן הכיול (מוזיקה בלבד). */
    calibrate(buf) { this.calSum += rmsOf(buf); this.calN++; }
    endCalibration() { if (this.calN) this.baseline = Math.max(0.005, this.calSum / this.calN); this.calibrating = false; }
    get musicHeard() { return this.calN > 0 && this.calSum / this.calN > 0.002; }

    /**
     * פריים אחד.
     * @param {Float32Array} buf חלון זמן (4096 דגימות)
     * @param {Float32Array|null} mags ספקטרום עוצמות (לא dB) באורך fftSize/2, או null אם אין
     * @param {number} t זמן בשניות
     * @returns {{midi:number|null, key:object|null, event:string|null}}
     */
    process(buf, mags, t) {
      const rms = rmsOf(buf);
      const r = this.calibrating ? null : P.detectPitch(buf, this.sr, { minRms: this.baseline * this.gate, threshold: 0.2 });
      let midi = null;
      if (r && r.clarity > 0.85) {
        this.hist.push(P.freqToMidi(r.freq)); if (this.hist.length > 5) this.hist.shift();
        midi = P.median(this.hist); this.lastVoiceT = t; this.lastF0 = r.freq;
      } else if (t - this.lastVoiceT > 0.4) this.hist = [];
      let event = null;
      if (mags) {
        if (this.lastChromaT === null) this.lastChromaT = t - this.chromaEvery;
        const dt = t - this.lastChromaT;
        if (dt >= this.chromaEvery) {
          this.lastChromaT = t;
          const voiced = this.voiceHandling !== "none" && t - this.lastVoiceT < 0.3;
          const chroma = P.chromaFromMagnitudes(mags, this.sr, this.fftSize, { f0: voiced ? this.lastF0 : 0 });
          event = this.tracker.push({ chroma, rms, dt, voiced }).event;
        }
      }
      return { midi, key: this.tracker.key, event };
    }
  }

  if (typeof module !== "undefined") module.exports = { ExternalSession, rmsOf };
  else root.ExternalSession = ExternalSession;
})(typeof window !== "undefined" ? window : globalThis);
