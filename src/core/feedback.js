import { noteNameOf } from "./music-theory.js";

/** All user-facing wording for a verdict lives here, so tone is easy to change and easy to test. */

const SMALL_MISS_CENTS = 60;

/**
 * @param {{verdict:string, cents:number, octave:number, targetMidi?:number, inScale?:boolean}} v
 * @returns {{headline:string, detail:string}}
 */
export function feedbackFor({ verdict, cents, octave, targetMidi, inScale = true }) {
  const target = targetMidi === undefined ? "" : noteNameOf(targetMidi);
  const centsText = `${cents > 0 ? "+" : ""}${Math.round(cents)} סנט`;
  const detail = [!inScale && "הצליל מחוץ לסולם", target && `היעד: ${target}`, verdict !== "octave" && verdict !== "silent" && verdict !== "rest" && centsText]
    .filter(Boolean).join(" · ");

  switch (verdict) {
    case "inTune": return { headline: "בול", detail };
    case "sharp": return { headline: Math.abs(cents) < SMALL_MISS_CENTS ? "גבוה קצת, רדו מעט" : "גבוה, רדו", detail };
    case "flat": return { headline: Math.abs(cents) < SMALL_MISS_CENTS ? "נמוך קצת, עלו מעט" : "נמוך, עלו", detail };
    case "octave": return { headline: octave < 0 ? "אוקטבה נמוכה מדי, עלו אוקטבה" : "אוקטבה גבוהה מדי, רדו אוקטבה", detail };
    case "silent": return { headline: target ? `עכשיו: ${target}` : "שירו…", detail: "" };
    default: return { headline: "הפסקה", detail: "" };
  }
}

/**
 * End-of-session summary text.
 * @param {import("./session-stats.js").SessionStats} stats
 * @returns {{headline:string, lines:string[], tip:string}|null} null when nothing was judged
 */
export function summaryFor(stats) {
  if (!stats.total) return null;
  const pct = (outcome) => Math.round(stats.percent(outcome));
  const lines = [`בול: ${pct("inTune")}%`, `גבוה מדי: ${pct("sharp")}%`, `נמוך מדי: ${pct("flat")}%`];
  if (stats.counts.octave) lines.push(`אוקטבה שגויה: ${pct("octave")}%`);
  if (stats.counts.silent) lines.push(`בלי שירה: ${pct("silent")}%`);

  const bias = Math.round(Math.abs(stats.biasCents));
  const tips = {
    flat: `בממוצע שרתם נמוך בכ־${bias} סנט. נסו לכוון את הקול קצת למעלה.`,
    sharp: `בממוצע שרתם גבוה בכ־${bias} סנט. נסו להרפות ולרדת קצת.`,
    balanced: "אין נטייה ברורה לכיוון אחד, והסטיות מתאזנות.",
  };
  return { headline: `סיכום: ${pct("inTune")}% בול`, lines, tip: tips[stats.tendency()] };
}
