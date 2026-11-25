import { h } from "../ui/dom.js";
import { ICONS } from "../ui/icons.js";
import { Readout } from "../ui/readout.js";
import { PitchTrace } from "../ui/pitch-trace.js";
import { ListeningSession } from "../ui/listening-session.js";
import { scalePicker, strictnessPicker, responsePicker, settingsPanel } from "../ui/controls.js";
import { renderSummary } from "../ui/summary-card.js";
import { detectPitch } from "../core/pitch-detector.js";
import { PitchSmoother } from "../core/pitch-smoother.js";
import { SessionStats } from "../core/session-stats.js";
import { feedbackFor } from "../core/feedback.js";
import { ScaleJudge } from "../core/scale-judge.js";
import { freqToMidi, noteNameOf } from "../core/music-theory.js";

const MIN_CLARITY = 0.8;

/** Free tuner: shows how far the current note is from the nearest note of the chosen scale. */
export function createTunerMode({ settings }) {
  let readout, trace, session, smoother, scaleJudge, stats, toggleButton, summaryEl, cleanups = [];

  function onFrame(tap) {
    const now = tap.now;
    const found = detectPitch(tap.readSamples(), tap.sampleRate);
    if (found && found.clarity > MIN_CLARITY) {
      const { scaleNote, verdict } = scaleJudge.judge(smoother.push(freqToMidi(found.freq), now), settings.get("root"), settings.get("scale"), settings.toleranceCents);
      stats.record(verdict, scaleNote.cents);
      trace.push(now, scaleNote.cents);
      const { headline, detail } = feedbackFor({ verdict, cents: scaleNote.cents, octave: 0, targetMidi: scaleNote.target, inScale: scaleNote.inScale });
      readout.update({ state: verdict === "inTune" ? "ok" : verdict, note: noteNameOf(scaleNote.target), cents: scaleNote.cents, headline, detail });
    } else {
      smoother.miss(now);
      if (smoother.value === null) scaleJudge.reset();
      trace.push(now, null);
      if (smoother.silentFor(now) > 0.4) readout.idle("מקשיב… שירו צליל");
    }
    trace.draw(now);
  }

  function applyTolerance() {
    readout.setTolerance(settings.toleranceCents);
    trace.setTolerance(settings.toleranceCents);
  }

  return {
    id: "tuner",
    title: "כוונון",
    icon: ICONS.tuner,

    mount(host) {
      readout = new Readout();
      trace = new PitchTrace(h("canvas", { class: "trace", "aria-label": "היסטוריית הגובה בשמונה השניות האחרונות" }));
      smoother = new PitchSmoother();
      scaleJudge = new ScaleJudge();
      summaryEl = h("div", { class: "summary" });
      toggleButton = h("button", { class: "primary", type: "button", onclick: () => session.toggle() }, "התחל להקשיב");
      const scale = scalePicker(settings);
      const strictness = strictnessPicker(settings);
      const response = responsePicker(settings);
      cleanups = [scale.destroy, strictness.destroy, response.destroy, settings.subscribe((key) => key === "strictness" && applyTolerance())];

      session = new ListeningSession({
        onStart: () => {
          stats = new SessionStats(); trace.reset(); summaryEl.replaceChildren();
          smoother = new PitchSmoother({ timeConstantSec: settings.smoothingSec });
          scaleJudge.reset();
        },
        onFrame,
        onStop: () => { readout.idle("הפסקנו להקשיב"); renderSummary(summaryEl, stats); },
        onError: (message) => readout.idle("אין גישה למיקרופון", message),
        onStateChange: (running) => {
          toggleButton.textContent = running ? "עצור" : "התחל להקשיב";
          toggleButton.classList.toggle("primary--stop", running);
        },
      });

      host.append(
        h("p", { class: "lede" }, "שירו צליל והאפליקציה תראה כמה הוא רחוק מהצליל הקרוב בסולם."),
        readout.element, trace.canvas, toggleButton, summaryEl,
        settingsPanel(scale.element, strictness.element, response.element));
      readout.idle("לחצו על “התחל להקשיב” ושירו");
      applyTolerance();
    },

    unmount() {
      session?.stop();
      cleanups.forEach((fn) => fn());
    },
  };
}
