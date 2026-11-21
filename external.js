(function () {
  const $ = (id) => document.getElementById(id);
  const TOL = 35, GAUGE = 50, CAL_MS = 5000, CHROMA_EVERY = 0.1;
  const rootSel = $("root"), scaleSel = $("scale"), autoBox = $("auto");
  NOTE_NAMES_HE.forEach((n, i) => rootSel.add(new Option(n, i)));

  let ctx, stream, an, anSpec, buf, spec, mags, raf = 0, running = false, session;
  let phase = "idle", calStart = 0, lastMagT = -1, stats;

  const keyName = (k) => NOTE_NAMES_HE[k.root] + " " + (k.scale === "major" ? "מז'ור" : "מינור");

  function setUI(state, note, msg, detail, cents) {
    $("display").dataset.state = state; $("note").textContent = note;
    $("message").textContent = msg; $("detail").textContent = detail || "";
    const nd = $("needle");
    if (cents == null) { nd.style.opacity = ".25"; nd.style.left = "50%"; }
    else { nd.style.opacity = "1"; nd.style.left = 50 + (Math.max(-GAUGE, Math.min(GAUGE, cents)) / GAUGE) * 50 + "%"; }
  }

  function applyKey(k) { rootSel.value = k.root; scaleSel.value = k.scale; }

  // שינוי ידני של הסולם מכבה את הזיהוי האוטומטי
  [rootSel, scaleSel].forEach((el) => el.addEventListener("change", () => { autoBox.checked = false; }));

  function readSpectrum(t) {
    if (t - lastMagT < CHROMA_EVERY) return null;
    lastMagT = t;
    anSpec.getFloatFrequencyData(spec);
    for (let k = 0; k < spec.length; k++) mags[k] = Math.pow(10, spec[k] / 20);
    return mags;
  }

  function endCalibration() {
    session.endCalibration();
    const k = session.tracker.key;
    if (k && session.musicHeard) {
      if (autoBox.checked) applyKey(k);
      setUI("idle", "—", "זוהה: " + keyName(k) + ". שירו!", "הסולם יתעדכן לבד אם השיר ישנה סולם", null);
    } else setUI("idle", "—", "לא נקלטה מוזיקה לכיול. בחרו סולם ידנית ושירו", "", null);
    phase = "sing"; stats = { total: 0, ok: 0 }; $("skip").hidden = true;
  }

  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    an.getFloatTimeDomainData(buf);
    const now = performance.now(), t = ctx.currentTime;
    if (phase === "cal") {
      session.calibrate(buf);
      session.process(buf, readSpectrum(t), t);
      const left = Math.ceil((CAL_MS - (now - calStart)) / 1000);
      setUI("idle", "…", "מקשיבים למוזיקה, אל תשירו עדיין (" + Math.max(left, 0) + ")", "", null);
      if (now - calStart >= CAL_MS) endCalibration();
      return;
    }
    const r = session.process(buf, readSpectrum(t), t);
    if (r.event === "change" && autoBox.checked) {
      applyKey(r.key);
      setUI("idle", "—", "הסולם השתנה ל" + keyName(r.key), "", null);
    } else if (r.event === "lock" && autoBox.checked) applyKey(r.key);
    if (r.midi !== null) {
      const a = analyze(r.midi, +rootSel.value, scaleSel.value), cents = Math.round(a.cents);
      const detail = (a.inScale ? "" : "הצליל מחוץ לסולם · ") + "יעד: " + a.noteName + " · " + (cents > 0 ? "+" : "") + cents + " סנט";
      const ok = a.inScale && Math.abs(a.cents) <= TOL;
      stats.total++; if (ok) stats.ok++;
      if (ok) setUI("ok", a.noteName, "מדויק! ✓", detail, a.cents);
      else if (a.cents > 0) setUI("high", a.noteName, "שירו נמוך יותר ⬇️", detail, a.cents);
      else setUI("low", a.noteName, "שירו גבוה יותר ⬆️", detail, a.cents);
      $("score").textContent = "ציון עד כה: " + Math.round((100 * stats.ok) / stats.total) + "%";
    } else if (t - session.lastVoiceT > 0.4 && !/הסולם השתנה/.test($("message").textContent)) {
      setUI("idle", "—", "שירו…", "", null);
    }
  }

  async function start() {
    try {
      // הד/ניקוי רעשים כבויים כדי שהקול לא יעוות; את הרקע מסננים בעצמנו לפי העוצמה.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) { setUI("idle", "—", "אין גישה למיקרופון", micErrorText(e), null); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    an = ctx.createAnalyser(); an.fftSize = 4096; buf = new Float32Array(4096); src.connect(an);
    anSpec = ctx.createAnalyser(); anSpec.fftSize = 16384; anSpec.smoothingTimeConstant = 0;
    spec = new Float32Array(anSpec.frequencyBinCount); mags = new Float32Array(spec.length); src.connect(anSpec);
    session = new ExternalSession(ctx.sampleRate, { fftSize: anSpec.fftSize, chromaEverySec: CHROMA_EVERY });
    lastMagT = -1; phase = "cal"; calStart = performance.now(); running = true;
    $("toggle").textContent = "עצירה"; $("toggle").className = "stop"; $("skip").hidden = false; $("score").textContent = "";
    frame();
  }

  function stop() {
    running = false; cancelAnimationFrame(raf); phase = "idle";
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close();
    $("toggle").textContent = "התחלה"; $("toggle").className = "start"; $("skip").hidden = true;
    setUI("idle", "—", "הפעילו את הקריוקי ואז לחצו על התחלה", "", null);
  }

  $("toggle").addEventListener("click", () => (running ? stop() : start()));
  $("skip").addEventListener("click", () => { if (phase === "cal") { autoBox.checked = false; endCalibration(); } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
