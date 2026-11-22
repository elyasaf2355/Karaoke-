import { h, clear } from "./dom.js";
import { summaryFor } from "../core/feedback.js";

/** Shows the end-of-session summary inside a container (empties it when there is nothing to show). */
export function renderSummary(container, stats) {
  clear(container);
  const summary = summaryFor(stats);
  if (!summary) return;
  container.append(
    h("h3", {}, summary.headline),
    h("ul", {}, summary.lines.map((line) => h("li", {}, line))),
    h("p", { class: "summary__tip" }, summary.tip));
}
