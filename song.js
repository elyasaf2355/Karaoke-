(function () {
  const $ = (id) => document.getElementById(id);
  const TOL = 35;        // סנטים
  const WINDOW = 6;      // שניות שמוצגות בגלילה
  const PLAYHEAD = 0.3;  // מיקום קו ההשמעה (חלק מהרוחב)
  const GRACE = 0.15;    // שניות בתחילת צליל שבהן לא סופרים טעויות
  const LAG = 0.08;      // השהיית עיבוד קבועה (שניות)
  const NAMES = NOTE_NAMES_HE;
  const COLORS = { ok: "#2ecc71", high: "#ff6b5e", low: "#4aa3ff", oct: "#f1c40f" };

  const songSel = $("song");
  SONGS.forEach((s, i) => songSel.add(new Option(s.title, i)));

  let song, sec, notes, ctx, stream, analyser, buf, t0, raf = 0, running = false, ending = false;
  let hist = [], trace = [], lastVoice = 0, stats, osc = [], lo, hi, strict;

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function tone(freq, start, dur, type, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.02);
    g.gain.setValueAtTime(gain, start + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, start + dur);
    o.connect(g).connect(ctx.destination);
    o.start(start); o.stop(start + dur + 0.05);
    osc.push(o);
  }

  function setMsg(state, msg, detail) {
    $("display").dataset.state = state;
    $("message").textContent = msg;
    $("detail").textContent = detail || "";
  }

  function noteAt(ts) {
    for (const n of notes) if (ts >= n.start && ts < n.end) return n;
    return null;
  }

  function frame() {
    if (!running) return;
    const now = ctx.currentTime;
    const play = now - t0 - (ctx.outputLatency || 0);
    const ts = now - t0 - LAG - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);

    analyser.getFloatTimeDomainData(buf);
    const r = detectPitch(buf, ctx.sampleRate);
    let midi = null;
    if (r && r.clarity > 0.8) {
      hist.push(freqToMidi(r.freq)); if (hist.length > 5) hist.shift();
      midi = median(hist); lastVoice = now;
    } else if (now - lastVoice > 0.15) hist = [];

    if (ts < 0) {
      setMsg("idle", "מתחילים בעוד " + Math.ceil(-play / sec) + "…", "");
    } else {
      const n = noteAt(ts);
      const scored = n && ts - n.start >= GRACE;
      if (n && midi !== null) {
        const j = judge(midi, n.midi, strict, TOL);
        const name = NAMES[n.midi % 12];
        const detail = "יעד: " + name + " · " + (j.cents > 0 ? "+" : "") + Math.round(j.cents) + " סנט";
        let st;
        if (j.ok) { st = "ok"; setMsg("ok", "מדויק! ✓", detail); }
        else if (strict && j.octave !== 0) {
          st = "oct";
          setMsg("oct", j.octave < 0 ? "אוקטבה נמוכה מדי, עלו אוקטבה ⬆️" : "אוקטבה גבוהה מדי, רדו אוקטבה ⬇️", "יעד: " + name);
        } else if (j.cents > 0) { st = "high"; setMsg("high", "שירו נמוך יותר ⬇️", detail); }
        else { st = "low"; setMsg("low", "שירו גבוה יותר ⬆️", detail); }
        if (!strict && j.octave !== 0 && j.ok) $("detail").textContent += " · באוקטבה " + (j.octave < 0 ? "נמוכה" : "גבוהה") + " (בסדר)";
        if (scored) { stats.total++; stats[st]++; }
        trace.push({ t: ts, m: midi, c: COLORS[st] });
      } else if (n) {
        setMsg("idle", "שירו! הצליל הבא: " + NAMES[n.midi % 12], "");
        if (scored) { stats.total++; stats.silent++; }
      } else {
        setMsg("idle", "הפסקה…", "");
        if (midi !== null) trace.push({ t: ts, m: midi, c: "#888" });
      }
      if (stats.total) $("score").textContent = "ציון עד כה: " + Math.round((100 * stats.ok) / stats.total) + "%";
    }
    while (trace.length && trace[0].t < play - WINDOW) trace.shift();
    draw(play);

    if (play > song.beats * sec + 0.5 && !ending) { finish(); return; }
    raf = requestAnimationFrame(frame);
  }

  function draw(play) {
    const cv = $("roll"), dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#1e1b3f"; g.fillRect(0, 0, W, H);
    const rows = hi - lo + 1, rh = H / rows;
    const y = (m) => H - (m - lo + 1) * rh;
    const x = (t) => W * PLAYHEAD + ((t - play) / WINDOW) * W;
    for (let m = lo; m <= hi; m++) {
      if (m % 12 === 0) { g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(0, y(m), W, 1); g.fillStyle = "#9a95c9"; g.font = "10px sans-serif"; g.fillText("דו" + (m / 12 - 1), 4, y(m) - 2); }
    }
    notes.forEach((n) => {
      const x1 = x(n.start), x2 = x(n.end);
      if (x2 < 0 || x1 > W) return;
      const active = play >= n.start && play < n.end;
      g.fillStyle = active ? "#9b83ff" : "#5b4bb5";
      g.beginPath(); g.roundRect(x1, y(n.midi) + 1, x2 - x1 - 2, rh - 2, 4); g.fill();
    });
    trace.forEach((p) => {
      if (p.m < lo || p.m > hi + 1) return;
      g.fillStyle = p.c; g.beginPath(); g.arc(x(p.t), H - (p.m - lo + 0.5) * rh, 3, 0, 7); g.fill();
    });
    g.fillStyle = "#fff"; g.fillRect(W * PLAYHEAD - 1, 0, 2, H);
  }

  async function start() {
    song = SONGS[+songSel.value]; sec = 60 / song.bpm; strict = $("octave").value === "strict";
    notes = song.melody.map(([b, d, m]) => ({ start: b * sec, end: (b + d) * sec, midi: m }));
    const ms = notes.map((n) => n.midi);
    lo = Math.min(...ms) - 13; hi = Math.max(...ms) + 5; // מציגים גם אוקטבה מתחת לצלילי המנגינה
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      setMsg("idle", "אין גישה למיקרופון", "אשרו שימוש במיקרופון בהגדרות הדפדפן (נדרש HTTPS)"); return;
    }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    analyser = ctx.createAnalyser(); analyser.fftSize = 4096; buf = new Float32Array(4096);
    ctx.createMediaStreamSource(stream).connect(analyser);

    t0 = ctx.currentTime + 0.3 + 4 * sec;
    for (let k = 1; k <= 4; k++) tone(1000, t0 - k * sec, 0.08, "square", 0.12);
    song.chords.forEach(([b, d, ms2]) => ms2.forEach((m) => tone(mtof(m), t0 + b * sec, d * sec, "triangle", 0.05)));
    if ($("guide").checked) notes.forEach((n) => tone(mtof(n.midi), t0 + n.start, n.end - n.start, "sine", 0.12));

    stats = { total: 0, ok: 0, high: 0, low: 0, oct: 0, silent: 0 };
    hist = []; trace = []; lastVoice = 0; running = true; ending = false;
    $("score").textContent = "";
    $("toggle").textContent = "עצירה"; $("toggle").className = "stop";
    frame();
  }

  function cleanup() {
    running = false; cancelAnimationFrame(raf);
    osc.forEach((o) => { try { o.stop(); } catch (e) {} }); osc = [];
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close();
    $("toggle").textContent = "התחלה"; $("toggle").className = "start";
  }

  function finish() {
    ending = true; cleanup();
    const t = stats.total || 1, pct = (k) => Math.round((100 * stats[k]) / t) + "%";
    setMsg(stats.ok / t >= 0.7 ? "ok" : "idle", "סיימתם! ציון: " + pct("ok"),
      "גבוה מדי: " + pct("high") + " · נמוך מדי: " + pct("low") + (strict ? " · אוקטבה שגויה: " + pct("oct") : "") + " · לא שרתם: " + pct("silent"));
    $("score").textContent = strict && stats.oct / t > 0.3 ? "טיפ: שרתם באוקטבה אחרת מהמנגינה. נסו את מצב 'מקילה' אם זו הטווח הטבעי של הקול שלכם." : "";
  }

  $("toggle").addEventListener("click", () => {
    if (running) { cleanup(); setMsg("idle", "לחצו על התחלה", ""); } else start();
  });
  const empty = () => { const cv = $("roll"); cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); };
  empty();
})();
