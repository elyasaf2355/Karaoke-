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

/** Explains a getUserMedia failure in plain Hebrew, with the browser's error name for diagnosis. */
export function describeMicError(error) {
  const name = error?.name ?? "";
  if (!window.isSecureContext || !navigator.mediaDevices) {
    return "הדף לא נפתח בכתובת מאובטחת (https). פתחו אותו מהכתובת של GitHub Pages בדפדפן רגיל, ולא מתוך אפליקציה או מקובץ.";
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return `ההרשאה למיקרופון נחסמה. בכרום: המנעול ליד הכתובת, הרשאות, מיקרופון, אפשר. באייפון: הגדרות, Safari, מיקרופון. אחר כך רעננו את הדף. (${name})`;
  }
  if (name === "NotFoundError") return `לא נמצא מיקרופון במכשיר. (${name})`;
  if (name === "NotReadableError") return `המיקרופון תפוס על ידי אפליקציה אחרת. סגרו אותה ונסו שוב. (${name})`;
  return `לא הצלחנו לפתוח את המיקרופון. (${name || String(error)})`;
}
