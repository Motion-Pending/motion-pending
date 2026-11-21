// viz-phone: phones, small tablets and touch. Classic script, loaded right after side.js and before the 3D module.
//
// What it owns:
//   <html data-form="sheet|column">  which small-screen layout is on (none = the desktop layout). phone.css hangs off it.
//   <html class="touch">             the main pointer is a finger
//   #sheetTabs                       the tab strip of the sheet: Explain | This step | Test user, and a fold button
//   <html data-sheet="card|step|user">, <html data-sheetmin>   which tab shows, and whether the sheet is folded
//   window.K8Phone                   what the 3D module and tour.js ask: the free rectangle for the scene, the camera's
//                                    view offset, how much further back a fixed camera shot must stand, where a tip docks
//
// "Free rectangle" = the part of the screen no panel covers: above the sheet (form "sheet") or right of it (form "column").
(() => {
  'use strict';
  const html = document.documentElement, BOOT = window.K8_BOOT || {};
  const coarse = matchMedia('(pointer: coarse)');
  const $ = id => document.getElementById(id);
  // ticket 06a: the 3D view's viewport (viewer.mjs sets window.K8Viewport): the window, or the story's panel while embedded. Before the
  // module runs, and whenever it is not embedded, it is the window, so every number below is what it was. Inside a story panel there
  // are no viewer panels around the scene, so no small-screen layout applies there (formNow and form give null while embedded).
  const vp = () => window.K8Viewport ? window.K8Viewport() : { left: 0, top: 0, width: innerWidth, height: innerHeight };

  // ---------------------------------------------------------------- which layout
  // 21 Nov 2026: the scroll story (html.story, set by index.html's boot script) has none of the viewer's panels, so nothing here applies
  // to it; viewer.mjs enter() removes the class and calls apply() when the reader opens the 3D model from the story.
  const story = () => html.classList.contains('story');
  function formNow() {
    if (/[?&]nophone=1/.test(location.search)) return null;   // tools/make_pics.mjs: its 800×500 pictures are small desktop views, not the phone layout
    if (window.K8_EMBED || story()) return null;
    const { width: w, height: h } = vp();
    if (h <= 500 && w > h) return 'column';             // a phone on its side
    if (w <= 900) return w > h ? 'column' : 'sheet';    // a small window or tablet: by its shape
    return null;                                        // desktop: nothing changes
  }
  function apply() {
    const f = formNow(), was = html.dataset.form || null, br = $('brand');
    if (br) html.style.setProperty('--brand-w', Math.ceil([...br.children].reduce((m, c) => Math.max(m, c.getBoundingClientRect().right), 0)) + 'px');   // where the brand line ends: the Data side's stage strip starts after it when the phone is on its side
    if (f) html.dataset.form = f; else delete html.dataset.form;
    html.classList.toggle('touch', coarse.matches && !story());
    if (f !== was) { placeData(); placeTools(); syncTabs(); legendSoon(); }
    return f !== was;
  }
  const form = () => window.K8_EMBED ? null : html.dataset.form || null;

  // ---------------------------------------------------------------- the sheet's tab strip
  const tabs = document.createElement('div');
  tabs.id = 'sheetTabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'What the panel shows');
  tabs.innerHTML =
    '<button type="button" role="tab" data-t="card" aria-selected="true">Explain</button>' +
    '<button type="button" role="tab" data-t="step" aria-selected="false">This step</button>' +
    '<button type="button" role="tab" data-t="user" aria-selected="false">Test user</button>' +
    '<button type="button" class="fold" aria-expanded="true" aria-label="Fold the panel away"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>';
  const side = $('side'), card = $('card'), bar = $('bar');
  if (side) side.before(tabs); else document.body.appendChild(tabs);
  // one plain sentence under the user picker, so the tab is not just a lone drop-down
  if ($('userbox')) { const n = document.createElement('p'); n.id = 'sheetUserNote';
    n.textContent = 'Five players: one real recording and four synthetic ones, from calm to very fast head motion. Pick one to run its motion through the model.';
    $('userbox').after(n); }

  let sheet = 'card';
  html.dataset.sheet = sheet;
  const stepHasContent = () => !!(($('inset') && $('inset').classList.contains('show')) || ($('gazeKey') && $('gazeKey').classList.contains('show')));
  function syncTabs() {
    const has = stepHasContent(), stepB = tabs.querySelector('[data-t="step"]');
    stepB.disabled = !has;
    if (!has && sheet === 'step') sheet = 'card';
    html.dataset.sheet = sheet;
    for (const b of tabs.querySelectorAll('[data-t]')) b.setAttribute('aria-selected', String(b.dataset.t === sheet));
    const min = html.hasAttribute('data-sheetmin'), fold = tabs.querySelector('.fold');
    fold.setAttribute('aria-expanded', String(!min));
    fold.setAttribute('aria-label', min ? 'Open the panel' : 'Fold the panel away');
  }
  // The scene's free rectangle changed: the 3D module's own resize routine re-centres the camera for it.
  const relayout = () => { requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); };
  function setMin(on) {
    if (on === html.hasAttribute('data-sheetmin')) return;
    html.toggleAttribute('data-sheetmin', on); syncTabs(); if (form()) relayout();
  }
  function setSheet(t) { sheet = t; syncTabs(); setMin(false); }
  tabs.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.classList.contains('fold')) return setMin(!html.hasAttribute('data-sheetmin'));
    if (b.dataset.t === sheet && !html.hasAttribute('data-sheetmin')) return;
    setSheet(b.dataset.t);
  });
  for (const id of ['inset', 'gazeKey']) if ($(id)) new MutationObserver(syncTabs).observe($(id), { attributes: true, attributeFilter: ['class'] });

  // ---------------------------------------------------------------- words
  // 21 Nov 2026: the explanations were written for the desktop layout and a mouse. On a phone the panels are tabs of the sheet and there is no
  // hover, so viewer.mjs (card, inset) and tour.js (tips) pass their text through words(); the desktop text is untouched. touch: only on a touch screen.
  const WORDS = [
    [/the top-right panel/g, 'the This step tab'],
    [/top-right panel/g, 'This step tab'],
    [/the Key on the right/g, 'the Key in the This step tab'],
    [/\bhover to go back in time\b/g, 'tap or slide to go back in time'],
    [/\bhover a step\b/g, 'tap or slide to pick a step'],
    [/\bClick\b/g, 'Tap'], [/\bclick\b/g, 'tap'],
    [/scroll to zoom/g, '− / + to zoom', 'touch'],
  ];
  const words = s => { if (!s || !form()) return s; for (const [re, to, only] of WORDS) if (!only || html.classList.contains(only)) s = s.replace(re, to); return s; };

  // ---------------------------------------------------------------- geometry for the 3D module
  const rect = el => { if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? r : null; };
  function free() {
    const f = form(); if (!f || document.body.classList.contains('wearing') || document.body.classList.contains('lite')) return null;
    const { width: VW, height: VH } = vp(), m = 8, tr = rect(tabs), br = rect(bar), hud = rect($('guideHud')), min = html.hasAttribute('data-sheetmin');
    if (!tr) return null;
    let L = m, R = VW - m, T = 50, B = (br ? br.top : VH) - m;
    if (f === 'sheet') { B = tr.top - m; if (hud) T = Math.max(T, hud.bottom + 4); }
    else if (min) T = tr.bottom + m;
    else L = tr.right + m;
    if (R - L < 80 || B - T < 60) return null;
    return { L, R, T, B };
  }
  // camera.setViewOffset(fullW, fullH, x, y, w, h): this x, y puts the optical centre in the middle of the free rectangle
  function offset() { const r = free(), v = vp(); return r ? { x: Math.round(v.width / 2 - (r.L + r.R) / 2), y: Math.round(v.height / 2 - (r.T + r.B) / 2) } : null; }
  // Fixed camera shots (the guided tour's, a double-tap on a part) were composed for a desktop window: about 900 px high with
  // 670 x 750 px free. The same shot shows the same piece of the model in a smaller free rectangle if it stands this much further back.
  function distK() { const r = free(); return r ? Math.max(1, vp().height / 900 * Math.max(670 / (r.R - r.L), 750 / (r.B - r.T))) : 1; }

  // ---------------------------------------------------------------- tour tips
  // Called by tour.js when a tip is shown. A tip that points at something inside the sheet or the bar opens the right tab and is
  // docked along the top of the scene (class ptop); a tip that points into the scene is docked over the sheet (phone.css).
  function tip(t, box) {
    const f = form(); if (!box) return false;
    if (!f) { box.classList.remove('ptop'); return false; }
    const el = t && t.dom ? document.querySelector(t.dom.replace(/:not\(\[disabled\]\)/, '')) : null;
    const top = !!(t && t.dom);
    if (el && card && card.contains(el)) setSheet('card');
    else if (el && side && side.contains(el)) setSheet(el.closest('#userbox') ? 'user' : 'step');
    if (el) {                                             // bring it into view inside its own scrolling panel (never scrolls the page)
      const sc = el.closest('#card') || el.closest('#side');
      if (sc) { const er = el.getBoundingClientRect(), sr = sc.getBoundingClientRect(); if (er.top < sr.top || er.bottom > sr.bottom) sc.scrollTop += er.top - sr.top - (sr.height - er.height) / 2; }
    }
    box.classList.toggle('ptop', top);
    if (top) {
      const hud = rect($('guideHud')), tr = rect(tabs), col = f === 'column' && tr && !html.hasAttribute('data-sheetmin');
      const y = f === 'sheet' && hud ? hud.bottom + 6 : 52, l = col ? tr.right + 8 : 8;
      box.style.setProperty('--tip-top', y + 'px'); box.style.setProperty('--tip-l', l + 'px'); box.style.setProperty('--tip-w', (vp().width - l - 8) + 'px');
      const lim = f === 'sheet' && tr ? tr.top - 8 - y : vp().height - y - 8 - (rect(bar) ? rect(bar).height + 16 : 0);
      box.style.setProperty('--tip-h', Math.max(110, lim) + 'px');
    }
    return true;
  }

  // ---------------------------------------------------------------- the Data side
  // On a small screen the caption, the rule and the sources sit with the card in one scrolling column (#dvText), so the
  // picture above them keeps its height. On the desktop they go back under the picture.
  function placeData() {
    const foot = $('dvFoot'), text = $('dvText'), stage = $('dvStage'); if (!foot || !text || !stage) return;
    if (form()) { if (foot.parentElement !== text) text.prepend(foot); }
    else if (foot.parentElement !== stage) stage.appendChild(foot);
  }
  // called by dataview.js after every stage change: words back to the top, the current stage chip in view
  function dataStage() {
    placeData(); if (!form()) return;
    const text = $('dvText'), cur = document.querySelector('#dvFlow button[aria-current="step"]'), flow = $('dvFlow');
    if (text) text.scrollTop = 0;
    if (cur && flow) flow.scrollLeft = cur.parentElement.offsetLeft - flow.offsetLeft - (flow.clientWidth - cur.offsetWidth) / 2;
  }

  // ---------------------------------------------------------------- upright phone: a one-row bar
  // 21 Nov 2026: in form "sheet" the bar keeps Back · step · Next · Play · ⋯ (and One call on a block step); the time slider, Tour and
  // Whole model move to the top of the ⋯ menu, so the bar is one row and the scene gets its height back. Any other form puts them back.
  const menu = $('menu'), keys = $('keysHelp');
  const MOVED = ['guideBtn', 'all', 'scrub', 'readout'].map($).filter(Boolean), HOME = new Map(MOVED.map(el => [el, [el.parentElement, el.nextSibling]]));
  let tools = null;
  function placeTools() {
    if (!menu || !MOVED.length) return;
    if (html.dataset.form === 'sheet') {
      if (!tools) {
        tools = document.createElement('div'); tools.id = 'phoneTools';
        tools.innerHTML = '<div class="pt-row"></div><label class="pt-time"><span>Time</span></label>';
        menu.querySelector('.mh').after(tools);
        tools.addEventListener('click', e => { if (e.target.closest('#guideBtn, #all') && menu.classList.contains('show')) $('more').click(); });   // the tour or the whole model takes the screen: the menu steps aside
      }
      const row = tools.querySelector('.pt-row'), time = tools.querySelector('.pt-time');
      for (const el of MOVED) (el.tagName === 'BUTTON' ? row : time).appendChild(el);
    } else for (const el of MOVED) { const [par, next] = HOME.get(el); if (el.parentElement !== par) par.insertBefore(el, next && next.parentElement === par ? next : null); }
  }

  // ---------------------------------------------------------------- View options: touch help, and what each icon button does
  if (menu && keys) {
    const d = document.createElement('details'); d.className = 'hint'; d.id = 'touchHelp'; d.open = true;
    d.innerHTML = '<summary>Touch</summary><dl>' +
      '<dt>drag with one finger</dt><dd>turn the model</dd><dt>pinch</dt><dd>zoom</dd><dt>drag with two fingers</dt><dd>move the view</dd>' +
      '<dt>tap a name in the scene</dt><dd>open that part</dd><dt>double-tap a part</dt><dd>fly to it</dd>' +
      '<dt>tap or slide on a chart</dt><dd>pick a step</dd></dl><dl id="btnHelp"></dl>';
    keys.before(d);
    const list = d.querySelector('#btnHelp');
    for (const id of ['play', 'guideBtn', 'call', 'all']) {       // the same words the desktop shows as hover tooltips
      const b = $(id), svg = b && b.querySelector('svg'); if (!b || !b.dataset.tip) continue;
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      if (svg) { const c = svg.cloneNode(true); c.setAttribute('width', 16); c.setAttribute('height', 16); c.style.cssText = 'stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:middle'; dt.appendChild(c); }
      dd.textContent = b.dataset.tip.replace(' with W A S D and the mouse', ''); list.append(dt, dd);
    }
  }

  // ---------------------------------------------------------------- stage numbers and their legend
  // phone.css shows a stage's name in the scene as its step number. Here: give every stage label that number, keep a flag for
  // "the whole model is showing", and put a one-row list of number + name at the top of the card while it is.
  const all = $('all');
  function stages() {
    const steps = window.__k8steps || [], out = [];
    for (const el of document.querySelectorAll('#labels .lbl.stage[data-key]')) { const i = steps.indexOf(el.dataset.key); if (i < 0) continue;
      if (!el.dataset.n) { el.dataset.n = i + 1; el.dataset.name = el.textContent; el.setAttribute('aria-label', el.textContent); }
      out.push({ n: i + 1, key: el.dataset.key, name: el.dataset.name, el }); }
    return out.sort((a, b) => a.n - b.n);
  }
  function legend() {
    const whole = !!(all && all.getAttribute('aria-pressed') === 'true');
    html.toggleAttribute('data-whole', whole);
    const bd = card && card.querySelector('.bd'), old = $('stageLegend');
    if (!form() || !whole || !bd) { if (old) old.remove(); return; }
    const list = stages(); if (!list.length) return;
    let nav = old; if (!nav || nav.parentElement !== bd) { if (old) old.remove(); nav = document.createElement('nav'); nav.id = 'stageLegend'; nav.setAttribute('aria-label', 'The parts of the model, by number'); bd.prepend(nav);
      for (const s of list) { const b = document.createElement('button'); b.type = 'button'; b.dataset.key = s.key; const i = document.createElement('i'); i.textContent = s.n; b.append(i, ' ' + s.name.replace(/ 7→32 \+ ReLU$/, '')); nav.appendChild(b); }
      nav.onclick = e => { const b = e.target.closest('button'); const s = b && list.find(x => x.key === b.dataset.key); if (s) s.el.click(); }; }
    for (const b of nav.children) b.setAttribute('aria-pressed', String(list.find(x => x.key === b.dataset.key).el.classList.contains('on')));
  }
  let legendT = 0; const legendSoon = () => { clearTimeout(legendT); legendT = setTimeout(legend, 0); };
  if (card) new MutationObserver(legendSoon).observe(card, { childList: true });
  if (card) new MutationObserver(() => { if (form()) card.scrollTop = 0; }).observe(card, { childList: true });   // phone.css: the whole card scrolls, level switch included; a new card starts at its top
  if (all) new MutationObserver(legendSoon).observe(all, { attributes: true, attributeFilter: ['aria-pressed'] });
  addEventListener('load', legendSoon);

  // ---------------------------------------------------------------- start
  apply(); syncTabs();
  addEventListener('resize', apply);                       // registered before the 3D module's own resize listener, so it sees the new form
  if (coarse.addEventListener) coarse.addEventListener('change', apply);
  // A bar that grows or shrinks (the caption line, the wrapped rows) moves the sheet: re-centre the scene.
  if (bar && window.ResizeObserver) { let h = 0; new ResizeObserver(() => { const n = bar.offsetHeight; if (n !== h) { h = n; if (form()) relayout(); } }).observe(bar); }

  window.K8Phone = { apply, words, form, free, offset, distK, tip, dataStage, setSheet, setMin, sheet: () => sheet, isPhone: !!BOOT.phone };
})();
