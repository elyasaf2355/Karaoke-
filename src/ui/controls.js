import { h } from "./dom.js";
import { NOTE_NAMES_HE, SCALES } from "../core/music-theory.js";
import { STRICTNESS, RESPONSE } from "../core/settings.js";

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

/** A small segmented switch bound to one setting. options: { value: {label, hint} } */
function optionPicker(settings, key, title, options) {
  const buttons = Object.entries(options).map(([value, { label, hint }]) =>
    h("button", { type: "button", class: "segmented__option", dataset: { value }, title: hint,
      onclick: () => settings.set(key, value) }, label));
  const sync = () => buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === settings.get(key))));
  const unsubscribe = settings.subscribe(sync);
  sync();
  return {
    element: h("div", { class: "field" }, h("span", {}, title), h("div", { class: "segmented", role: "group", "aria-label": title }, buttons)),
    destroy: unsubscribe,
  };
}

/** "How picky should I be". */
export function strictnessPicker(settings) {
  return optionPicker(settings, "strictness", "רמת קפדנות",
    Object.fromEntries(Object.entries(STRICTNESS).map(([k, v]) => [k, { label: v.label, hint: `±${v.toleranceCents} סנט` }])));
}

/** "How calm should the meter be". */
export function responsePicker(settings) {
  return optionPicker(settings, "meterResponse", "תגובת המדד",
    Object.fromEntries(Object.entries(RESPONSE).map(([k, v]) => [k, { label: v.label, hint: `הערכה ממוצעת על ${v.timeConstantSec} שניות` }])));
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
