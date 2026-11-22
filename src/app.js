import { h, clear } from "./ui/dom.js";
import { createSettings } from "./core/settings.js";
import { createTunerMode } from "./modes/tuner-mode.js";
import { createSongMode } from "./modes/song-mode.js";
import { createKaraokeMode } from "./modes/karaoke-mode.js";

/**
 * App shell: a list of modes, a nav bar built from it, and a hash router.
 * To add a mode, write a module that returns {id, title, icon, mount(host), unmount()} and add it below.
 */
const MODE_FACTORIES = [createTunerMode, createSongMode, createKaraokeMode];

function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}

function start() {
  const settings = createSettings(safeStorage());
  const modes = MODE_FACTORIES.map((create) => create({ settings }));
  const host = document.getElementById("view");
  const nav = document.getElementById("nav");
  let current = null;

  const buttons = modes.map((mode) => {
    const icon = h("span", { class: "nav__icon" });
    icon.innerHTML = mode.icon; // trusted static SVG from our own icons module
    return h("a", { class: "nav__item", href: `#${mode.id}`, dataset: { mode: mode.id } }, icon, h("span", {}, mode.title));
  });
  nav.append(...buttons);

  function show(id) {
    const mode = modes.find((m) => m.id === id) ?? modes[0];
    if (current === mode) return;
    current?.unmount();
    clear(host);
    mode.mount(host);
    current = mode;
    buttons.forEach((b) => b.setAttribute("aria-current", String(b.dataset.mode === mode.id)));
    document.title = `${mode.title} · מכוון`;
  }

  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  show(location.hash.slice(1));
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

start();
