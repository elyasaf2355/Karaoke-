import { h } from "./dom.js";
import { LedMeter } from "./led-meter.js";

/** Shown instead of a note name while nothing is being sung. */
const IDLE_GLYPH = "♪";

/**
 * The main display: big note name, deviation in cents, LED strip, and a plain-language sentence.
 * state is one of: idle | ok | sharp | flat | octave
 */
export class Readout {
  constructor() {
    this.noteEl = h("div", { class: "readout__note" }, IDLE_GLYPH);
    this.centsEl = h("div", { class: "readout__cents" });
    this.headlineEl = h("p", { class: "readout__headline", "aria-live": "polite" });
    this.detailEl = h("p", { class: "readout__detail" });
    this.meter = new LedMeter();
    this.element = h("section", { class: "readout", dataset: { state: "idle" } },
      h("div", { class: "readout__top" }, this.noteEl, this.centsEl),
      this.meter.element, this.headlineEl, this.detailEl);
  }

  setTolerance(toleranceCents) { this.meter.setTolerance(toleranceCents); }

  /** @param {{state:string, note?:string, cents?:number|null, headline:string, detail?:string}} view */
  update({ state, note = IDLE_GLYPH, cents = null, headline, detail = "" }) {
    this.element.dataset.state = state;
    this.noteEl.textContent = note;
    this.centsEl.textContent = cents === null ? "" : `${cents > 0 ? "+" : ""}${Math.round(cents)}`;
    this.headlineEl.textContent = headline;
    this.detailEl.textContent = detail;
    this.meter.show(cents);
  }

  idle(headline, detail = "") { this.update({ state: "idle", headline, detail }); }
}
