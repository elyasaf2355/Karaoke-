import { h } from "../ui/dom.js";
import { ICONS } from "../ui/icons.js";
import { Readout } from "../ui/readout.js";
import { PianoRoll } from "../ui/piano-roll.js";
import { ListeningSession } from "../ui/listening-session.js";
import { strictnessPicker, responsePicker, checkbox, settingsPanel } from "../ui/controls.js";
import { renderSummary } from "../ui/summary-card.js";
import { scheduleBacking } from "../audio/backing-synth.js";
import { detectPitch } from "../core/pitch-detector.js";
import { PitchSmoother } from "../core/pitch-smoother.js";
import { SongJudge } from "../core/song-judge.js";
import { buildTimeline } from "../core/song-timeline.js";
import { SONGS } from "../core/songs.js";
import { feedbackFor } from "../core/feedback.js";
import { freqToMidi, noteNameOf } from "../core/music-theory.js";

const MIN_CLARITY = 0.8;
/** Fixed processing delay between the voice and what we analyse (analysis window + the smoother's median window). */
const PROCESSING_LAG_SEC = 0.15;
const TRACE_SECONDS = 6;
const semitones = (n) => (n === 1 ? "חצי טון" : `${n} חצאי טון`);
const VERDICT_COLOR = { inTune: "--led-ok", sharp: "--led-sharp", flat: "--led-flat", octave: "--led-octave" };

/** The app plays a known song; the singer is judged against its melody, including the octave. */
export function createSongMode({ settings }) {
  let readout, roll, rollCanvas, session, judge, backing, timeline, song, smoother, trace, stats;
  let toggleButton, summaryEl, songSelect, octaveSelect, guideBox, phonesBox, cleanups = [];

  function songTime(tap) {
    const outputLatency = tap.context.outputLatency || 0;
    return {
      playing: tap.now - backing.songStart - outputLatency,
      voice: tap.now - backing.songStart - PROCESSING_LAG_SEC - outputLatency - tap.context.baseLatency,
    };
  }

  function showVerdict(result) {
    if (result.verdict === "rest") return readout.idle("הפסקה");
    const targetMidi = result.note.midi;
    const shownTarget = targetMidi + result.shift;
    const { headline, detail: baseDetail } = feedbackFor({ ...result, targetMidi: shownTarget });
    const detail = result.shift ? `${baseDetail} · הועבר ${semitones(Math.abs(result.shift))} ${result.shift > 0 ? "למעלה" : "למטה"}` : baseDetail;
    const state = { inTune: "ok", sharp: "sharp", flat: "flat", octave: "octave", silent: "idle" }[result.verdict];
    readout.update({ state, note: noteNameOf(shownTarget), cents: result.verdict === "silent" ? null : result.cents, headline, detail });
  }

  function onFrame(tap) {
    const time = songTime(tap);
    const found = detectPitch(tap.readSamples(), tap.sampleRate);
    let midi = null;
    if (found && found.clarity > MIN_CLARITY) midi = smoother.push(freqToMidi(found.freq), tap.now);
    else smoother.miss(tap.now);

    if (time.voice < 0) {
      readout.idle(`מתחילים בעוד ${Math.ceil(-time.playing / timeline.secPerBeat)}…`);
    } else {
      const result = judge.update(time.voice, midi);
      showVerdict(result);
      if (midi !== null) trace.push({ t: time.voice, midi, colorVar: VERDICT_COLOR[result.verdict] ?? "--muted" });
    }
    while (trace.length && trace[0].t < time.playing - TRACE_SECONDS) trace.shift();
    roll.draw({ notes: timeline.notes, playSec: time.playing, trace });
    return time.playing > timeline.durationSec + 0.5; // the song is over
  }

  function buildSession() {
    return new ListeningSession({
      micOptions: () => ({ echoCancellation: !phonesBox.input.checked }),
      onStart: (tap) => {
        song = SONGS[+songSelect.value];
        timeline = buildTimeline(song);
        roll = new PianoRoll(rollCanvas, timeline);
        judge = new SongJudge(timeline.notes, { octaveMode: octaveSelect.value, toleranceCents: settings.toleranceCents });
        smoother = new PitchSmoother({ timeConstantSec: settings.smoothingSec }); trace = [];
        backing = scheduleBacking(tap.context, song, timeline, { guideMelody: guideBox.input.checked });
        summaryEl.replaceChildren();
      },
      onFrame,
      onStop: () => { backing?.stop(); readout.idle("סיימנו"); renderSummary(summaryEl, judge.stats); },
      onError: (message) => readout.idle("אין גישה למיקרופון", message),
      onStateChange: (running) => {
        toggleButton.textContent = running ? "עצור" : "התחל שיר";
        toggleButton.classList.toggle("primary--stop", running);
      },
    });
  }

  return {
    id: "song",
    title: "שיר",
    icon: ICONS.song,

    mount(host) {
      readout = new Readout();
      rollCanvas = h("canvas", { class: "roll", "aria-label": "צלילי המנגינה והקול שלכם" });
      songSelect = h("select", { id: "song-pick", "aria-label": "שיר" }, SONGS.map((s, i) => h("option", { value: i }, s.title)));
      octaveSelect = h("select", { id: "octave-mode", "aria-label": "התאמה למנגינה" },
        h("option", { value: "strict" }, "מדויק: אותם צלילים ואותה אוקטבה"),
        h("option", { value: "loose" }, "כל אוקטבה"),
        h("option", { value: "free" }, "בקול שלי: התאמה אוטומטית לגובה שלכם"));
      octaveSelect.value = settings.get("octaveMode");
      octaveSelect.addEventListener("change", () => settings.set("octaveMode", octaveSelect.value));
      guideBox = checkbox("guide", "להשמיע את המנגינה כהדרכה (עדיף באוזניות)", settings.get("guideMelody"), (on) => settings.set("guideMelody", on));
      phonesBox = checkbox("phones", "אני עם אוזניות. בלי אוזניות יופעל ביטול הד", settings.get("headphones"), (on) => settings.set("headphones", on));
      const strictness = strictnessPicker(settings);
      const response = responsePicker(settings);
      summaryEl = h("div", { class: "summary" });
      toggleButton = h("button", { class: "primary", type: "button", onclick: () => session.toggle() }, "התחל שיר");
      cleanups = [strictness.destroy, response.destroy, settings.subscribe((key) => key === "strictness" && readout.setTolerance(settings.toleranceCents))];
      session = buildSession();

      host.append(
        h("p", { class: "lede" }, "האפליקציה מנגנת את השיר, ואתם שרים את המנגינה. נבדקים גם הצליל וגם האוקטבה."),
        h("label", { class: "field" }, h("span", {}, "שיר"), songSelect),
        rollCanvas, readout.element, toggleButton, summaryEl,
        settingsPanel(
          h("label", { class: "field" }, h("span", {}, "התאמה למנגינה"), octaveSelect),
          strictness.element, response.element, guideBox.element, phonesBox.element));
      const initialTimeline = buildTimeline(SONGS[0]);
      roll = new PianoRoll(rollCanvas, initialTimeline);
      roll.draw({ notes: initialTimeline.notes, playSec: 0, trace: [] });
      readout.idle("בחרו שיר ולחצו על “התחל שיר”");
      readout.setTolerance(settings.toleranceCents);
    },

    unmount() {
      session?.stop();
      cleanups.forEach((fn) => fn());
    },
  };
}
