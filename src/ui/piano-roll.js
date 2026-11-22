import { cssVar } from "./dom.js";
import { NOTE_NAMES_HE } from "../core/music-theory.js";

const WINDOW_SEC = 6;
const PLAYHEAD_AT = 0.3;

/** Scrolling karaoke-style view: melody bars in pitch/time, with the singer's pitch drawn over them. */
export class PianoRoll {
  /** @param {HTMLCanvasElement} canvas @param {{lowest:number, highest:number}} range pitch range of the melody */
  constructor(canvas, { lowest, highest }) {
    this.canvas = canvas;
    // show an octave below the melody so an octave-low singer is visible on screen
    this.low = lowest - 13;
    this.high = highest + 5;
  }

  /** @param {{notes:object[], playSec:number, trace:Array<{t:number,midi:number,colorVar:string}>}} model */
  draw({ notes, playSec, trace }) {
    const { canvas } = this;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    const g = canvas.getContext("2d");
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.fillStyle = cssVar("--panel"); g.fillRect(0, 0, width, height);

    const rows = this.high - this.low + 1, rowHeight = height / rows;
    const yTop = (midi) => height - (midi - this.low + 1) * rowHeight;
    const x = (t) => width * PLAYHEAD_AT + ((t - playSec) / WINDOW_SEC) * width;

    this.#drawOctaveLines(g, width, yTop);
    for (const n of notes) {
      const left = x(n.start), right = x(n.end);
      if (right < 0 || left > width) continue;
      g.fillStyle = playSec >= n.start && playSec < n.end ? cssVar("--roll-note-active") : cssVar("--roll-note");
      g.beginPath(); g.roundRect(left, yTop(n.midi) + 1, Math.max(2, right - left - 2), rowHeight - 2, 3); g.fill();
    }
    for (const p of trace) {
      if (p.midi < this.low || p.midi > this.high + 1) continue;
      g.fillStyle = cssVar(p.colorVar);
      g.beginPath(); g.arc(x(p.t), height - (p.midi - this.low + 0.5) * rowHeight, 3, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = cssVar("--ink"); g.fillRect(width * PLAYHEAD_AT - 1, 0, 2, height);
  }

  #drawOctaveLines(g, width, yTop) {
    g.font = "11px Assistant, system-ui, sans-serif";
    g.direction = "ltr"; g.textAlign = "left";
    for (let midi = this.low; midi <= this.high; midi++) {
      if (midi % 12 !== 0) continue;
      g.fillStyle = cssVar("--line"); g.fillRect(0, yTop(midi), width, 1);
      g.fillStyle = cssVar("--muted"); g.fillText(`${NOTE_NAMES_HE[0]}${midi / 12 - 1}`, 4, yTop(midi) - 3);
    }
  }
}
