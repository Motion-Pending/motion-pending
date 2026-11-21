// viz-data: the Data | Model switch.
//
// Contract (BRIEF.md):
//   document.body.dataset.side is "model" (default) or "data"
//   ?side=data opens on the Data side
//   a "k8:side" CustomEvent fires on window on every change, with detail.side
//
// This file only owns the two tabs and the #dataView container. The Data side itself (dataview.js,
// dataview.css and the generated data/pipeline/examples.js) is loaded the first time it is opened,
// so the Model side pays nothing for it. Nothing here touches WebGL, so the Data side also works on a
// machine where the 3D view cannot start.
(() => {
  'use strict';
  // 13 Nov 2026: the data is the story's own copy (data/pipeline/, final dataset moredata_final.h5, made by tools/make_data_final.py),
  // not the parent's ../data/pipeline (the 1,600-player version, which other pages still read).
  const FILES = { css: 'dataview.css?r=fn1', data: 'data/pipeline/examples.js?r=s1', js: 'dataview.js?r=src1' };
  // 21 Nov 2026 (Nic): the Data side is switched off for now, but kept in the repo. While false there is no Data | Model
  // switch and ?side=data opens the Model side. To bring it back: set true, and restore the two links marked
  // "DATA SIDE OFF" in index.html.
  const DATA_SIDE = false;
  const brand = document.getElementById('brand');
  if (!brand) return;

  const style = document.createElement('style');
  style.textContent = `
    #sideTabs { display:inline-flex; gap:4px; margin-left:12px; pointer-events:auto; vertical-align:middle; }
    #sideTabs button { min-height:28px; padding:0 12px; font-size:12.5px; font-family:var(--sans, "Geist", system-ui, sans-serif); font-weight:400;
      color:var(--body, #a6a6a6); background:var(--btn, #0a0a0a); border:1px solid var(--btn-line, #2c2c2c); border-radius:6px; box-shadow:none; }
    #sideTabs button:hover { color:var(--fg); background:var(--btn-hover, #141414); border-color:var(--btn-hover-line, #6b6b6b); }
    #sideTabs button[aria-pressed="true"] { color:var(--fg); background:var(--on, #1c1c1c); border-color:#6b6b6b; }
    #dataView { position:fixed; inset:0; z-index:40; background:var(--bg); }
    #dataView[hidden] { display:none; }
    body[data-side="data"] #brand { z-index:41; }
    body[data-side="data"] #brand > span { display:none; }
    #toStory { pointer-events:auto; display:inline-flex; align-items:center; gap:6px; margin-right:14px; padding:2px 0; vertical-align:middle;
      font:400 13px/1.4 var(--sans, "Geist", system-ui, sans-serif); color:var(--body, #a6a6a6); text-decoration:none; border-bottom:1px solid transparent; }
    #toStory:hover { color:var(--fg, #eaeaea); border-bottom-color:var(--line-hi, #6b6b6b); }
    #toStory:focus-visible { outline:1px solid #fff; outline-offset:4px; }
    #toStory svg { width:13px; height:13px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
    #dataView .dv-wait { position:absolute; left:16px; top:64px; color:var(--muted); font:400 13.5px/1.5 var(--sans, "Geist", system-ui, sans-serif); }
  `;
  document.head.appendChild(style);

  const tabs = document.createElement('nav');
  tabs.id = 'sideTabs';
  tabs.setAttribute('aria-label', 'Which half of the project to show');
  tabs.innerHTML =
    '<button type="button" data-side="data" aria-pressed="false">Data</button>' +
    '<button type="button" data-side="model" aria-pressed="true">Model</button>';
  if (DATA_SIDE) brand.insertBefore(tabs, brand.querySelector('span'));

  // The way back to the scroll story, on both sides. A real link to the page without its query (the story). If the reader came
  // here from the story in this tab, going back in history is used instead: the browser then restores where they were reading.
  const toStory = document.createElement('a');
  toStory.id = 'toStory';
  toStory.href = location.pathname;
  toStory.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Story';
  toStory.setAttribute('aria-label', 'Back to the story');
  toStory.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    let from = null; try { from = new URL(document.referrer); } catch { /* opened directly */ }
    if (from && from.origin === location.origin && from.pathname === location.pathname && !/[?&](explore=1|side=|lite=1|tier=)/.test(from.search) && history.length > 1) { e.preventDefault(); history.back(); }
  });
  brand.insertBefore(toStory, brand.firstChild);

  const view = document.createElement('div');
  view.id = 'dataView';
  view.hidden = true;
  view.setAttribute('role', 'region');
  view.setAttribute('aria-label', 'The data: BOXRR-23 and our pipeline');
  brand.after(view);

  let side = 'model';
  let loading = null;

  function addScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(src));
      document.head.appendChild(s);
    });
  }

  function load() {
    if (loading) return loading;
    view.innerHTML = '<p class="dv-wait">Loading the data view…</p>';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FILES.css;
    document.head.appendChild(link);
    loading = addScript(FILES.data)
      .then(() => addScript(FILES.js))
      .then(() => window.K8DataView.mount(view))
      .catch(err => {
        const p = document.createElement('p');
        p.className = 'dv-wait';
        p.textContent = 'The data view could not load (' + err.message + ').';
        view.replaceChildren(p);
      });
    return loading;
  }

  // While the Data side is open the Model side's controls sit underneath it. `inert` takes them out of
  // the Tab order and away from screen readers; removing it gives them back.
  function setInert(on) {
    for (const el of document.body.children) {
      if (el === brand || el === view || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      el.inert = on;
    }
  }

  function set(next, opts) {
    next = next === 'data' ? 'data' : 'model';
    if (next === side && !(opts && opts.force)) return;
    side = next;
    document.body.dataset.side = side;
    for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.side === side));
    // If the keyboard focus is about to be hidden with its side, park it on the tab that is now active.
    const lost = document.activeElement && document.activeElement !== document.body && !brand.contains(document.activeElement);
    view.hidden = side !== 'data';
    setInert(side === 'data');
    if (lost) tabs.querySelector('[aria-pressed="true"]').focus();
    try {
      const url = new URL(location.href);
      if (side === 'data') url.searchParams.set('side', 'data');
      else url.searchParams.delete('side');
      history.replaceState(null, '', url);
    } catch { /* file:// pages cannot rewrite the address: the switch still works */ }
    if (side === 'data') load().then(() => window.K8DataView && window.K8DataView.show());
    else if (window.K8DataView) window.K8DataView.hide();
    window.dispatchEvent(new CustomEvent('k8:side', { detail: { side } }));
  }

  tabs.addEventListener('click', e => {
    const b = e.target.closest('button[data-side]');
    if (b) set(b.dataset.side);
  });

  // On the Data side the Model side's shortcuts (N, B, Space, 1-9, ...) must not fire. This listener runs
  // in the capture phase on window, so it is first; it hands the key to the data view and stops it there.
  // Tab, Enter and Space on a focused button still work: those are browser defaults, not listeners.
  window.addEventListener('keydown', e => {
    if (side !== 'data') return;
    e.stopPropagation();
    if (window.K8DataView) window.K8DataView.key(e);
  }, true);

  document.body.dataset.side = 'model';
  window.K8Side = { get: () => side, set };
  if (DATA_SIDE && new URLSearchParams(location.search).get('side') === 'data') set('data');
})();
