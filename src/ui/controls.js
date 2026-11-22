import { h } from "./dom.js";
import { NOTE_NAMES_HE, SCALES } from "../core/music-theory.js";
import { STRICTNESS } from "../core/settings.js";

/** Key + scale pickers, bound to the settings store. */
export function scalePicker(settings, { allowChromatic = true, onManualChange } = {}) {
  const root = h("select", { id: "scale-root", "aria-label": "צליל בסיס" },
    NOTE_NAMES_HE.map((name, i) => h("option", { value: i }, name)));
  const scale = h("select", { id: "scale-kind", "aria-label": "סוג סולם" },
    Object.entries(SCALES).filter(([key]) => allowChromatic || key !== "chromatic").map(([key, s]) => h("option", { value: key }, s.label)));

  const sync = () => {
    root.value = settings.get("root");
    scale.value = allowChromatic || settings.get("scale") !== "chromatic" ? settings.get("scale") : "major";
    root.disabled = scale.value === "chromatic";
  };
  root.addEventListener("change", () => { settings.set("root", +root.value); onManualChange?.(); });
  scale.addEventListener("change", () => { settings.set("scale", scale.value); sync(); onManualChange?.(); });
  const unsubscribe = settings.subscribe(sync);
  sync();

  return {
    element: h("div", { class: "field-row" },
      h("label", { class: "field" }, h("span", {}, "סולם"), root),
      h("label", { class: "field" }, h("span", {}, "סוג"), scale)),
    sync,
    destroy: unsubscribe,
  };
}

/** Three-way "how picky should I be" switch. */
export function strictnessPicker(settings) {
  const buttons = Object.entries(STRICTNESS).map(([key, { label, toleranceCents }]) =>
    h("button", { type: "button", class: "segmented__option", dataset: { value: key }, title: `±${toleranceCents} סנט`,
      onclick: () => settings.set("strictness", key) }, label));
  const sync = () => buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === settings.get("strictness"))));
  const unsubscribe = settings.subscribe(sync);
  sync();
  return {
    element: h("div", { class: "field" }, h("span", {}, "רמת קפדנות"), h("div", { class: "segmented", role: "group" }, buttons)),
    destroy: unsubscribe,
  };
}

export function checkbox(id, label, checked, onChange) {
  const input = h("input", { type: "checkbox", id, checked });
  input.addEventListener("change", () => onChange(input.checked));
  return { element: h("label", { class: "check", for: id }, input, h("span", {}, label)), input };
}

/** Collapsible block for secondary options, so the main action stays above the fold. */
export function settingsPanel(...children) {
  return h("details", { class: "settings" }, h("summary", {}, "הגדרות"), h("div", { class: "settings__body" }, children));
}
