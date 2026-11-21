/* tc.js: the TAKE CONTROL section (#s-model), Part 2 of the story (16 Nov 2026, replaces the model deck).
 *
 * The section shows the type, the labels, a short summary and the Launch button (index.html, styled by tactical.css). Behind the
 * type, an iframe runs journey/journey.html?embed=1: the live head on a see-through background, nothing else. The iframe loads only
 * when the section comes within a screen and a half of the window, so the page does not pay for a second 3D view up front.
 *
 *   Launch     → the section is scrolled to the top, html.tc-open makes the iframe fill the window (CSS), the story's own motion is
 *                suspended, the focus moves into the iframe, and the journey is told 'launch' (postMessage, same origin only).
 *   journey ✕  → the journey says 'closed': the page takes back the window, resumes the story and puts the focus back on Launch.
 *   no live 3D → (boot script: K8_BOOT.live3d false) the poster stays, and Launch opens the journey page on its own instead.
 *   off screen → 'pause' while the section is more than half a window away and the journey is closed; 'play' when it comes back.
 *   phone Back → Launch pushes a history entry (same URL); Back pops it and tells the journey 'close', which answers 'closed'.
 *                Closed by its own ✕ instead, the page drops that entry itself (history.back(), its popstate ignored).
 */
(function () {
  'use strict';
  var sec = document.getElementById('s-model'); if (!sec) return;
  var fr = sec.querySelector('.tc-frame'), btn = document.getElementById('tcLaunch'), html = document.documentElement;
  var LABEL = btn.textContent, ready = false, wanted = false, near = true, pushed = false, skipPop = false;
  var live = !!(window.K8_BOOT && window.K8_BOOT.live3d);
  if (!live) { sec.classList.add('tc-nolive'); btn.addEventListener('click', function () { location.href = 'journey/journey.html'; }); return; }   // = standalone()

  function tell(m) { fr.contentWindow.postMessage({ k8journey: m }, location.origin); }
  // same test as tactical.css's phone block: a phone held upright
  function phonePortrait() { return matchMedia('(max-width: 768px) and (orientation: portrait)').matches; }
  function load() { if (!fr.getAttribute('src')) fr.setAttribute('src', fr.getAttribute('data-src')); }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { for (var i = 0; i < es.length; i++) if (es[i].isIntersecting) { load(); io.disconnect(); return; } },
      { rootMargin: '150% 0px' });
    io.observe(sec);
    new IntersectionObserver(function (es) {
      near = es[es.length - 1].isIntersecting;
      if (ready && !html.classList.contains('tc-open')) tell(near ? 'play' : 'pause');
    }, { rootMargin: '50% 0px' }).observe(sec);
  } else load();

  // Fallback: open the journey as its own page (no live 3D, an error here, or the iframe never said 'ready').
  function standalone() { location.href = 'journey/journey.html'; }
  function launch() {
    try {
      // Put the section at the top of the window. A plain scrollTo with smooth scrolling switched off for the call: Safari before 17
      // throws on scrollIntoView({ behavior: 'instant' }), which used to stop the Launch click dead there.
      var sb = html.style.scrollBehavior; html.style.scrollBehavior = 'auto';
      window.scrollTo(0, Math.round(window.scrollY + sec.getBoundingClientRect().top));
      html.style.scrollBehavior = sb;
    } catch (e) { /* not being at the exact top is harmless: the iframe covers the window anyway */ }
    html.classList.add('tc-open');
    if (window.K8Story && window.K8Story.suspend) window.K8Story.suspend();
    fr.removeAttribute('aria-hidden'); fr.tabIndex = 0; fr.focus();
    if (!pushed) { history.pushState({ tcOpen: true }, ''); pushed = true; }
    tell('play'); tell('launch');
  }
  // Scroll progress of the section into view → the journey turns the head to face the reader (0: section top at the window's bottom,
  // 1: section top at the bar, i.e. fully in view). Sent at most once a frame, and only when it changed.
  var sent = -1, queued = false;
  function sendFace() {
    queued = false; if (!ready || html.classList.contains('tc-open')) return;
    var r = sec.getBoundingClientRect(), bar = 64, H = window.innerHeight;
    var p = Math.max(0, Math.min(1, (H - r.top) / (H - bar)));
    if (Math.abs(p - sent) < .004) return; sent = p;
    fr.contentWindow.postMessage({ k8journey: 'face', p: p }, location.origin);
  }
  addEventListener('scroll', function () { if (!queued) { queued = true; requestAnimationFrame(sendFace); } }, { passive: true });
  addEventListener('resize', function () { sent = -1; sendFace(); });

  // other links that open the interactive view (the "Explore it yourself" list, index.html #s-explore3d): same as pressing Launch
  var others = document.querySelectorAll('[data-tc-launch]');
  for (var i = 0; i < others.length; i++) others[i].addEventListener('click', function (e) { e.preventDefault(); btn.click(); });
  btn.addEventListener('click', function () {
    load();
    if (ready) return launch();
    wanted = true; btn.textContent = 'Loading…'; btn.setAttribute('aria-busy', 'true');   // clicked before the journey had loaded
    // never became ready (e.g. the 3D failed inside): open it on its own. A phone gets longer: it loads the 3D over a slower link.
    setTimeout(function () { if (wanted && !ready) standalone(); }, phonePortrait() ? 20000 : 8000);
  });
  addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data) return;
    var m = e.data.k8journey;
    if (m === 'ready') {
      ready = true; sec.classList.add('tc-live'); sent = -1; sendFace();   // tell a freshly loaded journey where the scroll is
      if (!near && !wanted) tell('pause');
      if (wanted) { wanted = false; btn.textContent = LABEL; btn.removeAttribute('aria-busy'); launch(); }
    } else if (m === 'closed') {
      html.classList.remove('tc-open');
      fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1;
      if (window.K8Story && window.K8Story.resume) window.K8Story.resume();
      btn.focus({ preventScroll: true });
      if (pushed) { pushed = false; skipPop = true; history.back(); }   // closed by its own ✕: drop the entry Launch pushed
      if (!near) tell('pause');
    }
  });
  addEventListener('popstate', function () {
    if (skipPop) { skipPop = false; return; }
    if (!pushed) return;
    pushed = false;
    if (html.classList.contains('tc-open')) tell('close');
  });
})();
