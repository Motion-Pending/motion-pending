// Round 4: the guided walkthrough. One shot per tip of tour.js (41 since proposal round P1), in build order, then a short summary shot on the overview.
// Each shot: build the step if needed, fly the camera to that tip's preset, then show the bubble (tour.js guide mode) pointing at it.
// A classic script (window.K8GUIDE) so node can load it for the checks; index.html supplies the scene side through `api`.
(function (root) {
  // Camera presets, world coordinates (x = through the network, y = channels with h⁰ above the mirror plane y = 0, z = time, now at 0, past at −z).
  // Every layer is a wall in a y–z plane, 10 units long in time and up to ±2.2 in y, so a camera on the +x side looks straight at the later walls.
  //   'keep'   : keep the camera (DOM-anchored tips: the panel is highlighted instead)
  //   'build'  : the step's own build-view camera (where showBuild flew)
  //   'follow' : the gaze step's over-the-shoulder camera
  //   { dir, dist, ty?, tz?, mem?, keep?, trim? } : look at the anchor's world point from direction `dir` at distance `dist`;
  //     tx / ty / tz = override the target's depth / height / time (ty 0 = on the mirror plane, so both streams show);
  //     mem = b: target the middle of block b's memory box and back off far enough for its whole span (7·dilation steps);
  //     live = clip every wall to its last `live` samples (+ now) for this shot; hide = groups hidden for this shot (never a layer a shown part reads);
  //     lb = connection brightness factor; mix = block whose mixing pick lights one output channel; mixMid = target the mixing-line plane.
  //     (keep / trim, round 4b, still work but no preset uses them: they could leave a memory box or fan whose source wall was hidden.)
  // index.html then shifts the camera sideways so the anchor lands in the middle of the free screen between the card and the inset.
  const TOP = [.45, 1, .3];                     // from above the h⁰ edge, a little downstream (Block 3's memory only)
  const SIDE3 = [-.6, .35, .7];                 // round 7: 3/4 from the input side, a little above: time runs left (past) → right (now), channels up
  const NEAR = [.9, .45, .8];                   // close from the right, as the build view of the readout steps
  const PRESETS = {
    'input.now': { dir: [.75, .3, 1], dist: 3.4 },      // low from the front-right: the headset above stays out of frame
    'input.rows': { dir: [1, .45, .3], dist: 5.5 },
    'input.headset': { dir: [.3, .35, 1], dist: 6.5 },
    'feat.rows': { dir: [.35, .45, 1], dist: 4.6 },
    'feat.fork': { dir: [.8, .3, 1], dist: 3.4 },
    'feat.flip': { dir: [.5, .15, 1], dist: 4, ty: 0 },
    'proj.fan': { dir: [.25, .3, 1], dist: 5 },
    'proj.cells': { dir: [.5, .35, 1], dist: 5 },
    'mirror.top': { dir: [1, .18, .45], dist: 9.5, ty: 0, tz: -3 },   // from the side, far enough for both whole sheets above and below the mirror plane
    'mirror.bottom': { dir: [1, .18, .45], dist: 9.5, ty: 0, tz: -3 },
    'reach.tree': { dir: [-.078, 1, 0], dist: 14, tx: 6, tz: -4.9 },   // the step's top-down view (past left, now right), shifted clear of the inset
    // readout, trajectory, forecast read only the "now" column of what came before: every wall is clipped to now (live: 4 samples),
    // so the layers they read stay in view (and dimmed by focus mode) without 4 s of history behind them
    // round 7: no clipping here (Nic: half the model vanished); the earlier layers stay, dimmed by focus mode; the camera is downstream, so none blocks it
    'head.grid': { dir: [.9, .6, .7], dist: 3 },
    'traj.prior': { dir: NEAR, dist: 3 }, 'traj.corr': { dir: NEAR, dist: 3 }, 'traj.r': { dir: NEAR, dist: 3 },
    'out.pred': { dir: NEAR, dist: 3 }, 'out.truth': { dir: NEAR, dist: 3 }, 'out.err': { dir: NEAR, dist: 3 },
    'out.scored': { dir: [.7, .35, 1], dist: 2.4 },
    'gaze.headset': 'follow', 'gaze.dots': 'follow',
  };
  // Block shots (round 5): every layer stays (the block reads the one before it; focus mode dims the others), but every wall is clipped
  // to its live part (live: the memory span 7·d + 4 samples), and the reach tree and the long links are hidden (hide);
  // connections ×2.5 (lb) on the mixing / skip shots; the mixing shot lights one output channel's 32 solid (A) and 32 dashed (B) lines (mix),
  // all in the compute-lane plane, seen face-on.
  [0, 1, 2].forEach(b => { const fx = { live: 7 * [1, 8, 47][b] + 4, hide: ['tree', 'links'], lb: 2.5, feedKey: ['proj', 'blk0', 'blk1'][b] }; Object.assign(PRESETS, {
    // Block 3's memory is 8 units long: from the input side every earlier layer would sit in front of it, so it keeps the round-5 view from above
    // round 10 (Nic): Blocks 1–2 pulled back to a "you are here" view of the whole block (input wall, memory, taps, lanes, output) instead of a wall close-up
    [`blk${b}.mem`]: b === 2 ? { dir: TOP, dist: 1.3, mem: b, ...fx, lb: 0 } : { dir: SIDE3, dist: 9.5, blockMid: b, ...fx, lb: 0 },
    [`blk${b}.taps`]: b === 2 ? { dir: TOP, dist: 1.3, mem: b, ...fx, lb: 0 } : { dir: SIDE3, dist: 9.5, blockMid: b, ...fx, lb: 0 },   // same view as the memory: all 8 taps across its span
    [`blk${b}.mix`]: { dir: [-.4, .18, 1], dist: 7, mixMid: b, mix: b, ...fx },   // angled from the input side: solid lines within h⁰, dashed through the mirror
    [`blk${b}.skip`]: { dir: SIDE3, dist: 9.5, blockMid: b, ...fx },
    [`blk${b}.ctx`]: { dir: [-1, -.1, .05], dist: 15, ctxMid: b, ...fx, lb: 0 },   // round 13: face-on from the input side, a little below the walls; time runs left → right   // the full block, the tube glowing
  }); });
  const presetOf = t => t.center ? 'keep' : t.dom ? 'keep' : PRESETS[t.at];

  // Numbers in the summary (13 Nov 2026: final model final_k8_combined_v10_s42, runs on Nic's PC only):
  //   4.50° on 1,049 test users: ~/Dev/experiments/abc-testeval-results/test/report.md (PC run, 11 Nov 2026; endpoint mean 4.497899) = paper Table 2
  //   4.1836° on the 20-user benchmark: nic/pc_runs/PC_RUNS.md (group-a-v2-test20, PC run, 13 Nov 2026)
  //   7,555 parameters: PC_RUNS.md; 44,196 bytes: size on disk of Submission/Motion_Pending_headpose/model_fp32.onnx
  //   about 78 µs: bench/results/latency/nic-pc_20261111T220814.json, median_ms 0.07752, 1 thread, AMD Ryzen 7 5800X3D
  const SUMMARY = { center: true, text: 'That is the whole model. Each call reads the two newest poses and turns them into 7 measurements, plus a mirrored copy. '
    + 'Both are mixed into 32 channels. Three blocks, each with its own memory, look back 393 samples (about 3.9 s). Nine dials shape a correction to the momentum guess, '
    + 'which gives 20 future poses; only step 20 (200 ms ahead) is scored. On 1,049 unseen test users its error at 200 ms is 4.50° (4.1836° on the team\'s 20-user benchmark). It has 7,555 parameters (44,196 bytes) and takes about 78 µs median per call on an AMD Ryzen 7 5800X3D desktop CPU (relative only).' };

  // the flat shot list: every tip of every step, in build order, then the summary
  function shotsFrom(TIPS, STEPS) {
    const out = [];
    STEPS.forEach((k, si) => (TIPS[k] || []).forEach((t, i) => out.push({ k, si, i, t, preset: presetOf(t) })));
    out.push({ k: 'overview', si: -1, i: 0, t: SUMMARY, preset: 'keep', end: true });
    return out;
  }
  // auto-play reading time at 1×: 60 ms a character + 2 s, at least 6 s; the HUD's speed (0.5× … 2×) divides it
  const SPEEDS = [.25, 3];                       // round 7: a continuous slider between these
  const readMs = (text, speed = 1) => Math.max(6000, 2000 + text.length * 60) / speed;

  const CSS = `
#guideHud { position:fixed; top:52px; left:50%; transform:translateX(-50%); z-index:31; display:flex; align-items:center; gap:10px; padding:6px 8px 8px 12px;   /* theme: 2 px tighter, so Geist's wider type keeps the bar as wide as before */
 
  background:var(--panel-solid, rgba(10,10,10,.95)); border:1px solid var(--line, #2c2c2c); border-radius:var(--r-lg, 10px); font:500 13px var(--sans, system-ui, sans-serif); color:var(--body, #a6a6a6); overflow:hidden; max-width:calc(100% - 32px); }
#guideHud[hidden] { display:none; }
#guideHud .gt { font-weight:500; color:var(--fg, #eaeaea); white-space:nowrap; } #guideHud .gp { font:400 12px var(--mono, ui-monospace, monospace); font-variant-numeric:tabular-nums; color:var(--muted, #808080); white-space:nowrap; }
#guideHud button { min-height:32px; padding:0 9px; font-size:12px; border-radius:var(--r-md, 6px); }
#guideHud button[aria-pressed="true"] { background:var(--on, #1c1c1c); border-color:var(--line-hi, #6b6b6b); } #guideHud button[hidden] { display:none; }
#guideHud .gsl { display:flex; align-items:center; gap:5px; color:var(--muted, #808080); white-space:nowrap; } #guideHud .gs { width:96px; accent-color:#6fa8ff; }
#guideHud .gsv { font:400 12px var(--mono, ui-monospace, monospace); font-variant-numeric:tabular-nums; color:var(--fg, #eaeaea); min-width:38px; }
#guideHud .gr { background:transparent; border-color:#f0b24a; color:#ffe2a6; }
#guideHud .gb { position:absolute; left:0; bottom:0; height:2px; background:#6fa8ff; transition:width .3s ease; }
#guideBtn[aria-pressed="true"] { background:var(--on, #1c1c1c); border-color:#9b8cff; }   /* round 8: violet only while the tour is on (theme: as an outline, not a fill) */
.gHL { outline:2px solid #f0b24a !important; outline-offset:2px; border-radius:var(--r-md, 6px); }
@media (prefers-reduced-motion: reduce) { #guideHud .gb { transition:none; } }
@media (max-width: 700px) { #guideHud .gt { display:none; } }`;

  function create(api) {
    const doc = document, reduce = !!api.reduce, TIPS = api.tips, STEPS = api.steps, SHOTS = shotsFrom(TIPS, STEPS);
    const N = SHOTS.length - 1;                 // tip shots (41); the summary comes after them
    const st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
    const hud = doc.createElement('div'); hud.id = 'guideHud'; hud.hidden = true; hud.setAttribute('role', 'region'); hud.setAttribute('aria-label', 'Guided tour');
    hud.innerHTML = '<span class="gt">Guided tour</span><span class="gp" aria-live="polite"></span>'
      + '<button class="ga" type="button" aria-keyshortcuts="A" title="advance by itself after a reading time (A)">Auto-play</button>'
      + '<label class="gsl" title="auto-play speed: reading time ÷ speed (+ / − keys)">speed <input class="gs" type="range" min="0.25" max="3" step="0.05" value="1" aria-label="Auto-play speed"> <span class="gsv">1.0×</span></label>'
      + '<button class="gr" type="button" aria-keyshortcuts="R" title="re-frame this shot and carry on (R)" hidden>⟲ Resume</button>'
      + '<button class="gx" type="button" aria-keyshortcuts="Escape" title="exit the tour, stay on this step (Esc)">Exit ✕</button><span class="gb"></span>';
    doc.body.appendChild(hud);
    const speedB = hud.querySelector('.gs'), speedV = hud.querySelector('.gsv');
    let speed = 1; try { const v = +localStorage.getItem('k8guideSpeed'); if (v >= SPEEDS[0] && v <= SPEEDS[1]) speed = v; } catch { /* storage off: 1× */ }
    const prog = hud.querySelector('.gp'), autoB = hud.querySelector('.ga'), resB = hud.querySelector('.gr'), bar = hud.querySelector('.gb');

    let on = false, n = 0, auto = !reduce, paused = false, hover = false, waiting = false, shownT = 0, readT = 0, inner = 0, hl = null, last = 0;
    const self = () => inner > 0;               // a build / home change the guide made itself (not the user's picker, keys or bar)
    const asSelf = f => { inner++; try { return f(); } finally { inner--; } };

    function setHL(sel) {
      if (hl) hl.classList.remove('gHL'); hl = null;
      const el = sel && doc.querySelector(sel); if (el) { el.classList.add('gHL'); hl = el; }
    }
    function hudUI() {
      const s = SHOTS[n];
      const ph = window.K8Phone && window.K8Phone.form();   // a phone's short line: the numbers first, the rest may be cut (phone.css)
      prog.textContent = s.end ? `summary · whole model` : `${ph ? '' : 'tip '}${n + 1}${ph ? '/' : ' / '}${N} · ${api.stepName(s.k)}${paused ? ' · paused' : ''}`;
      bar.style.width = `${(Math.min(n + 1, N) / N) * 100}%`;
      autoB.setAttribute('aria-pressed', auto); autoB.textContent = 'Auto-play';   // round 8: fixed label; the state is aria-pressed + "paused" in the progress text
      resB.hidden = !paused; speedB.value = String(speed); speedV.textContent = `${speed.toFixed(speed < 1 ? 2 : 1)}×`;
    }
    function setSpeed(d, v) {          // d = ±1 → ±0.25 (keys), or v = an exact value (the slider)
      speed = Math.round(Math.max(SPEEDS[0], Math.min(SPEEDS[1], v !== undefined ? v : speed + d * .25)) * 100) / 100;
      try { localStorage.setItem('k8guideSpeed', String(speed)); } catch { /* not kept */ } hudUI();
    }
    const extraOf = s => api.level() === 'expert' ? api.expert(s.k) || '' : '';
    function bubble(hidden) {
      const s = SHOTS[n];
      api.tour.guide({ t: s.t, extra: extraOf(s), label: s.end ? 'summary' : `${n + 1}/${N}`, first: n === 0, last: !!s.end, hidden,
        onNext: next, onBack: back });
    }
    // camera for the current shot (also used by Resume)
    function frameCam() {
      const s = SHOTS[n], pr = s.preset;
      if (s.end || pr === 'keep') return;
      if (pr === 'follow' || pr === 'build') api.stage(null);
      if (pr === 'follow') return api.follow();
      const v = api.view(s.t.at, pr); if (!v) return;
      if (pr !== 'build') api.stage(s.t.at, pr, v.t0 || v.t);   // hide what would stand in the way (restored on the next shot / exit)
      api.fly(v.p, v.t);
    }
    // the mirror step's swap is the point of the step: it plays once when its "press this" shot is shown, and is undone on the shots before it.
    // The reach tree grows when its step is entered (showBuild); One call is only offered (the tips say "press").
    function triggers(s) {
      if (s.k === 'mirror') api.swap(s.i >= 2);
    }
    function go(m) {
      m = Math.max(0, Math.min(SHOTS.length - 1, m));
      n = m; const s = SHOTS[n]; paused = false; hover = false; readT = 0;
      setHL(null);
      asSelf(() => {
        if (s.end) { if (api.build() !== -1) api.home(); }
        else if (api.build() !== s.si) api.showBuild(s.si);
      });
      api.fx(s); triggers(s); frameCam();
      if (s.t.dom) setHL(s.t.dom.replace(/:not\([^)]*\)/g, ''));
      waiting = true; bubble(true); hudUI(); api.render();
      tick(performance.now());                 // reduced motion: no flight, the bubble shows at once
    }
    function next() { if (!on) return; if (n >= SHOTS.length - 1) return exit(); go(n + 1); }
    function back() { if (!on || n === 0) return; go(n - 1); }
    function start(from = 0) {
      if (on) return go(from);
      on = true; api.tour.close(); hud.hidden = false; api.started(true); go(from);
    }
    function exit() {
      if (!on) return; on = false; waiting = false; paused = false;
      api.tour.guide(null); setHL(null); api.stage(null); api.fx(null); hud.hidden = true; api.started(false); api.render();
    }
    function resume() { if (!on) return; paused = false; readT = 0; frameCam(); hudUI(); }
    function toggleAuto() { auto = !auto; paused = false; readT = 0; hudUI(); }

    // called by the page's loop every frame (DOM only, cheap): show the bubble once the flight has landed, run the auto-play clock
    function tick(now) {
      const dt = Math.min(250, now - (last || now)); last = now;
      if (!on) return;
      if (waiting && !api.flying()) { waiting = false; shownT = now; bubble(false); }
      if (waiting || !auto || paused || hover) return;
      const s = SHOTS[n]; if (s.end) return;             // the summary stays until Finish / Esc
      readT += dt;
      if (readT >= readMs(s.t.text + extraOf(s), speed)) next();
    }

    // the user took the camera (drag, zoom, pan): auto-play pauses, the guide stays; Resume re-frames
    function userCamera() { if (!on || paused) return; paused = true; hudUI(); }
    // a build step was shown by the user (bar, picker, 1–9, a toggle that redraws): carry on from that step's first shot
    function onBuild(i) {
      if (!on || self()) return;
      if (SHOTS[n].si === i) { triggers(SHOTS[n]); frameCam(); return; }     // the same step was redrawn: keep the shot
      go(SHOTS.findIndex(s => s.si === i));
    }
    function onHome() { if (on && !self()) exit(); }
    function jumpStep(d) {                       // bar ◀ / ▶ while guiding: first shot of the previous / next step
      const si = SHOTS[n].end ? STEPS.length : SHOTS[n].si, to = si + d;
      if (to < 0) return; if (to >= STEPS.length) return go(SHOTS.length - 1);
      go(SHOTS.findIndex(s => s.si === to));
    }
    function refresh() { if (on && !waiting) bubble(false); }   // the explanation level changed: redraw (the expert line)

    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      const k = e.key;
      if (k === 'g' || k === 'G') { on ? exit() : start(0); return true; }
      if (!on) return false;
      if (k === 'Escape') { exit(); return true; }
      if (k === 'n' || k === 'Enter' || k === 't' || k === 'T' || k === 'PageDown') { next(); return true; }
      if (k === 'b' || k === 'PageUp') { back(); return true; }
      if (k === 'a' || k === 'A') { toggleAuto(); return true; }
      if (k === 'r' || k === 'R') { if (paused) resume(); return true; }
      if (k === '+' || k === '=') { setSpeed(1); return true; }
      if (k === '-' || k === '_') { setSpeed(-1); return true; }
      return false;
    }

    autoB.onclick = toggleAuto; speedB.oninput = () => setSpeed(0, +speedB.value);
    speedB.addEventListener('keydown', e => e.stopPropagation());   // arrow keys move the slider, not the page
    resB.onclick = resume; hud.querySelector('.gx').onclick = exit;   // round 8 (a11y F5): these were swallowed by the comment above in round 7
    for (const el of [hud]) el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
    const tb = doc.getElementById('tour');
    if (tb) { tb.addEventListener('pointerenter', () => { hover = true; }); tb.addEventListener('pointerleave', () => { hover = false; }); }

    return { start, exit, next, back, go, tick, onKey, userCamera, onBuild, onHome, jumpStep, refresh, resume, reframe: frameCam,   // round 9: reframe after a resize
      on: () => on, shot: () => n, SHOTS, state: () => ({ on, n, auto, paused, waiting, hover, speed }) };
  }

  root.K8GUIDE = { PRESETS, SUMMARY, SPEEDS, presetOf, shotsFrom, readMs, create };
})(typeof window !== 'undefined' ? window : globalThis);
