import { openMicrophone, describeMicError } from "../audio/microphone.js";
import { MicTap } from "../audio/mic-tap.js";
import { keepScreenAwake } from "../audio/wake-lock.js";

/**
 * Owns the start/stop lifecycle shared by every mode: open the mic, keep the screen on,
 * run a per-frame callback, and clean everything up again.
 */
export class ListeningSession {
  /**
   * @param {{micOptions?:()=>object, onStart:(tap:MicTap)=>void, onFrame:(tap:MicTap)=>void|boolean, onStop:()=>void, onError:(message:string)=>void, onStateChange:(running:boolean)=>void}} hooks
   *   onFrame may return true to stop the session (e.g. the song ended).
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.running = false;
    this.frameRequest = 0;
  }

  async start() {
    if (this.running) return;
    try {
      this.mic = await openMicrophone(this.hooks.micOptions?.());
    } catch (error) {
      this.hooks.onError(await describeMicError(error));
      return;
    }
    this.tap = new MicTap(this.mic.context, this.mic.source);
    this.releaseWakeLock = await keepScreenAwake();
    this.running = true;
    this.hooks.onStateChange(true);
    this.hooks.onStart(this.tap);
    this.#loop();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
    this.releaseWakeLock?.();
    this.mic.close();
    this.hooks.onStop();
    this.hooks.onStateChange(false);
  }

  toggle() { return this.running ? this.stop() : this.start(); }

  #loop = () => {
    if (!this.running) return;
    if (this.hooks.onFrame(this.tap) === true) { this.stop(); return; }
    this.frameRequest = requestAnimationFrame(this.#loop);
  };
}
