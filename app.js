(function () {
  const $ = (id) => document.getElementById(id);
  const rootSel = $("root"), scaleSel = $("scale");
  const TOLERANCE = 25;      // סנטים: בתוך הטווח נחשב "מדויק"
  const GAUGE_RANGE = 50;    // המחוון מציג ±50 סנט
  const HISTORY = 5;         // החלקה על כמה פריימים אחרונים

  NOTE_NAMES_HE.forEach((n, i) => rootSel.add(new Option(n, i)));
  Object.entries(SCALES).forEach(([k, v]) => scaleSel.add(new Option(v.label, k)));
  try {
    rootSel.value = localStorage.getItem("root") || "0";
    scaleSel.value = localStorage.getItem("scale") || "chromatic";
  } catch (e) { scaleSel.value = "chromatic"; }
  [rootSel, scaleSel].forEach((el) => el.addEventListener("change", () => {
    try { localStorage.setItem("root", rootSel.value); localStorage.setItem("scale", scaleSel.value); } catch (e) {}
  }));
  // במצב כרומטי אין משמעות לצליל בסיס
  const syncRoot = () => { rootSel.disabled = scaleSel.value === "chromatic"; };
  scaleSel.addEventListener("change", syncRoot); syncRoot();

  let ctx, stream, analyser, buf, raf = 0, running = false;
  let history = [], lastVoice = 0;

  function setUI(state, note, msg, detail, cents) {
    $("display").dataset.state = state;
    $("note").textContent = note;
    $("message").textContent = msg;
    $("detail").textContent = detail || "";
    const needle = $("needle");
    if (cents == null) { needle.style.opacity = ".25"; needle.style.left = "50%"; }
    else {
      const c = Math.max(-GAUGE_RANGE, Math.min(GAUGE_RANGE, cents));
      needle.style.opacity = "1";
      needle.style.left = 50 + (c / GAUGE_RANGE) * 50 + "%";
    }
  }

  function frame() {
    if (!running) return;
    analyser.getFloatTimeDomainData(buf);
    const res = detectPitch(buf, ctx.sampleRate);
    const now = performance.now();
    if (res && res.clarity > 0.8) {
      history.push(freqToMidi(res.freq));
      if (history.length > HISTORY) history.shift();
      lastVoice = now;
      const midi = median(history);
      const a = analyze(midi, +rootSel.value, scaleSel.value);
      const cents = Math.round(a.cents);
      const detail = (a.inScale ? "" : "הצליל מחוץ לסולם · ") + "יעד: " + a.noteName +
        " · " + (cents > 0 ? "+" : "") + cents + " סנט";
      if (Math.abs(a.cents) <= TOLERANCE && a.inScale) setUI("ok", a.noteName, "מדויק! ✓", detail, a.cents);
      else if (a.cents > 0) setUI("high", a.noteName, "שירו נמוך יותר ⬇️", detail, a.cents);
      else setUI("low", a.noteName, "שירו גבוה יותר ⬆️", detail, a.cents);
    } else if (now - lastVoice > 400) {
      history = [];
      setUI("idle", "—", "מקשיבים… שירו משהו", "", null);
    }
    raf = requestAnimationFrame(frame);
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      setUI("idle", "—", "אין גישה למיקרופון", "אשרו שימוש במיקרופון בהגדרות הדפדפן (נדרש HTTPS)", null);
      return;
    }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    buf = new Float32Array(analyser.fftSize);
    src.connect(analyser);
    running = true; history = [];
    $("toggle").textContent = "עצירה"; $("toggle").className = "stop";
    setUI("idle", "—", "מקשיבים… שירו משהו", "", null);
    frame();
  }

  function stop() {
    running = false; cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close();
    $("toggle").textContent = "התחלה"; $("toggle").className = "start";
    setUI("idle", "—", "לחצו על התחלה ושירו", "", null);
  }

  $("toggle").addEventListener("click", () => (running ? stop() : start()));
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
