/* Story site: the decks. Three pinned stacks the reader scrolls through: the task and the data, the model, the results.
 *
 * The page structure (index.html), once per deck:
 *   <div class="dk-track" data-deck="task">       tall: its extra height is the deck's "scroll budget"
 *     <div class="dk-stage">                      position:sticky, so it stays on screen while the track scrolls past
 *       <ol class="dk-rail"> phase names </ol>
 *       <div class="dk-space" id="taskStage">     the deck's open stage: the free area beside the text, where a live module draws
 *       <section class="dk-step" data-key data-slot data-phase data-side> text + one card </section>   × N
 *
 * Steps and slots. A step is one text with the card it is read against. A slot is one place in the stack: usually a step has a
 * slot of its own, but consecutive steps with the same data-slot share one (the model deck: nine steps, one slot). The card of a
 * shared slot (a "held" card) is the first step's card; it stays in front for all its steps while the text beside it changes,
 * and the later steps of the slot show no card of their own (in motion mode only; the plain article still shows every picture).
 *
 * What this file does, once per frame while the reader scrolls, for every deck:
 *   1. measure how far the track has scrolled and turn it into a position in steps: s = 3.4 is 40% of the way from step 3 to 4
 *   2. turn that into a position in slots, σ (sigma): while two neighbouring steps share a slot, σ stays put
 *   3. place every slot's card from its distance to σ: d = j − σ
 *        d =  0    the current card: in front, fully shown
 *        d <  0    a card already passed: pushed back along the depth axis, its content dimmed to glass
 *        0<d<1     the next card, arriving from the front and fading in
 *        d >= 1    not shown yet
 *   4. mark the step nearest to s as current (.is-cur): story.css shows only that step's text, and the rail lights its phase.
 *      The current step holds on a little past the half-way point (STICK, Deck.curAt), so it cannot flip back and forth there
 *   5. sides (SPEC H1): data-side is the side a step's TEXT is on. Between two steps whose sides differ, --flip on the track runs
 *      0 → 1 (text right → text left) and story.css moves the text column, the cards and the stage element across with it. The
 *      text fades out before the free area starts to move and back in after it has arrived (--ta), so text never overlaps it.
 *   6. a live stage (spec/CONTRACTS.md section 3), if one is registered for the deck, is told its state and the position.
 * Everything is a function of s, nothing runs on a timer, so scrolling back up plays it all in reverse.
 * Per-deck settings are attributes on the track: data-end="close" closes the stack up on the last slot (only the last card is
 * left, facing the reader); data-grow="1.06" straightens the last card and scales it up over the deck's last step;
 * data-layers="open" (the results, SPEC G6) turns the stack only slightly and stands the passed sheets up and to the side, so
 * the front sheet faces the reader nearly flat and the ones behind show as outlines.
 *
 * Native scrolling is never touched: the scroll listener is passive and only reads the position. Wherever the story sets a scroll
 * position itself (chapter links, an address ending in a step's id) it jumps there instantly, never smoothly.
 * Motion is on (html.st-motion) only when the reader has not asked for reduced motion and the window is laptop-sized or larger.
 * Without that class this file writes nothing and the steps read as a plain article, one under the other.
 *
 * Public API (spec/CONTRACTS.md section 2): window.K8Story.state(), .stepY(key), .go(key), .addLive(deck, stage), .suspend(),
 * .resume(), and the event 'k8:story-step' on window with detail { deck, i, key, slot } on every change of current step.
 */
