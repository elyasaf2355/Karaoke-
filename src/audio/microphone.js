import { micHelp } from "../core/mic-help.js";

/** Microphone access and the Hebrew explanations for why it can fail. */

/**
 * Opens the microphone. Browser processing is off by default so the voice isn't altered;
 * turn echoCancellation on when the music plays through a speaker the mic can hear.
 * @returns {Promise<{context:AudioContext, source:MediaStreamAudioSourceNode, close:()=>void}>}
 */
export async function openMicrophone({ echoCancellation = false } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation, noiseSuppression: false, autoGainControl: false },
  });
  const context = new (window.AudioContext || window.webkitAudioContext)();
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  return {
    context,
    source,
    close() {
      stream.getTracks().forEach((track) => track.stop());
      context.close();
    },
  };
}

/** The browser's saved microphone decision for this site, or null where it can't be read (older Safari). */
async function readPermission() {
  try {
    return (await navigator.permissions.query({ name: "microphone" })).state;
  } catch {
    return null;
  }
}

/** Explains a getUserMedia failure in plain Hebrew, with steps for this browser and the error name for diagnosis. */
export async function describeMicError(error) {
  return micHelp({
    errorName: error?.name ?? "",
    secure: window.isSecureContext,
    hasMediaDevices: Boolean(navigator.mediaDevices),
    permission: await readPermission(),
    userAgent: navigator.userAgent,
  });
}
