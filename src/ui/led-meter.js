import { h } from "./dom.js";

const SEGMENTS = 25;          // odd, so there is a centre LED
const RANGE_CENTS = 50;       // the strip shows -50..+50 cents

/** A row of LEDs like the strip on a guitar-pedal tuner. Left = flat, right = sharp. */
export class LedMeter {
  constructor() {
    this.centre = (SEGMENTS - 1) / 2;
    this.leds = Array.from({ length: SEGMENTS }, (_, i) => h("i", { class: i === this.centre ? "led led--centre" : "led" }));
    this.element = h("div", { class: "led-meter", "aria-hidden": "true" },
      h("div", { class: "led-meter__strip" }, this.leds),
      h("div", { class: "led-meter__labels" }, h("span", {}, "נמוך"), h("span", {}, "גבוה")));
    this.setTolerance(35);
  }

  /** Marks the LEDs that count as "in tune" for the current strictness. */
  setTolerance(toleranceCents) {
    const centsPerLed = (2 * RANGE_CENTS) / (SEGMENTS - 1);
    this.leds.forEach((led, i) => led.classList.toggle("led--zone", Math.abs((i - this.centre) * centsPerLed) <= toleranceCents + 1e-9));
  }

  /** @param {number|null} cents deviation to show, or null to dim the meter */
  show(cents) {
    const centsPerLed = (2 * RANGE_CENTS) / (SEGMENTS - 1);
    const lit = cents === null ? -1 : Math.max(0, Math.min(SEGMENTS - 1, Math.round(cents / centsPerLed) + this.centre));
    this.leds.forEach((led, i) => {
      led.classList.toggle("led--on", i === lit);
      led.classList.toggle("led--near", lit >= 0 && Math.abs(i - lit) === 1);
    });
  }
}
