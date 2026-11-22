import { h } from "../ui/dom.js";
import { ICONS } from "../ui/icons.js";
import { Readout } from "../ui/readout.js";
import { PitchTrace } from "../ui/pitch-trace.js";
import { ListeningSession } from "../ui/listening-session.js";
import { scalePicker, strictnessPicker, settingsPanel } from "../ui/controls.js";
import { renderSummary } from "../ui/summary-card.js";
import { detectPitch } from "../core/pitch-detector.js";
import { PitchSmoother } from "../core/pitch-smoother.js";
import { SessionStats } from "../core/session-stats.js";
import { feedbackFor } from "../core/feedback.js";
import { freqToMidi, nearestScaleNote, noteNameOf } from "../core/music-theory.js";

const MIN_CLARITY = 0.8;

/** Free tuner: shows how far the current note is from the nearest note of the chosen scale. */
export function createTunerMode({ settings }) {
  let readout, trace, session, smoother, stats, toggleButton, summaryEl, cleanups = [];

  function judge(midi) {
    const scaleNote = nearestScaleNote(midi, settings.get("root"), settings.get("scale"));
    const inTune = scaleNote.inScale && Math.abs(scaleNote.cents) <= settings.toleranceCents;
    const verdict = inTune ? "inTune" : scaleNote.cents > 0 ? "sharp" : "flat";
    return { scaleNote, verdict };
  }

  function onFrame(tap) {
    const now = tap.now;
    const found = detectPitch(tap.readSamples(), tap.sampleRate);
    if (found && found.clarity > MIN_CLARITY) {
      const { scaleNote, verdict } = judge(smoother.push(freqToMidi(found.freq), now));
      stats.record(verdict, scaleNote.cents);
      trace.push(now, scaleNote.cents);
      const { headline, detail } = feedbackFor({ verdict, cents: scaleNote.cents, octave: 0, targetMidi: scaleNote.target, inScale: scaleNote.inScale });
      readout.update({ state: verdict === "inTune" ? "ok" : verdict, note: noteNameOf(scaleNote.target), cents: scaleNote.cents, headline, detail });
    } else {
      smoother.miss(now);
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
      summaryEl = h("div", { class: "summary" });
      toggleButton = h("button", { class: "primary", type: "button", onclick: () => session.toggle() }, "התחל להקשיב");
      const scale = scalePicker(settings);
      const strictness = strictnessPicker(settings);
      cleanups = [scale.destroy, strictness.destroy, settings.subscribe((key) => key === "strictness" && applyTolerance())];

      session = new ListeningSession({
        onStart: () => { stats = new SessionStats(); trace.reset(); summaryEl.replaceChildren(); },
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
        settingsPanel(scale.element, strictness.element));
      readout.idle("לחצו על “התחל להקשיב” ושירו");
      applyTolerance();
    },

    unmount() {
      session?.stop();
      cleanups.forEach((fn) => fn());
    },
  };
}
