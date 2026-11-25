/** User preferences with validation and persistence. Storage is injected so this stays testable. */

export const STRICTNESS = {
  relaxed: { label: "רגוע", toleranceCents: 50 },
  normal: { label: "רגיל", toleranceCents: 35 },
  strict: { label: "קפדן", toleranceCents: 20 },
};

/** How steadily the meter moves. A human voice wobbles, so slower = calmer needle, faster = more literal. */
export const RESPONSE = {
  calm: { label: "רגוע", timeConstantSec: 0.5 },
  normal: { label: "רגיל", timeConstantSec: 0.3 },
  quick: { label: "מהיר", timeConstantSec: 0.15 },
};

const DEFAULTS = {
  strictness: "normal",
  meterResponse: "calm",
  root: 0,
  scale: "chromatic",
  octaveMode: "strict",
  headphones: true,
  guideMelody: false,
  autoKey: true,
};

const VALIDATORS = {
  strictness: (v) => v in STRICTNESS,
  meterResponse: (v) => v in RESPONSE,
  root: (v) => Number.isInteger(v) && v >= 0 && v < 12,
  scale: (v) => ["major", "minor", "chromatic"].includes(v),
  octaveMode: (v) => ["strict", "loose", "free"].includes(v),
  headphones: (v) => typeof v === "boolean",
  guideMelody: (v) => typeof v === "boolean",
  autoKey: (v) => typeof v === "boolean",
};

const STORAGE_KEY = "karaoke.settings.v1";

export function createSettings(storage) {
  const listeners = new Set();
  const values = { ...DEFAULTS, ...load(storage) };

  function load(store) {
    try {
      const saved = JSON.parse(store?.getItem(STORAGE_KEY) ?? "{}");
      return Object.fromEntries(Object.entries(saved).filter(([k, v]) => VALIDATORS[k]?.(v)));
    } catch { return {}; } // corrupt or unavailable storage: fall back to defaults
  }

  function persist() {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(values)); } catch { /* storage blocked: keep in memory */ }
  }

  return {
    get: (key) => values[key],
    get toleranceCents() { return STRICTNESS[values.strictness].toleranceCents; },
    get smoothingSec() { return RESPONSE[values.meterResponse].timeConstantSec; },
    set(key, value) {
      if (!VALIDATORS[key]?.(value)) throw new RangeError(`Invalid setting ${key}=${value}`);
      if (values[key] === value) return;
      values[key] = value;
      persist();
      listeners.forEach((fn) => fn(key, value));
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
