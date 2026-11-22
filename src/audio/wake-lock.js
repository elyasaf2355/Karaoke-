/** Keeps the screen on while singing (where the browser supports it). Returns a release function. */
export async function keepScreenAwake() {
  try {
    const lock = await navigator.wakeLock?.request("screen");
    return () => lock?.release().catch(() => {});
  } catch {
    return () => {}; // denied or unsupported: harmless
  }
}
