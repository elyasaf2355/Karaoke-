import { h } from "../ui/dom.js";
import { ICONS } from "../ui/icons.js";
import { Readout } from "../ui/readout.js";
import { PitchTrace } from "../ui/pitch-trace.js";
import { ListeningSession } from "../ui/listening-session.js";
import { scalePicker, strictnessPicker, responsePicker, checkbox, settingsPanel } from "../ui/controls.js";
import { renderSummary } from "../ui/summary-card.js";
import { ExternalSession } from "../core/external-session.js";
import { SessionStats } from "../core/session-stats.js";
import { feedbackFor } from "../core/feedback.js";
import { ScaleJudge } from "../core/scale-judge.js";
import { NOTE_NAMES_HE, SCALES, noteNameOf } from "../core/music-theory.js";

const CALIBRATION_SEC = 5;
/** After this long without hearing the singer, the display forgets the last note. */
const SILENCE_SEC = 0.4;

const keyName = (key) => `${NOTE_NAMES_HE[key.root]} ${SCALES[key.scale].label}`;

/**
 * Music plays somewhere else (a speaker, a karaoke video); the phone listens to both.
 * Phase 1 learns the backing level and key, phase 2 judges the singing against the key.
 */
export function createKaraokeMode({ settings }) {
  let readout, trace, session, external, scaleJudge, stats, toggleButton, skipButton, summaryEl, scale, cleanups = [];
  let phase = "idle", calibrationEndsAt = 0;

  function applyKey(key) {
    settings.set("root", key.root);
    settings.set("scale", key.scale);
  }

  function finishCalibration() {
    external.endCalibration();
    phase = "singing";
    skipButton.hidden = true;
    const key = external.key;
    if (key && external.musicHeard) {
      if (settings.get("autoKey")) applyKey(key);
      readout.idle(`זוהה סולם: ${keyName(key)}`, "אפשר להתחיל לשיר. הסולם יתעדכן לבד אם השיר ישנה סולם.");
    } else {
      readout.idle("לא נקלטה מוזיקה לכיול", "בחרו סולם ידנית ושירו.");
      settings.set("autoKey", false);
    }
  }

  function judgeSinging(midi, now) {
    const { scaleNote, verdict } = scaleJudge.judge(midi, settings.get("root"), settings.get("scale"), settings.toleranceCents);
    stats.record(verdict, scaleNote.cents);
    trace.push(now, scaleNote.cents);
    const { headline, detail } = feedbackFor({ verdict, cents: scaleNote.cents, octave: 0, targetMidi: scaleNote.target, inScale: scaleNote.inScale });
    readout.update({ state: verdict === "inTune" ? "ok" : verdict, note: noteNameOf(scaleNote.target), cents: scaleNote.cents, headline, detail });
  }

  function onFrame(tap) {
    const now = tap.now;
    const samples = tap.readSamples();
    const spectrum = external.chromaDue(now) ? tap.readMagnitudes() : null;

    if (phase === "calibrating") {
      external.calibrate(samples);
      external.process(samples, spectrum, now);
      const left = Math.max(0, Math.ceil(calibrationEndsAt - now));
      readout.idle(`מקשיב למוזיקה… אל תשירו עדיין (${left})`);
      if (now >= calibrationEndsAt) finishCalibration();
      return;
    }

    const result = external.process(samples, spectrum, now);
    if (result.event && settings.get("autoKey")) {
      applyKey(result.key);
      if (result.event === "change") readout.idle(`הסולם השתנה ל${keyName(result.key)}`);
    }
    if (result.midi !== null) judgeSinging(result.midi, now);
    else {
      trace.push(now, null);
      if (now - external.lastVoiceAt > SILENCE_SEC) {
        scaleJudge.reset();
        if (result.event !== "change") readout.idle("שירו…");
      }
    }
    trace.draw(now);
  }

  return {
    id: "karaoke",
    title: "קריוקי",
    icon: ICONS.karaoke,

    mount(host) {
      readout = new Readout();
      trace = new PitchTrace(h("canvas", { class: "trace", "aria-label": "היסטוריית הגובה בשמונה השניות האחרונות" }));
      summaryEl = h("div", { class: "summary" });
      toggleButton = h("button", { class: "primary", type: "button", onclick: () => session.toggle() }, "התחל");
      skipButton = h("button", { class: "quiet", type: "button", hidden: true, onclick: () => { settings.set("autoKey", false); finishCalibration(); } }, "דלגו על הכיול, בחרתי סולם ידנית");
      scale = scalePicker(settings, { allowChromatic: false, onManualChange: () => settings.set("autoKey", false) });
      const strictness = strictnessPicker(settings);
      const response = responsePicker(settings);
      const auto = checkbox("auto-key", "זיהוי סולם אוטומטי, גם אם השיר משנה סולם באמצע", settings.get("autoKey"), (on) => settings.set("autoKey", on));
      cleanups = [scale.destroy, strictness.destroy, response.destroy,
        settings.subscribe((key, value) => {
          if (key === "autoKey") auto.input.checked = value;
          if (key === "strictness") { readout.setTolerance(settings.toleranceCents); trace.setTolerance(settings.toleranceCents); }
        })];

      session = new ListeningSession({
        onStart: (tap) => {
          external = new ExternalSession(tap.sampleRate, { fftSize: tap.fftSize, smoothing: { timeConstantSec: settings.smoothingSec } });
          scaleJudge = new ScaleJudge();
          stats = new SessionStats(); trace.reset(); summaryEl.replaceChildren();
          phase = "calibrating"; calibrationEndsAt = tap.now + CALIBRATION_SEC; skipButton.hidden = false;
        },
        onFrame,
        onStop: () => { phase = "idle"; skipButton.hidden = true; readout.idle("הפסקנו להקשיב"); renderSummary(summaryEl, stats); },
        onError: (message) => readout.idle("אין גישה למיקרופון", message),
        onStateChange: (running) => {
          toggleButton.textContent = running ? "עצור" : "התחל";
          toggleButton.classList.toggle("primary--stop", running);
        },
      });

      host.append(
        h("p", { class: "lede" }, "הפעילו את הקריוקי ברמקול, לחצו התחל, ושירו. קודם יש כמה שניות הקשבה למוזיקה בלבד."),
        readout.element, trace.canvas, toggleButton, skipButton, summaryEl,
        settingsPanel(scale.element, strictness.element, response.element, auto.element),
        h("p", { class: "note" }, "האפליקציה לא מכירה את המנגינה, ולכן היא בודקת דיוק וסולם ולא אוקטבה."));
      readout.idle("הפעילו מוזיקה ולחצו על “התחל”");
      readout.setTolerance(settings.toleranceCents);
      trace.setTolerance(settings.toleranceCents);
    },

    unmount() {
      session?.stop();
      cleanups.forEach((fn) => fn());
    },
  };
}
