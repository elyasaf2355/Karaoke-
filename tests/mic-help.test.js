import test from "node:test";
import assert from "node:assert/strict";
import { micHelp, detectBrowser } from "../src/core/mic-help.js";

const UA = {
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
  safariIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  whatsapp: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 330.0",
};
const secure = { secure: true, hasMediaDevices: true };

test("detectBrowser recognises the common mobile browsers", () => {
  assert.equal(detectBrowser(UA.chromeIos).chromeOnIos, true);
  assert.equal(detectBrowser(UA.safariIos).chromeOnIos, false);
  assert.equal(detectBrowser(UA.safariIos).ios, true);
  assert.equal(detectBrowser(UA.chromeAndroid).android, true);
  assert.equal(detectBrowser(UA.whatsapp).inApp, true);
  assert.equal(detectBrowser(UA.instagram).inApp, true);
  assert.equal(detectBrowser(UA.chromeAndroid).inApp, false);
  assert.equal(detectBrowser("").inApp, false);
});

test("a saved 'denied' decision is explained as remembered, with Android Chrome steps", () => {
  const text = micHelp({ ...secure, errorName: "NotAllowedError", permission: "denied", userAgent: UA.chromeAndroid });
  assert.match(text, /זוכר/);
  assert.match(text, /אנדרואיד/);
  assert.match(text, /NotAllowedError/);
});

test("Chrome on iPhone is pointed at its own iOS setting, and offered Safari", () => {
  const text = micHelp({ ...secure, errorName: "NotAllowedError", userAgent: UA.chromeIos });
  assert.match(text, /הגדרות הטלפון.*Chrome/);
  assert.match(text, /Safari/);
});

test("Safari on iPhone gets Safari steps, not Chrome steps", () => {
  const text = micHelp({ ...secure, errorName: "NotAllowedError", userAgent: UA.safariIos });
  assert.match(text, /Safari, מיקרופון/);
  assert.doesNotMatch(text, /Chrome/);
});

test("desktop gets the lock-icon steps", () => {
  assert.match(micHelp({ ...secure, errorName: "NotAllowedError", userAgent: UA.desktop }), /סמל המנעול/);
});

test("permission 'denied' alone (no error name yet) is enough to explain the block", () => {
  assert.match(micHelp({ ...secure, permission: "denied", userAgent: UA.desktop }), /חסום/);
});

test("in-app browsers are told to open the link in Chrome or Safari", () => {
  assert.match(micHelp({ ...secure, errorName: "NotAllowedError", userAgent: UA.whatsapp }), /Chrome או ב־Safari/);
  assert.match(micHelp({ secure: false, hasMediaDevices: false, userAgent: UA.instagram }), /בתוך אפליקציה/);
});

test("insecure pages are explained as an https problem", () => {
  assert.match(micHelp({ secure: false, hasMediaDevices: false, userAgent: UA.desktop }), /https/);
  assert.match(micHelp({ secure: true, hasMediaDevices: false, userAgent: UA.desktop }), /https/);
});

test("other failures keep their own explanation and error name", () => {
  assert.match(micHelp({ ...secure, errorName: "NotFoundError" }), /לא נמצא מיקרופון/);
  assert.match(micHelp({ ...secure, errorName: "NotReadableError" }), /תפוס/);
  assert.match(micHelp({ ...secure, errorName: "WeirdError" }), /WeirdError/);
  assert.match(micHelp({ ...secure }), /שגיאה לא ידועה/);
});

test("every message is non-empty for every combination of inputs", () => {
  for (const ua of Object.values(UA)) for (const errorName of ["", "NotAllowedError", "NotFoundError", "X"]) {
    for (const permission of [null, "granted", "denied", "prompt"]) for (const s of [true, false]) {
      assert.ok(micHelp({ errorName, secure: s, hasMediaDevices: s, permission, userAgent: ua }).length > 20);
    }
  }
});