(function () {
  'use strict';
  if (!window.K8_STORY) return;                                   // the viewer (?explore=1) does not use this file
  var html = document.documentElement;
  // Back from the viewer leaves a marker in sessionStorage (viewer.mjs toStory) so the focus can go back to the button the reader left by.
  // It is read and cleared here, at load, because this file loads in every case (model_panel.js, which restores the focus, does not load
  // with reduced motion or without WebGL); the answer is passed on as K8Story.returned.
  var returned = false;
  try { returned = sessionStorage.getItem('k8StoryReturn') === '1'; sessionStorage.removeItem('k8StoryReturn'); } catch (e) { /* no storage: no restore */ }
  var wants = window.matchMedia('(prefers-reduced-motion: no-preference) and (min-width: 1000px) and (min-height: 600px)');

  // ---- tuning constants (kept together; the look ticket tunes them by eye)
  var STEP_SVH = 160;           // scroll length of one step, in % of the window height
  var GLIDE = .5;               // seconds: the shown position follows the scroll position with this time constant, so a wheel
                                //   notch or a flick becomes one smooth move instead of a jump
  var MAX_RATE = 1;             // steps per second: the fastest the shown position moves while it is within one step of the scroll
                                //   position (further behind, it speeds up in proportion so it always catches up)
  var HOLD = .35;               // extra scroll, in steps, that the last step stays pinned before the deck lets go
  var STICK = .04;              // steps: a step that is current stays current until the position is this far PAST the half-way point
                                //   to its neighbour (see Deck.curAt), so resting on the half-way point cannot flip it back and forth
  var TILT_Y = 24, TILT_X = 5;  // how far the stack is turned (degrees) once it has fanned out
  var BACK = 120, FRONT = 260;  // depth between neighbouring cards behind the current one, and how far in front the next one starts (px)
  var OPEN = { tiltY: 5, tiltX: 2, offX: .07, offY: .06 };   // data-layers="open": a turn of 6° or less (SPEC G6); each passed sheet
                                //   stands 7% of a sheet's width further to the outer side and 6% higher, so its outline shows
  var FLIP = [.3, .7];          // the part of a step's scroll over which a side flip moves the free area across
  var TEXT_OUT = [.05, .3], TEXT_IN = [.7, .95];   // ... the old text fades out before it, the new text in after it
  var FADE_MS = 300;            // the held model card's cross-fade between pictures
  // The step gate (Nic, 10 Nov: one scroll gesture must not skip a step; see gateInput). OFF by default since 13 Nov: while a trackpad
  // gesture (and its momentum) kept scrolling the page on, the gate put the scroll position back by code on every scroll event, so
  // the page went back and forth at every step for up to GATE_DWELL (measured: notes/fable-jitter.md). ?gate=1 switches it on again,
  // to compare.
  var GATE = /[?&]gate=1(&|#|$)/.test(location.search);
  // The carry out of a deck's end (see restSettle) is a separate thing: it acts only after scrolling has come to rest. It stays on;
  // ?gate=0 switches it off (the checks, which wheel through the page without pauses).
  var CARRY = !/[?&]gate=0(&|#|$)/.test(location.search);
  var GATE_REST = 180;          // ms without wheel input that end a gesture
  var GATE_DWELL = 900;         // ms a gesture is held at a step before it may go on to the next (so steady scrolling never sticks)
  // ?r=f2 (13 Nov 2026): a version tag. A browser keeps a saved copy of a file under its address, so a file that changes must get
  // a new address or the old copy is shown (Safari showed the 1,600-player split after the files had changed). Change the tag
  // here, in stage_task.js (scene_task.js, hero/clip.js) and in model_panel.js (viewer.mjs) whenever one of those files changes.
  var MODULES = { task: 'stage_task.js?r=q1', model: 'model_panel.js?r=f2' };   // each deck's live module (CONTRACTS sections 1 and 3)

  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var range = function (v, a, b) { return clamp((v - a) / (b - a)); };   // where v is between a and b, as 0..1
  var ease = function (t) { return t < .5 ? 2 * t * t : 1 - (2 - 2 * t) * (1 - t); };   // slow start, slow end

  var decks = [], byKey = {}, byName = {}, on = false, suspended = false, queued = false;

  // A live stage is someone else's code: if one of its calls throws, the deck keeps working and the error is thrown again on its
  // own (so it still shows in the console and fails the checks) instead of stopping this frame's work for every deck.
  function call(p, name, args) {
    if (!p || typeof p[name] !== 'function') return;
    try { p[name].apply(p, args || []); } catch (e) { setTimeout(function () { throw e; }); }
  }

  // ---------------------------------------------------------------- one deck
  function Deck(track) {
    var d = this;
    d.track = track; d.name = track.dataset.deck;
    d.stage = track.querySelector('.dk-stage');
    d.space = d.stage ? d.stage.querySelector(':scope > .dk-space') : null;   // the deck's open stage element, if it has one
    d.rail = Array.prototype.slice.call(track.querySelectorAll('.dk-rail [data-phase]'));
    d.steps = Array.prototype.slice.call(track.querySelectorAll('.dk-step'));
    d.N = d.steps.length;
    d.keys = d.steps.map(function (st) { return st.dataset.key; });
    d.sides = d.steps.map(function (st) { return st.dataset.side === 'left' ? 1 : 0; });   // 1 = text on the left
    d.closes = track.dataset.end === 'close';
    d.grow = parseFloat(track.dataset.grow) || 1;
    d.open = track.dataset.layers === 'open';
    // slots: slotOf[i] = index of step i's slot; panels[j] = the card of slot j (its first step's card)
    d.slotOf = []; d.slotNames = []; d.panels = [];
    d.steps.forEach(function (st, i) {
      var name = st.dataset.slot || st.dataset.key;
      var first = i === 0 || name !== d.steps[i - 1].dataset.slot;
      if (first) { d.slotNames.push(name); d.panels.push(st.querySelector('.dk-panel')); }
      d.slotOf.push(d.slotNames.length - 1);
      st.classList.toggle('dk-follow', !first);                  // story.css hides a follower's own card in motion mode
      var img = st.querySelector('.dk-panel img'), tag = st.querySelector('.dk-panel .pn-tag');
      st._pic = img ? { src: img.getAttribute('src'), alt: img.getAttribute('alt') } : null;   // each step's own picture, for a held card
      st._tag = tag ? tag.textContent : '';
      byKey[st.dataset.key] = { deck: d, i: i };
      if (st.id) byKey['#' + st.id] = byKey[st.dataset.key];
    });
    d.M = d.panels.length;
    d.s = -1; d.cur = -1; d.pw = 0;
    d.size = null;                                                // cached sizes that change only on a resize (see sizes)
    d.live = null; d.lstate = null; d.lpos = ''; d.lview = null;   // the registered live stage and what it was last told
  }

  // Position in slots from position in steps. Neighbouring slots differ by 0 or 1, so between two steps σ either stays (shared
  // slot) or moves at the same rate as s.
  Deck.prototype.sigma = function (s) {
    var i = Math.floor(s), f = s - i;
    if (i >= this.N - 1) return this.slotOf[this.N - 1];
    return this.slotOf[i] + (this.slotOf[i + 1] - this.slotOf[i]) * f;
  };

  // The side flip at position s: flip 0 = text right, 1 = text left; ta = how visible the text is (1 except during a flip).
  Deck.prototype.sideAt = function (s) {
    var i = Math.min(this.N - 1, Math.floor(s)), f = s - i, a = this.sides[i], b = this.sides[Math.min(this.N - 1, i + 1)];
    if (a === b) return { flip: a, ta: 1 };
    return { flip: a + (b - a) * ease(range(f, FLIP[0], FLIP[1])), ta: f < .5 ? 1 - range(f, TEXT_OUT[0], TEXT_OUT[1]) : range(f, TEXT_IN[0], TEXT_IN[1]) };
  };

  Deck.prototype.place = function (s) {
    var d = this, M = d.M, N = d.N, sg = d.sigma(s), side = d.sideAt(s);
    d.track.style.setProperty('--flip', side.flip.toFixed(4));
    d.track.style.setProperty('--ta', side.ta.toFixed(3));
    var mirror = 1 - 2 * side.flip;                               // the stack fans out to the side away from the text: left, or right
    var tY = d.open ? OPEN.tiltY : TILT_Y, tX = d.open ? OPEN.tiltX : TILT_X;
    var end = d.closes && M > 1 ? ease(range(sg, M - 2, M - 1)) : 0;   // 0..1 over the last slot: the stack closes up and faces the reader
    var grow = d.grow > 1 && N > 1 ? ease(range(s, N - 2, N - 1)) : 0;   // 0..1 over the last step, where the deck asks for growth
    var tilt = ease(range(sg, .1, 1)) * (1 - end) * (1 - grow);   // flat on the first screen, fanned out from slot 1, flat again at the end
    for (var j = 0; j < M; j++) {
      var el = d.panels[j], dist = j - sg;
      if (!el) continue;
      if (dist >= 1 || dist <= -4.5) { if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'; continue; }
      var z = dist <= 0 ? dist * BACK : dist * FRONT;
      var show = dist > 0 ? range(dist, .6, 0) : dist > -3 ? 1 : 1 - (-3 - dist) / 1.5;   // fade in over the last 60% of the approach; the oldest fade out at the back
      if (j < M - 1) show *= 1 - end;                             // at the very end only the last card is left
      var glass = dist >= 0 ? 1 : Math.max(.12, 1 + .6 * dist);   // 1 = full content, towards 0 = an outline with a faint picture
      if (dist < 0 && dist > -1.5 && el.dataset.keep) glass = Math.max(glass, +el.dataset.keep);   // a card the next one is read against stays clear for one step
      var scale = j === M - 1 ? (1 + .05 * end) * (1 + (d.grow - 1) * grow) : 1;
      // open layers: a passed sheet also stands to the outer side and higher (a plain move on screen, before the turn)
      var shift = d.open && dist < 0 ? 'translate3d(' + (dist * OPEN.offX * d.pw * mirror).toFixed(1) + 'px,' + (dist * OPEN.offY * d.pw).toFixed(1) + 'px,0) ' : '';
      el.style.visibility = 'visible';
      el.style.opacity = show.toFixed(3);
      el.style.transform = shift + 'rotateY(' + (tY * tilt * mirror).toFixed(2) + 'deg) rotateX(' + (tX * tilt).toFixed(2) + 'deg) translateZ(' + z.toFixed(1) + 'px) scale(' + scale.toFixed(3) + ')';
      el.style.setProperty('--k', glass.toFixed(3));
      el.style.setProperty('--u', range(-dist, -.5, -.05).toFixed(3));   // 0..1 while the card comes to the front: drawings inside use it
    }
    var c = d.curAt(s);
    if (c !== d.cur) d.setCur(c);
  };

  // Which step is current at position p. The nearest one, with a little hold (STICK, "hysteresis"): the step that is current now
  // stays current until p is more than half a step + STICK away from it. Going down, step 3 hands over to step 4 at 3.54, going up
  // step 4 hands back at 3.46, so there is no single position where a pixel of finger movement flips the current step (before,
  // resting at 3.5 flipped it on every wobble, and with it the text, the rail and the 3D view). A position further away gives the
  // step that would be current after moving there from here: the first one, in the direction of travel, that p is within reach of.
  Deck.prototype.curAt = function (p) {
    var c = this.cur, last = this.N - 1, reach = .5 + STICK;
    if (c < 0) return Math.min(last, Math.max(0, Math.round(p)));   // nothing is current yet: the nearest
    if (p > c + reach) return Math.min(last, Math.ceil(p - reach));
    if (p < c - reach) return Math.max(0, Math.floor(p + reach));
    return c;
  };

  Deck.prototype.setCur = function (c) {
    var d = this, prev = d.cur, st = d.steps[c];
    if (prev >= 0) d.steps[prev].classList.remove('is-cur');
    st.classList.add('is-cur'); d.cur = c;
    var phase = st.dataset.phase || '';
    d.track.dataset.phase = phase;
    d.track.dataset.side = st.dataset.side || 'right';            // the current step's text side (CONTRACTS section 4)
    d.rail.forEach(function (li) { li.classList.toggle('is-on', li.dataset.phase === phase); });
    d.showPic(c, prev >= 0 && d.slotOf[prev] === d.slotOf[c]);   // a held card shows this step's picture (cross-faded when moving within the slot)
    d.view();
    window.dispatchEvent(new CustomEvent('k8:story-step', { detail: { deck: d.name, i: c, key: st.dataset.key, slot: st.dataset.slot || st.dataset.key } }));
  };

  // The held card shows the current step's picture. The card's own <img> gets the new src; a copy of the old picture is laid
  // over it and faded out (Web Animations API), so the two cross-fade. A step whose slot is not shared shows its own picture, so
  // only held cards change here.
  Deck.prototype.showPic = function (c, fade) {
    var d = this, el = d.panels[d.slotOf[c]], st = d.steps[c];
    if (!el || !st._pic) return;
    var img = el.querySelector('img'), tag = el.querySelector('.pn-tag');
    if (!img || img.getAttribute('src') === st._pic.src) return;
    if (fade && img.animate) {
      if (d._ghost) d._ghost.remove();
      var g = img.cloneNode(false); g.removeAttribute('id'); g.alt = ''; g.setAttribute('aria-hidden', 'true'); g.className = 'pn-xfade';
      img.parentNode.appendChild(g); d._ghost = g;
      g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-out' }).onfinish = function () { g.remove(); if (d._ghost === g) d._ghost = null; };
    }
    img.setAttribute('src', st._pic.src); img.setAttribute('alt', st._pic.alt || '');
    if (tag) tag.textContent = st._tag;
  };

  // Back to the plain article: no inline styles, every held card back to its first step's picture.
  Deck.prototype.reset = function () {
    var d = this;
    d.steps.forEach(function (st) { st.classList.remove('is-cur'); });
    d.panels.forEach(function (el) { if (el) el.removeAttribute('style'); });
    d.rail.forEach(function (li) { li.classList.remove('is-on'); });
    delete d.track.dataset.phase; delete d.track.dataset.side;
    d.track.style.removeProperty('--flip'); d.track.style.removeProperty('--ta');
    if (d._ghost) { d._ghost.remove(); d._ghost = null; }
    for (var j = 0; j < d.N; j++) if (!d.steps[j].classList.contains('dk-follow')) d.showPic(j, false);   // first step of each slot
    d.cur = -1; d.s = -1;
  };

  // Scroll geometry. budget = how far the track scrolls while its stage is pinned = (N − 1 + HOLD) steps.
  // The stage's height, where it sticks and a sheet's width change only when the window (or motion mode) changes, so they are read once
  // then (sizes, cleared by resetSizes) and only the track's position is read every frame.
  Deck.prototype.sizes = function () {
    if (!this.size) {
      this.size = { sh: this.stage.offsetHeight, pinTop: parseFloat(getComputedStyle(this.stage).top) || 0 };   // pinTop: where the stage sticks (below the top bar)
      if (this.open && this.panels[0]) this.pw = this.panels[0].offsetWidth;   // a sheet's width, for the open layers' offsets (ignores transforms)
    }
    return this.size;
  };
  Deck.prototype.geom = function () {
    var z = this.sizes(), r = this.track.getBoundingClientRect(), budget = r.height - z.sh;
    return { top: r.top, bottom: r.bottom, sh: z.sh, H: window.innerHeight, pinTop: z.pinTop, stepPx: budget > 0 ? budget / (this.N - 1 + HOLD) : 0 };
  };
  // apply(g): everything that writes, from geometry already read.
  // dt = seconds since the last measurement. The shown position s glides towards the scroll position t (GLIDE, MAX_RATE); it goes
  // there at once when dt is null (a jump: K8Story.go, a chapter link), on the first measurement and while the deck is off screen.
  Deck.prototype.apply = function (g, dt) {
    var t = g.stepPx > 0 ? Math.min(this.N - 1, Math.max(0, (g.pinTop - g.top) / g.stepPx)) : 0, s = this.s;
    if (dt === null || s < 0 || g.bottom <= 0 || g.top >= g.H) s = t;
    else if (s !== t) {
      var diff = t - s, a = Math.abs(diff);
      var step = Math.min(a * (1 - Math.exp(-dt / GLIDE)), MAX_RATE * Math.max(1, a) * dt);
      s = a - step < .001 ? t : s + (diff > 0 ? step : -step);
    }
    this.t = t; this.moving = s !== t;
    if (s !== this.s) { this.s = s; this.place(s); }
    this.view();
    this.feed(g);
  };
  Deck.prototype.measure = function () { this.apply(this.geom(), 0); };   // one deck alone: read, then write (no time passes)
  function resetSizes() { decks.forEach(function (d) { d.size = null; }); stopsAt = null; gate.on = false; if (rest.raf || rest.timer) restCancel(); }
  Deck.prototype.stepY = function (i) {
    var g = this.geom();
    return Math.round(window.scrollY + g.top - g.pinTop + g.stepPx * i);
  };

  // ---------------------------------------------------------------- the live stage of a deck (CONTRACTS section 3)
  // lead runs 1 → 0 while the track's top moves from the window's bottom edge up to where the stage pins; tail runs 0 → 1 while
  // the pinned stage is pushed up and out by the end of its track. Both are 0 while pinned. State: current while pinned, near
  // while partly on screen or within one window's height of it, far otherwise. The stage hears only changes: setState when the
  // state changes, setPos when position, key, lead or tail changed (and never while far), at most once a frame because this runs
  // inside the one measurement per frame.
  Deck.prototype.feed = function (g) {
    var d = this, L = d.live; if (!L) return;
    var lead = clamp((g.top - g.pinTop) / Math.max(1, g.H - g.pinTop)), tail = clamp((g.pinTop + g.sh - g.bottom) / Math.max(1, g.sh));
    d.tell(lead === 0 && tail === 0 ? 'current' : g.bottom > -g.H && g.top < 2 * g.H ? 'near' : 'far');
    if (d.lstate === 'far') return;
    var key = d.keys[Math.max(0, d.cur)], sig = d.s + '|' + key + '|' + lead + '|' + tail;
    if (sig === d.lpos) return;
    d.lpos = sig;
    call(L, 'setPos', [d.s, key, { lead: lead, tail: tail }]);
  };
  Deck.prototype.tell = function (st) {
    if (!this.live || st === this.lstate) return;
    this.lstate = st;
    if (st === 'far') this.lpos = '';                             // so the position is sent again when it comes back
    call(this.live, 'setState', [st]);
  };
  // The model deck's steps name the viewer's step to show (data-view); the stage hears each change once.
  Deck.prototype.view = function () {
    var st = this.steps[this.cur], v = st && st.dataset.view;
    // not for a step the glide is only passing through: the viewer is asked for the step the scroll position is on
    if (this.t !== undefined && this.curAt(this.t) !== this.cur) return;   // curAt: the same rule that picks the current step
    if (!this.live || !v || v === this.lview) return;
    this.lview = v;
    call(this.live, 'showStep', [v]);
  };

  function allFar() { decks.forEach(function (d) { d.tell('far'); }); }

  // The deck's CSS hides the cards and shows a live stage's controls from one class on the track, .is-live, not from the stage element's
  // data-live attribute through :has() (which some browsers do not support: there the cards would stay over the 3D and the controls
  // would never show). This mirrors the attribute as that class, whenever it changes (a MutationObserver per stage element, set in
  // start) and when motion mode changes; without motion the class is off, like everything else of the motion layer.
  Deck.prototype.syncLive = function () {
    var on2 = on && !!this.space && this.space.getAttribute('data-live') === 'on';
    if (this.track.classList.contains('is-live') !== on2) this.track.classList.toggle('is-live', on2);
  };

  // Registered by the live module itself, once: the deck mounts it in the deck's stage element and tells it where things stand.
  function addLive(name, p) {
    var d = byName[name];
    if (!d || !d.space || !p || d.live) return;                   // unknown deck, a deck without a stage, or a second stage for it
    d.live = p; d.lstate = null; d.lpos = ''; d.lview = null;
    call(p, 'mount', [d.space]);
    if (!on || suspended) { d.tell('far'); return; }
    d.measure(); d.view();
  }

  // ---------------------------------------------------------------- loading the live modules (SPEC B8; CONTRACTS section 3)
  // Live 3D is tried only with real 3D (K8_BOOT.live3d: WebGL2 drawn by a graphics chip, set by the boot script) and motion on,
  // and never with ?live=0 (the performance check's "3D off"). Each module is a <script type="module"> added after the page has
  // loaded, so text and pictures come first. Until a module sets data-live="on" on its stage element, the cards stay.
  // A module that is missing must not break the page or put an error in its console. A browser logs every failed request as an
  // error in the console of whoever asked, so the question "is the file there?" is asked by a tiny throwaway worker with a HEAD
  // request: only a yes or no comes back to the page. A module that is there but fails to load fires the script's error event,
  // and the cards simply stay.
  var loads = {}, pageLoaded = false, openedBeyond = false;
  function liveAllowed() { return !!(window.K8_BOOT && window.K8_BOOT.live3d) && on && !suspended && !/[?&]live=0(&|#|$)/.test(location.search); }
  function exists(url, cb) {
    var w, src;
    try {
      src = URL.createObjectURL(new Blob(['onmessage=function(e){fetch(e.data,{method:"HEAD",cache:"no-store"}).then(function(r){postMessage(r.ok)},function(){postMessage(false)})}'], { type: 'text/javascript' }));
      w = new Worker(src);
    } catch (e) { cb(false); return; }
    var done = function (ok) { w.terminate(); URL.revokeObjectURL(src); cb(ok); };
    w.onmessage = function (e) { done(e.data === true); };
    w.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); done(false); };
    w.postMessage(new URL(url, location.href).href);
  }
  function load(name) {
    if (loads[name] || !liveAllowed()) return;
    loads[name] = 'asking';
    exists(MODULES[name], function (ok) {
      if (!ok || !liveAllowed()) { loads[name] = ok ? null : 'missing'; checkModel(); return; }   // not now: may be tried again later
      var sc = document.createElement('script'); sc.type = 'module'; sc.src = MODULES[name];
      sc.onload = function () { loads[name] = 'loaded'; checkModel(); };
      sc.onerror = function () { loads[name] = 'failed'; checkModel(); };
      loads[name] = 'loading'; document.head.appendChild(sc);
    });
  }
  // The model's module is large; it is asked for when the browser is idle, once the task stage is live (or will not be: its module
  // is missing or failed) or the page opened beyond the first step, and once the reader has left the first step.
  function checkModel() {
    var t = byName.task;
    if (loads.model || !pageLoaded || !liveAllowed()) return;
    var taskSettled = !t || !t.space || t.space.dataset.live === 'on' || loads.task === 'missing' || loads.task === 'failed';
    var leftFirst = !t || t.s >= .5;
    if (!(taskSettled || openedBeyond) || !leftFirst) return;
    loads.model = 'waiting';
    var go = function () { loads.model = null; load('model'); };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 200);
  }
  function onLoaded() {
    pageLoaded = true;
    var t = byName.task; openedBeyond = !!(t && t.s >= .5);       // read after the jump to an address's step (fromHash, on load)
    load('task'); checkModel();
    var sp = t && t.space;                                        // the task stage going live releases the model's module
    if (sp && window.MutationObserver) new MutationObserver(checkModel).observe(sp, { attributes: true, attributeFilter: ['data-live'] });
  }

  // ---------------------------------------------------------------- the chapter menu of a narrow bar (21 Nov 2026; story.css: under
  // 760 px the chapter links fold into it). A link, Escape, or a tap outside the bar closes it.
  (function () {
    var bar = document.querySelector('.st-top'), b = bar && bar.querySelector('.st-menu'); if (!b) return;
    function set(open) { bar.classList.toggle('is-chap', open); b.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    b.addEventListener('click', function () { set(!bar.classList.contains('is-chap')); });
    bar.querySelector('.st-chap').addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    document.addEventListener('click', function (e) { if (!bar.contains(e.target)) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && bar.classList.contains('is-chap')) { set(false); b.focus(); } });
  })();

  // ---------------------------------------------------------------- the page
  // Read, then write: reading layout (getBoundingClientRect) after a style was written makes the browser lay the page out again at once,
  // so every deck's geometry is read first and only then does any deck write (its cards, and its live stage through setPos).
  // now = the frame's time (from requestAnimationFrame); called without it (go) every deck goes to its place at once.
  var lastT = 0;
  function measureAll(now) {
    queued = false; if (!on || suspended) { lastT = 0; return; }
    var dt = now === undefined ? null : lastT ? Math.min(.05, Math.max(0, (now - lastT) / 1000)) : 1 / 60;
    var gs = decks.map(function (d) { return d.geom(); }), moving = false;
    for (var i = 0; i < decks.length; i++) { decks[i].apply(gs[i], dt); if (decks[i].moving) moving = true; }
    lastT = moving && now !== undefined ? now : 0;
    if (moving) ask();                                            // keep gliding until every deck has arrived
    if (pageLoaded && !loads.model) checkModel();
  }
  // ---- the step gate (off unless ?gate=1, see GATE above: setting the scroll position while the reader's own gesture is still
  // scrolling makes the page go back and forth). A wheel or trackpad gesture (wheel events less than GATE_REST apart, which includes a trackpad's momentum)
  // may carry the page no further than the next step's position in either direction: scroll positions beyond it are put back to
  // it. Held there for GATE_DWELL, or after a pause, the next gesture starts from that step. Nothing is prevented or animated:
  // wheel events are only watched (passive), and the page's scroll position is limited. Scrolling that is not wheel input (the
  // scrollbar, keys, chapter links, K8Story.go, focus) is never limited, nor is anything without motion mode.
  var gate = { on: false, until: 0, lo: -Infinity, hi: Infinity, held: 0 }, stopsAt = null, exitsAt = null;
  function stops() {
    if (!stopsAt) {
      stopsAt = []; exitsAt = [];
      decks.forEach(function (d) {
        for (var i = 0; i < d.N; i++) stopsAt.push(d.stepY(i));
        // where the deck lets go: from `pinned` (the end of the last step's hold) the stage slides up and out, until at `out` the
        // track's end is under the top bar and what follows the deck starts at the top of the window. `out` is a stop too.
        var g = d.geom(), top = window.scrollY + g.top - g.pinTop, h = g.bottom - g.top;
        exitsAt.push({ pinned: Math.round(top + h - g.sh), out: Math.round(top + h) });
        stopsAt.push(Math.round(top + h));
      });
      // the heading band between two decks is passed through in the same way: from the end of one deck (`out`) to the first step
      // of the next, where the next stage has risen into place
      // tactical/ (16 Nov): only a THIN band counts (a heading, under 60% of the window). Since the model deck was replaced, the gap
      // between the data deck and the results deck is the whole TAKE CONTROL section (a full screen) plus a heading; treating that
      // as a pass-through band carried the reader off the section whenever they rested near either end of it (the jitter).
      for (var k = 1; k < decks.length; k++) { var a0 = exitsAt[k - 1].out, b0 = decks[k].stepY(0);
        if (b0 - a0 > 8 && b0 - a0 < window.innerHeight * .6) exitsAt.push({ pinned: a0, out: b0 }); }
      stopsAt.sort(function (a, b) { return a - b; });
    }
    return stopsAt;
  }
  function gateFrom(y) {
    var S = stops(), lo = -Infinity, hi = Infinity;
    for (var i = 0; i < S.length; i++) { if (S[i] < y - 2) lo = S[i]; else if (S[i] > y + 2) { hi = S[i]; break; } }
    gate.lo = lo; gate.hi = hi; gate.held = 0; gate.on = true;
  }
  function gateInput() {
    if (!GATE || !on || suspended) return;
    var now = performance.now();
    if (!gate.on || now > gate.until) gateFrom(window.scrollY);
    gate.until = now + GATE_REST;
  }
  function gateScroll() {
    if (!gate.on) return;
    var now = performance.now(), y = window.scrollY;
    if (now > gate.until || !on || suspended) { gate.on = false; return; }
    var to = y > gate.hi ? gate.hi : y < gate.lo ? gate.lo : null;
    if (to === null) return;
    if (!gate.held) gate.held = now;
    jump(to);
    if (now - gate.held > GATE_DWELL) gateFrom(to);               // seen long enough: the same gesture may go on to the next step
  }
  function ask() { if (!queued) { queued = true; requestAnimationFrame(measureAll); } }   // at most one measurement per frame

  // An instant jump. html may carry scroll-behavior:smooth from elsewhere, so it is switched off for this one call.
  // ---- leaving a deck (Nic, 10 Nov: "you basically become half on the now-drive-yourself part and the next heading"). Between
  // `pinned` and `out` (see stops) the stage is half pushed off the screen: a place to pass through, not to rest. When the scrolling
  // comes to rest there, the page is carried on to the nearer end in the direction of travel: on to what follows the deck, or back
  // to the deck's last step. It only acts after the reader's own scrolling has stopped (SETTLE_REST ms without a scroll event, so a
  // trackpad's momentum has ended) and any new input cancels it. It has its own switch (CARRY: on unless ?gate=0).
  // tactical/ (Nic, 16 Nov: "too snappy, someone may scroll too far by accident"): it waits longer for the reader to stop, glides
  // more slowly, goes to the NEAREST end (not the end in the direction of travel), and only from the outer CARRY_REACH of the zone
  // at either end; stopping in the middle of the zone leaves the page where the reader put it. story/ keeps the old 160 / 520 rule.
  var SETTLE_REST = 420, SETTLE_MS = 850, CARRY_REACH = .3;
  var rest = { timer: 0, raf: 0, lastY: 0, dir: 1 };
  function restCancel() { if (rest.raf) cancelAnimationFrame(rest.raf); rest.raf = 0; if (rest.timer) clearTimeout(rest.timer); rest.timer = 0; }
  function restScroll() {
    if (!CARRY || !on || suspended) return;
    if (rest.raf) return;                                         // the carry is running: these scroll events are its own
    var y = window.scrollY; if (y !== rest.lastY) rest.dir = y > rest.lastY ? 1 : -1; rest.lastY = y;
    restCancel(); rest.timer = setTimeout(restSettle, SETTLE_REST);
  }
  function restSettle() {
    rest.timer = 0;
    if (!on || suspended) return;
    stops();
    var y = window.scrollY, z = null;
    for (var i = 0; i < exitsAt.length; i++) if (y > exitsAt[i].pinned + 4 && y < exitsAt[i].out - 4) z = exitsAt[i];
    if (!z) return;
    var toOut = z.out - y, toPin = y - z.pinned;
    if (Math.min(toOut, toPin) > (z.out - z.pinned) * CARRY_REACH) return;   // the middle of the zone: no carry
    var from = y, to = toOut < toPin ? z.out : z.pinned, t0 = performance.now();
    gate.on = false;
    (function frame(now) {
      var k = Math.min(1, Math.max(0, (now - t0) / SETTLE_MS)), yy = Math.round(from + (to - from) * ease(k));
      jump(yy); rest.lastY = yy; ask();
      rest.raf = k < 1 ? requestAnimationFrame(frame) : 0;
    })(t0);
  }

  function jump(y) {
    var sb = html.style.scrollBehavior; html.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    html.style.scrollBehavior = sb;
  }
  function find(key) { return key ? byKey[key] || byKey['#' + key] || null : null; }
  // Where on the page the step with this key (or id) is current. Without motion a step has its own place: its top under the bar.
  function stepY(key) {
    var f = find(key); if (!f) return null;
    if (on) return f.deck.stepY(f.i);
    var bar = parseFloat(getComputedStyle(f.deck.steps[f.i]).scrollMarginTop) || 0;   // the room left for the top bar (story.css)
    return Math.round(window.scrollY + f.deck.steps[f.i].getBoundingClientRect().top - bar);
  }
  function go(key) { var y = stepY(key); if (y === null) return false; gate.on = false; restCancel(); jump(y); measureAll(); return true; }

  // With motion on, a step has no place of its own on the page (it is laid over the pinned stage), so a link to it is turned into
  // that step's scroll position. Links to anything else are left to the browser.
  function onClick(e) {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // not the primary button, or a modifier key (new tab or window): left to the browser
    var a = e.target.closest ? e.target.closest('a[href^="#"]') : null, h = a ? a.getAttribute('href') : '';
    if (!on || !find(h)) return;
    e.preventDefault(); go(h); history.replaceState(null, '', h);
  }
  function fromHash() { if (on && find(location.hash)) go(location.hash); }

  // Motion switched on or off (reduced motion turned on, window resized). Off: every live stage goes far, and story.css shows the
  // plain article with its pictures (the stage elements are not shown at all without html.st-motion).
  function setMotion() {
    on = wants.matches;
    html.classList.toggle('st-motion', on);
    resetSizes();
    decks.forEach(function (d) {
      d.reset(); d.syncLive();
      // track height = the stage + one step length per step after the first + the hold at the end
      d.track.style.height = on ? 'calc(100svh - var(--bar) + ' + ((d.N - 1 + HOLD) * STEP_SVH).toFixed(1) + 'svh)' : '';
    });
    if (!on) allFar();
    else if (pageLoaded) { load('task'); }
    ask();
  }

  function state() {
    var o = { on: on, suspended: suspended, moving: decks.some(function (d) { return !!d.moving; }), decks: {}, live: { task: null, model: null } };
    decks.forEach(function (d) {
      var st = d.steps[d.cur];
      o.decks[d.name] = { s: d.s, goal: d.t === undefined ? d.s : d.t, cur: d.cur, key: st ? st.dataset.key : null, slot: st ? (st.dataset.slot || st.dataset.key) : null,
        steps: d.N, phase: st ? st.dataset.phase || '' : null, keys: d.keys.slice(), side: st ? st.dataset.side || 'right' : null };
      if (d.name in o.live) o.live[d.name] = d.live ? d.lstate || 'far' : null;
    });
    return o;
  }

  function start() {
    decks = Array.prototype.slice.call(document.querySelectorAll('#story .dk-track[data-deck]')).map(function (t) { return new Deck(t); });
    decks.forEach(function (d) { byName[d.name] = d; });
    if (!decks.length) return;
    window.addEventListener('scroll', function () { gateScroll(); restScroll(); ask(); }, { passive: true });
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (ev) { window.addEventListener(ev, function () { if (rest.raf) restCancel(); }, { passive: true }); });
    window.addEventListener('wheel', gateInput, { passive: true });
    window.addEventListener('resize', function () { resetSizes(); ask(); }, { passive: true });
    if (window.ResizeObserver) {                                  // a stage's size can also change without a window resize: read it again then
      var ro = new ResizeObserver(function () { resetSizes(); ask(); });
      decks.forEach(function (d) { if (d.stage) ro.observe(d.stage); if (d.open && d.panels[0]) ro.observe(d.panels[0]); });
    }
    if (window.MutationObserver) decks.forEach(function (d) {
      if (d.space) new MutationObserver(function () { d.syncLive(); }).observe(d.space, { attributes: true, attributeFilter: ['data-live'] });
    });
    window.addEventListener('hashchange', fromHash);
    window.addEventListener('load', fromHash);                    // the browser's own jump to #id happens around load; put the step right after it
    document.addEventListener('click', onClick);
    if (wants.addEventListener) wants.addEventListener('change', setMotion); else if (wants.addListener) wants.addListener(setMotion);
    setMotion();
    fromHash();
    if (document.readyState === 'complete') setTimeout(onLoaded); else window.addEventListener('load', function () { setTimeout(onLoaded); });
  }

  window.K8Story = {
    state: state, stepY: stepY, go: go, addLive: addLive,
    returned: returned,                                           // true when this load is the way back from the viewer (see the top)
    suspend: function () { suspended = true; allFar(); },
    resume: function () { suspended = false; decks.forEach(function (d) { d.s = -1; }); ask(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
