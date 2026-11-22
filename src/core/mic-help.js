/** Turns a microphone failure plus what we know about the browser into plain-Hebrew instructions. Pure, so it is testable. */

/** @param {string} userAgent */
export function detectBrowser(userAgent = "") {
  const ios = /iPhone|iPad|iPod/.test(userAgent);
  const android = /Android/.test(userAgent);
  return {
    ios,
    android,
    chromeOnIos: ios && /CriOS/.test(userAgent),
    // in-app browsers (messengers, social apps, webviews) usually cannot use the microphone at all
    inApp: /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Telegram|WhatsApp|; wv\)|GSA\//.test(userAgent),
  };
}

const BLOCKED_STEPS = {
  chromeOnIos: "באייפון, Chrome צריך הרשאה משלו: הגדרות הטלפון, גללו ל־Chrome, והפעילו מיקרופון. אחר כך סגרו את הלשונית ופתחו מחדש. אפשר גם לפתוח את האתר ב־Safari.",
  ios: "באייפון: הגדרות הטלפון, Safari, מיקרופון, ובחרו שאלה או אפשר. אחר כך רעננו את הדף.",
  android: "באנדרואיד: לחצו על המנעול ליד הכתובת, הרשאות, מיקרופון, אפשר. אם זה לא עוזר: הגדרות הטלפון, אפליקציות, Chrome, הרשאות, מיקרופון, ובחרו אפשר בזמן שימוש. בסוף רעננו את הדף.",
  desktop: "לחצו על סמל המנעול ליד הכתובת, הרשאות, מיקרופון, אפשר, ורעננו את הדף.",
};

/**
 * @param {{errorName?:string, secure:boolean, hasMediaDevices:boolean, permission?:"granted"|"denied"|"prompt"|null, userAgent?:string}} env
 * @returns {string}
 */
export function micHelp({ errorName = "", secure, hasMediaDevices, permission = null, userAgent = "" }) {
  const browser = detectBrowser(userAgent);
  const suffix = errorName ? ` (${errorName})` : "";

  if (!secure || !hasMediaDevices) {
    return browser.inApp
      ? "האתר נפתח בתוך אפליקציה, ושם המיקרופון חסום. העתיקו את הכתובת ופתחו אותה ב־Chrome או ב־Safari."
      : "הדף לא נפתח בכתובת מאובטחת (https). פתחו אותו מהכתובת של GitHub Pages בדפדפן רגיל, ולא מקובץ.";
  }
  if (browser.inApp) {
    return "נראה שהאתר נפתח בתוך אפליקציה, ושם המיקרופון לרוב חסום. העתיקו את הכתובת ופתחו אותה ב־Chrome או ב־Safari.";
  }
  const blocked = errorName === "NotAllowedError" || errorName === "SecurityError" || permission === "denied";
  if (blocked) {
    const platform = browser.chromeOnIos ? "chromeOnIos" : browser.ios ? "ios" : browser.android ? "android" : "desktop";
    const remembered = permission === "denied" ? "המיקרופון חסום לאתר הזה, והדפדפן זוכר את זה ולא ישאל שוב. " : "ההרשאה למיקרופון נדחתה. ";
    return `${remembered}${BLOCKED_STEPS[platform]}${suffix}`;
  }
  if (errorName === "NotFoundError") return `לא נמצא מיקרופון במכשיר.${suffix}`;
  if (errorName === "NotReadableError") return `המיקרופון תפוס על ידי אפליקציה אחרת. סגרו אותה ונסו שוב.${suffix}`;
  return `לא הצלחנו לפתוח את המיקרופון.${suffix || ` (${errorName || "שגיאה לא ידועה"})`}`;
}
