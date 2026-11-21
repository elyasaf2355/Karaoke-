(function () {
  const $ = (id) => document.getElementById(id);
  const TOL = 35, GAUGE = 50, CAL_MS = 5000, GATE = 1.8;
  const rootSel = $("root");
  NOTE_NAMES_HE.forEach((n, i) => rootSel.add(new Option(n, i)));

  let ctx, stream, an, anSpec, buf, spec, raf = 0, running = false;
  let phase = "idle", calStart = 0, rmsSum = 0, rmsN = 0, chroma, baseline = 0.01;
  let hist = [], lastVoice = 0, stats;

  function setUI(state, note, msg, detail, cents) {
    $("display").dataset.state = state; $("note").textContent = note;
    $("message").textContent = msg; $("detail").textContent = detail || "";
    const nd = $("needle");
    if (cents == null) { nd.style.opacity = ".25"; nd.style.left = "50%"; }
    else { nd.style.opacity = "1"; nd.style.left = 50 + (Math.max(-GAUGE, Math.min(GAUGE, cents)) / GAUGE) * 50 + "%"; }
  }

  function rmsOf(b) { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); }

  function addChroma() {
    anSpec.getFloatFrequencyData(spec);
    const hz = ctx.sampleRate / anSpec.fftSize;
    let total = 0; const f = new Float32Array(12);
    for (let k = Math.ceil(80 / hz); k < 1500 / hz; k++) {
      const mag = Math.pow(10, spec[k] / 20);
      f[((Math.round(freqToMidi(k * hz)) % 12) + 12) % 12] += mag; total += mag;
    }
    if (total > 0) for (let i = 0; i < 12; i++) chroma[i] += f[i] / total;
  }

  function endCalibration(auto) {
    if (auto && rmsN) baseline = Math.max(0.005, rmsSum / rmsN);
    if (auto && chroma.some((v) => v > 0) && rmsSum / Math.max(rmsN, 1) > 0.002) {
      const k = estimateKey(Array.from(chroma));
      rootSel.value = k.root; $("scale").value = k.scale;
      setUI("idle", "—", "זוהה: " + NOTE_NAMES_HE[k.root] + " " + (k.scale === "major" ? "מז'ור" : "מינור") + ". שירו!", "אפשר לתקן את הסולם למעלה", null);
    } else setUI("idle", "—", "לא נקלטה מוזיקה לכיול. בחרו סולם ידנית ושירו", "", null);
    phase = "sing"; stats = { total: 0, ok: 0 }; $("skip").hidden = true;
  }

  function frame() {
    if (!running) return;
    analyser_read();
    raf = requestAnimationFrame(frame);
  }

  function analyser_read() {
    an.getFloatTimeDomainData(buf);
    const now = performance.now();
    if (phase === "cal") {
      rmsSum += rmsOf(buf); rmsN++; addChroma();
      const left = Math.ceil((CAL_MS - (now - calStart)) / 1000);
      setUI("idle", "…", "מקשיבים למוזיקה, אל תשירו עדיין (" + Math.max(left, 0) + ")", "", null);
      if (now - calStart >= CAL_MS) endCalibration(true);
      return;
    }
    const r = detectPitch(buf, ctx.sampleRate, { minRms: baseline * GATE, threshold: 0.1 });
    if (r && r.clarity > 0.85) {
      hist.push(freqToMidi(r.freq)); if (hist.length > 5) hist.shift();
      lastVoice = now;
      const a = analyze(median(hist), +rootSel.value, $("scale").value), cents = Math.round(a.cents);
      const detail = (a.inScale ? "" : "הצליל מחוץ לסולם · ") + "יעד: " + a.noteName + " · " + (cents > 0 ? "+" : "") + cents + " סנט";
      const ok = a.inScale && Math.abs(a.cents) <= TOL;
      stats.total++; if (ok) stats.ok++;
      if (ok) setUI("ok", a.noteName, "מדויק! ✓", detail, a.cents);
      else if (a.cents > 0) setUI("high", a.noteName, "שירו נמוך יותר ⬇️", detail, a.cents);
      else setUI("low", a.noteName, "שירו גבוה יותר ⬆️", detail, a.cents);
      $("score").textContent = "ציון עד כה: " + Math.round((100 * stats.ok) / stats.total) + "%";
    } else if (now - lastVoice > 400) {
      hist = []; setUI("idle", "—", "שירו…", "", null);
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
    anSpec = ctx.createAnalyser(); anSpec.fftSize = 16384; anSpec.smoothingTimeConstant = 0; spec = new Float32Array(anSpec.frequencyBinCount); src.connect(anSpec);
    chroma = new Float32Array(12); rmsSum = rmsN = 0; baseline = 0.01; hist = []; lastVoice = 0;
    phase = "cal"; calStart = performance.now(); running = true;
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
  $("skip").addEventListener("click", () => { if (phase === "cal") endCalibration(false); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
