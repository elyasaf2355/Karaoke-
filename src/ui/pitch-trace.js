import { cssVar } from "./dom.js";

const WINDOW_SEC = 8;
const RANGE_CENTS = 100;

/** A short scrolling history of how far off the singer has been, so drifting is visible. */
export class PitchTrace {
  constructor(canvas) {
    this.canvas = canvas;
    this.points = [];
    this.toleranceCents = 35;
  }

  setTolerance(toleranceCents) { this.toleranceCents = toleranceCents; }
  reset() { this.points = []; }

  /** @param {number} timeSec @param {number|null} cents null marks a gap (silence) */
  push(timeSec, cents) {
    this.points.push({ t: timeSec, cents });
    while (this.points.length && this.points[0].t < timeSec - WINDOW_SEC) this.points.shift();
  }

  draw(nowSec) {
    const { canvas } = this;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    const g = canvas.getContext("2d");
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, width, height);

    const y = (cents) => height / 2 - (Math.max(-RANGE_CENTS, Math.min(RANGE_CENTS, cents)) / RANGE_CENTS) * (height / 2 - 3);
    g.fillStyle = cssVar("--zone-fill");
    g.fillRect(0, y(this.toleranceCents), width, y(-this.toleranceCents) - y(this.toleranceCents));
    g.strokeStyle = cssVar("--line");
    g.beginPath(); g.moveTo(0, y(0)); g.lineTo(width, y(0)); g.stroke();

    g.strokeStyle = cssVar("--ink");
    g.lineWidth = 2; g.lineJoin = "round";
    g.beginPath();
    let penDown = false;
    for (const p of this.points) {
      const x = width - ((nowSec - p.t) / WINDOW_SEC) * width;
      if (p.cents === null) { penDown = false; continue; }
      if (penDown) g.lineTo(x, y(p.cents)); else { g.moveTo(x, y(p.cents)); penDown = true; }
    }
    g.stroke();
  }
}
