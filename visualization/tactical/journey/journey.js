// dive.js: prototype of the journey's "dive" (tactical/research/fable_how.md, prototype 1).
//
// Four levels, one renderer, one camera. The model level is chosen by ?model=a|b|3d (A and B: modelviews.js; 3d: the real viewer
// in an iframe, level D below):
//   A  the head and headset from ../hero.js (unchanged), with one hotspot on the headset's front.
//   B  the circuit board: a replica of the Quest 3 main board (../assets/board_q3.glb, models/board_build.py), with three
//      hotspots on its real parts; a placeholder board made in code stands in until it loads (or if it fails to).
// Clicking A's hotspot flies the camera into the visor until it fills the screen, then MATCH-CUTS to B:
//   1. render the last frame of A and copy it onto a 2D canvas (#freeze) that sits over the WebGL canvas;
//   2. switch the renderer to B's scene and put the camera a little way back from B's home view;
//   3. while the camera moves forward to B's home view, the frozen frame grows and fades (CSS), so both
//      layers move "forward" together and the eye never sees the swap.
// Back (button or Esc) does the same in reverse: the frozen frame shrinks while A's camera pulls out.
// (16 Nov) The match-cut became a fade through black: the camera still dives in one move, the picture fades out over its last part,
// the level is swapped while the screen is black, and the new level fades in as its camera settles (diveInto / backOut, fadeTo).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createHero } from '../hero.js';
import { loadHeadsetModel } from '../hero_model.js';   // the real headset (Elin's CC BY Quest 3, logo removed)
import { makeGLTFLoader } from '../hero_model.js';                // the shared glTF loader (Draco-compressed files)
import { applyBoardTextures } from './board_textures.js';   // code-drawn surface detail for the replica board
import { DIE, NPU_N, NPU_K8, npuTile, dieTexture } from './die_texture.js';   // the die's picture, layout and NPU tiles
const BOARD_URL = new URL('../assets/board_q3.glb?r=b7', import.meta.url).href;   // models/board_build.py writes it
import { makeA, makeB } from './modelviews.js';

// Which model level to show: ?model=a (etched on the die), ?model=b (console) or ?model=3d (the real viewer in an iframe).
const MODEL = (new URLSearchParams(location.search).get('model') || 'a').toLowerCase();

const $ = id => document.getElementById(id);
const glCanvas = $('gl'), freeze = $('freeze'), flash = $('flash'), dotsEl = $('dots');

// ---------------------------------------------------------------- renderer + camera (shared by every level)
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true });   // alpha: in the TAKE CONTROL state the canvas is see-through, so the type shows behind the head
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.setClearColor(0x010101, 1);
const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 100);

// ---------------------------------------------------------------- layout: where the 3D subject sits (21 Nov 2026, phone pass)
// The one record every framing decision reads (camera fit, view offset, dot culling):
//   { form: 'phone' | 'wide', W, H, model: { x, y, w, h }, fit: { w, h } }
// phone = portrait and at most 768 px wide (anduril.com's test). The panel is a text block over the top --ph of the screen and the
// subject sits in the model rect below it, above a --pb strip for the board switch and the die caption. wide = the desktop layout:
// the subject sits left of the side panel. `model` is where the subject is centred; `fit` is the area it is sized to (wide: the whole
// window, as before the phone pass, so the desktop framing is unchanged).
let panelOn = false, openId = null;
const cssPx = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
const PHONE_TOP = cssPx('--ph'), PHONE_BOTTOM = cssPx('--pb');
function layout() {
  const W = innerWidth, H = innerHeight;
  if (W <= 768 && W < H) {
    const y = panelOn ? PHONE_TOP : 0, model = { x: 0, y, w: W, h: H - y - (panelOn ? PHONE_BOTTOM : 0) };
    return { form: 'phone', W, H, model, fit: model };
  }
  return { form: 'wide', W, H, model: { x: 0, y: 0, w: W - (panelOn ? $('panel').offsetWidth : 0), h: H }, fit: { w: W, h: H } };
}
// the view offset that puts the camera's centre on the model rect's centre (eased by the loop, snapped on resize)
const off = { x: 0, y: 0 };
function offsetFor({ W, H, model: m }) { return { x: W / 2 - (m.x + m.w / 2), y: H / 2 - (m.y + m.h / 2) }; }
function setOffset(x, y) {
  off.x = x; off.y = y; const { W, H } = layout();
  if (Math.abs(x) < .5 && Math.abs(y) < .5) camera.clearViewOffset(); else camera.setViewOffset(W, H, x, y, W, H);
}

let reframe = false;                                                // set on resize: the loop re-applies the current view's pose when idle
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  freeze.width = glCanvas.width; freeze.height = glCanvas.height;
  document.documentElement.classList.toggle('phone', layout().form === 'phone');
  const o = offsetFor(layout()); setOffset(o.x, o.y);               // layout() again: the class above changes the panel's width
  reframe = true;
  if (L) showBack();
}
addEventListener('resize', resize);

// A reflection map made in code (two bright panels and a dim floor), as stage_task.js does, so glossy parts have something to reflect.
function addEnvironment(scene, intensity = 0.55) {
  const room = new THREE.Scene();
  const panel = (w, h, x, y, z, v) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); room.add(m); };
  panel(6, 4, -5, 5, 4, 6); panel(5, 5, 6, 2, 3, 2.5); panel(20, 20, 0, -6, 0, 0.12);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(room, 0.04).texture; scene.environmentIntensity = intensity;
  pm.dispose();
}

// The board's reflection map: a studio, not a room. One large softbox overhead, two strip lights at the sides and a dark floor,
// so flat metal and the glossy solder mask show long clean highlights as the board turns, like a product photo.
function boardEnvironment(scene, intensity = 1) {
  const room = new THREE.Scene();
  const panel = (w, h, x, y, z, v) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); room.add(m); };
  panel(9, 9, 0, 8, 1, 5);          // overhead softbox
  panel(2, 10, -7, 3, 2, 3.5);      // strip, left
  panel(2, 10, 7, 3, -2, 2.2);      // strip, right
  panel(30, 30, 0, -8, 0, 0.04);    // dark floor
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(room, 0.02).texture; scene.environmentIntensity = intensity;
  pm.dispose();
}

// ---------------------------------------------------------------- camera poses and the tween
// A pose is { target, dir, dist }: the camera stands at target + dir * dist and looks at target.
// Tweening a pose (not a position) keeps the camera on an orbit around the subject: the target is lerped, the direction is
// slerped (turned along the shortest arc) and the distance is interpolated in log space, so zooming 100x feels as steady as 2x.
const pose = (target, dir, dist) => ({ target: target.clone(), dir: dir.clone().normalize(), dist });
const cur = pose(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 1);
// The distance at which a w x h subject (seen roughly face-on) fits layout().fit, for this camera's 24 degree vertical field of view.
// Taking the larger of the two fits keeps a wide subject inside a tall, narrow area.
function fitDist(w, h, margin = 1.1) {
  const t = Math.tan(camera.fov * Math.PI / 360), { H, fit } = layout();
  return margin * Math.max(h / 2 / t * H / fit.h, w / 2 / t * H / fit.w);
}
// A close-up distance tuned on the desktop (where the area beside the panel is about as wide as the window is tall), scaled so the
// same view fits layout().fit: 1 on the desktop, about 1.7 in a phone's model rect.
const fitScale = () => { const { H, fit } = layout(); return Math.max(1, H / fit.h, H / fit.w); };
function applyPose(p) {
  camera.position.copy(p.target).addScaledVector(p.dir, p.dist); camera.lookAt(p.target);
  if (L && !L.external) {
    const far = Math.max(L.far, p.dist * 3);                       // a speed-matched start can sit far back
    // The near clip follows the camera's distance (16 Nov, flicker fix): a level's own near (0.01) is only needed when the camera is
    // that close, at the end of a dive. Seen from afar it wastes the depth buffer's precision, and thin layers a few thousandths
    // of a unit apart (the board's plated rings, silkscreen, chip markings) flickered as the board swayed. 5% of the distance is
    // still far closer than anything in view.
    const near = Math.max(L.near, p.dist * .05);
    if (far !== camera.far || near !== camera.near) { camera.far = far; camera.near = near; camera.updateProjectionMatrix(); }
  }
}

const ease = {
  inOut: t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  in: t => t * t * t * t,                                  // speeds up: used when diving in (we accelerate into the surface)
  out: t => 1 - (1 - t) ** 3,                              // slows down: used for the arrival in the next level
  in2: t => t * t, out2: t => 1 - (1 - t) ** 2,            // gentler versions (lower top speed): the dives
};
// Speed matching across a cut. Zoom speed is measured in log-distance per second (so "2x closer per X seconds" feels the same at any
// scale). A curve that eases in as t^p over T seconds through a log-span of s ends at speed p*s/T; one that eases out as 1-(1-t)^p
// starts at that speed. So for the next level to start exactly as fast as the dive ended, its starting distance factor k must
// satisfy p_out * ln(k) / T_out = v, i.e. k = exp(v * T_out / p_out).
const matchK = (v, T, p, lo = 1.3, hi = 14) => Math.min(hi, Math.max(lo, Math.exp(v * T / p)));
const turnFirst = t => ease.inOut(Math.min(1, t / .55));   // turn to face the target in the first 55%, while the zoom builds
let tween = null;
function flyTo(to, ms, eDir = ease.inOut, eDist = eDir) {
  const from = pose(cur.target, cur.dir, cur.dist);
  const turn = new THREE.Quaternion().setFromUnitVectors(from.dir, to.dir), id = new THREE.Quaternion(), q = new THREE.Quaternion();
  return new Promise(done => {
    tween = { t0: performance.now(), ms, step(now) {
      const t = Math.min(1, (now - this.t0) / ms), a = eDir(t), b = eDist(t);
      cur.target.lerpVectors(from.target, to.target, a);
      q.slerpQuaternions(id, turn, a); cur.dir.copy(from.dir).applyQuaternion(q);
      cur.dist = from.dist * (to.dist / from.dist) ** b;
      if (t >= 1) { tween = null; done(); }
    } };
  });
}

// ---------------------------------------------------------------- level A: the headset
function buildHeadset() {
  const scene = new THREE.Scene();
  const hero = createHero({ THREE, clip: window.K8_HERO_CLIP, head: window.K8_HERO_HEAD, pose: window.K8HeroPose });
  scene.add(hero.group);
  // the real headset replaces the box one once loaded; then the processor dot (and the dive) moves to the middle front sensor pill,
  // measured in models/headset.blend at the head's rest frame (page axes): dark glass, so the dive still ends on a dark surface
  loadHeadsetModel(THREE).then(m => { hero.useModel(m); anchor.position.set(0, -.115, -.556); }).catch(e => console.warn('headset model:', e));
  hero.ghost.visible = false; hero.arc.visible = false;                  // the prediction parts belong to the end of the journey
  const ptr = hero.headset.getObjectByName('hero-pointer'); ptr.visible = false;
  hero.update(0);

  const box = new THREE.Box3(); for (const m of [hero.skin, ...hero.headset.children.filter(o => o.isMesh)]) box.expandByObject(m, true);
  const origin = box.getCenter(new THREE.Vector3()), U = box.max.y - box.min.y, a = hero.bodyRef;

  // lights as in stage_task.js light(): warm key, cool fill, rim, plus the environment
  const F = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)), R = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), UP = new THREE.Vector3(0, 1, 0);
  const at = (f, u, r) => origin.clone().addScaledVector(F, f * U).addScaledVector(UP, u * U).addScaledVector(R, r * U);
  const aim = new THREE.Object3D(); aim.position.copy(origin); scene.add(aim);
  for (const [c, p, pos] of [[0xfff1e0, 2.6, at(3, 3, -2)], [0xcfdcff, .65, at(2, .5, 3)], [0xffffff, 2.2, at(-3, 2.6, 1)]]) {
    const l = new THREE.DirectionalLight(c, p); l.position.copy(pos); l.target = aim; scene.add(l);
  }
  scene.add(new THREE.HemisphereLight(0xffffff, 0x15171b, .35));
  addEnvironment(scene);

  // The hotspot: an empty object at the start of the headset's own pointer line (the front of the shell, on the visor), so it
  // rides with the head. Its outward normal is the headset's forward axis (−z in the headset's local space).
  const pa = ptr.geometry.attributes.position;
  const anchor = new THREE.Object3D(); anchor.position.set(pa.getX(0), pa.getY(0), pa.getZ(0)); hero.headset.add(anchor);
  const yaw = a + 30 * Math.PI / 180, pitch = 8 * Math.PI / 180;
  const homeDir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  // the head and headset fill 1.24 U of height (the desktop framing) and about SUBJECT_W U of width, seen from homeDir
  const SUBJECT_W = 1.0, fit = (margin = 1) => fitDist(SUBJECT_W * U, 1.24 * U, margin);
  // two more anchors, from the shell's own box in the headset's local space: the top of the shell (where the motion sensor sits)
  // and the left of the visor (the display). Like the processor's, they ride with the head.
  const shell = hero.headset.children.find(m => m.isMesh && /body$/.test(m.name)) || hero.headset.children.find(m => m.isMesh);
  shell.geometry.computeBoundingBox();
  const sb = shell.geometry.boundingBox.clone().applyMatrix4(shell.matrix), sc = sb.getCenter(new THREE.Vector3()), ss = sb.getSize(new THREE.Vector3());
  const onSet = (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); hero.headset.add(o); return o; };
  const imuA = onSet(sc.x, sb.max.y, sb.min.z + ss.z * .2), dispA = onSet(anchor.position.x + ss.x * .28, anchor.position.y, anchor.position.z);

  const lvl = {
    name: '01 / HEADSET', scene, near: .004 * U, far: 40 * U,
    home: () => pose(origin, homeDir, fit()),
    subject: () => [hero.skin, hero.headset],
    // TAKE CONTROL framing: the head a little lower than centre (so it overlaps the bottom of the type), seen more from the side,
    // the view turning slowly back and forth (t in seconds) so the screen is never still
    // face (0..1, from the story page's scroll): 0 = this side view, 1 = face-on, looking at the reader. homeDir is 30° off the
    // player's mean facing direction, so turning it by −30° (−.524 rad) puts the camera straight in front of the face.
    heroPose(t = 0, face = 0) {
      const e = face * face * (3 - 2 * face);                          // smoothstep: eases in and out of the turn
      const ang = .5 + (-.524 - .5) * e + Math.sin(t * .13) * .14 * (1 - .75 * e);   // the idle drift calms as it faces you
      const d = homeDir.clone().applyAxisAngle(UP, ang); d.y = .05; d.normalize();
      return pose(origin.clone().addScaledVector(UP, .16 * U), d, fit(1.12));
    },
    title: 'The VR headset', sub: 'LEVEL 01 · WHERE THE DATA COMES FROM',
    hotspots: [
      { id: 'imu', label: 'MOTION SENSOR\nGYRO + ACCELEROMETER', anchor: imuA, normal: new THREE.Vector3(0, 1, -1).normalize(),   // top front edge: faces up and forward, so the dot shows from the usual view
        title: 'Motion sensor',
        text: 'A gyroscope and an accelerometer measure how the head turns, hundreds of times a second. The headset fuses them into one orientation, a quaternion of four numbers, every 10 ms. That stream is all our model sees.',
        facts: [['RATE', '100 HZ'], ['ONE SAMPLE', 'W, X, Y, Z']] },
      { id: 'disp', label: 'DISPLAY', anchor: dispA, normal: new THREE.Vector3(0, 0, -1), title: 'Display',
        text: 'Drawing a frame takes time, so the headset has to draw it for where the head is about to be, not where it was. Predicting head motion ahead is how that delay is hidden.',
        facts: [['THE CHALLENGE', 'PREDICT 200 MS AHEAD']] },
      { id: 'proc', label: 'PROCESSOR\nXR SOC · RUNS THE MODEL', anchor, normal: new THREE.Vector3(0, 0, -1), dive: 'board', title: 'Processor',
        text: 'The chip that runs the headset: tracking, graphics and small neural networks like ours. Go inside to find where k8 runs.',
        facts: [['INSIDE', 'BOARD → CHIP → NPU']] },
    ],
    // The camera pose that ends a dive: square on to the surface, so close that it fills the frame.
    exitPose(h) {
      h.anchor.updateWorldMatrix(true, false);
      const p = h.anchor.getWorldPosition(new THREE.Vector3()), n = h.normal.clone().transformDirection(h.anchor.matrixWorld);
      return pose(p, n, .02 * U);
    },
    approach(h) { const e = this.exitPose(h); e.dir.lerp(homeDir, .45).normalize(); e.dist = 1.4 * U * fitScale(); return e; },
    // Playback: `speed` is how fast the recording plays (0.25 = quarter speed, as on the story page). While the pointer is on a
    // dot, `hold` is set and the actual rate eases down to 0, so the target sits still under the cursor and is easy to click.
    clock: 0, playing: true, hold: false, rate: 0,
    update(dt) {
      const want = this.playing && !this.hold ? +$('tSpeed').value / 100 : 0;
      this.rate += (want - this.rate) * Math.min(1, dt * 8);          // ~0.3 s to settle, so it never stops with a jolt
      if (this.rate > 1e-4) { this.clock += dt * this.rate; hero.update(this.clock); }
    },
    U,
    // the ending (finale): the ghost headset (k8's prediction, 200 ms ahead), both forward pointers and the arc between them
    setPredict(on) { hero.ghost.visible = on; hero.arc.visible = on; ptr.visible = on; },
    predictPose() { return pose(origin, homeDir, fit(1.08)); },
    // the story hero's rule (stage_task.js readout): the prediction that has just come due was made 20 samples (200 ms) ago, so
    // show err[i − 20] and hold[i − 20] straight from the clip; null while i − 20 is before the clip's start
    readout() { const C = window.K8_HERO_CLIP, k = hero.sampleIndex() - hero.horizon; return k < 0 ? null : { err: C.err[k], hold: C.hold[k] }; },
  };
  return lvl;
}

// ---------------------------------------------------------------- level B: the circuit board
// The replica (board_q3.glb) is built in Blender by models/board_build.py from iFixit's photo of the Quest 3 board's side 1, with
// the chips' real markings (Nic, 16 Nov). Its empties anchor_soc / anchor_mem / anchor_wifi mark where the hotspots sit.
// The procedural board below is what shows until the file has loaded, and stays if it fails.
function labelTexture(lines, w = 512, h = 512) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = '#8f9295'; g.fillRect(0, 0, w, h);                 // the lid's brushed grey; the text is laser-etched darker
  g.fillStyle = 'rgba(30,32,34,.75)'; g.font = '600 46px GeistMono, monospace';
  lines.forEach((t, i) => g.fillText(t, 48, 120 + i * 62));
  g.beginPath(); g.arc(60, h - 60, 14, 0, Math.PI * 2); g.fill();  // pin-1 mark
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

function buildBoard() {
  const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;   // seeded, so the board is the same on every load
  const phys = o => new THREE.MeshPhysicalMaterial(o);

  // the board itself: a dark solder-mask slab
  const pcb = new THREE.Mesh(new RoundedBoxGeometry(10, .16, 7, 3, .06), phys({ color: 0x0c1410, roughness: .5, clearcoat: .7, clearcoatRoughness: .3 }));
  pcb.position.y = -.08; group.add(pcb);
  const top = 0;

  // SoC package + metal lid with an etched generic marking (no real brand)
  const soc = new THREE.Mesh(new THREE.BoxGeometry(2.2, .16, 2.2), phys({ color: 0x141516, roughness: .7 }));
  soc.position.set(0, top + .08, 0); group.add(soc);
  const lidMat = [phys({ color: 0x9a9c9f, metalness: 1, roughness: .35 })]; const lidTop = phys({ map: labelTexture(['XR-SOC', 'K8 · NPU', '2027 / 4NM']), metalness: .9, roughness: .4 });
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.6, .06, 1.6), [lidMat[0], lidMat[0], lidTop, lidMat[0], lidMat[0], lidMat[0]]);
  lid.position.set(0, top + .19, 0); group.add(lid);

  // memory chips and the IMU
  const chip = (w, d, x, z, h = .12) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), phys({ color: 0x101112, roughness: .55, clearcoat: .3 })); m.position.set(x, top + h / 2, z); group.add(m); return m; };
  chip(1.1, 1.5, -2.2, -.2); const mem = chip(1.1, 1.5, 2.2, -.2); const imu = chip(.45, .45, 3.6, 2.4, .08);

  // traces: Manhattan paths fanning out from the SoC, drawn as thin flat boxes in ONE InstancedMesh (one draw call)
  const segs = [];
  for (let i = 0; i < 90; i++) {
    const side = i % 4, k = (Math.floor(i / 4) / 22 - .5) * 2;
    let x = side < 2 ? (side ? 1.12 : -1.12) : k * 1.0, z = side < 2 ? k * 1.0 : (side === 2 ? 1.12 : -1.12);
    for (let s = 0; s < 3; s++) {
      const horiz = (side < 2) === (s % 2 === 0), len = .4 + rnd() * 1.8, sign = side === 0 || side === 3 ? -1 : 1;
      const nx = horiz ? x + sign * len : x, nz = horiz ? z : z + (rnd() < .5 ? -1 : 1) * len * .6;
      if (Math.abs(nx) > 4.8 || Math.abs(nz) > 3.3) break;
      segs.push([x, z, nx, nz]); x = nx; z = nz;
    }
  }
  const tr = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .012, 1), phys({ color: 0x6b6247, metalness: .8, roughness: .45 }), segs.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  segs.forEach(([x0, z0, x1, z1], i) => { P.set((x0 + x1) / 2, top + .006, (z0 + z1) / 2); S.set(Math.abs(x1 - x0) + .03, 1, Math.abs(z1 - z0) + .03); tr.setMatrixAt(i, M.compose(P, Q, S)); });
  group.add(tr);

  // passives (resistors and capacitors) and vias, each one InstancedMesh
  const pas = new THREE.InstancedMesh(new THREE.BoxGeometry(.14, .07, .07), phys({ color: 0xffffff, roughness: .6 }), 160), col = new THREE.Color();
  for (let i = 0; i < 160; i++) {
    let x, z; do { x = (rnd() - .5) * 9.2; z = (rnd() - .5) * 6.2; } while (Math.abs(x) < 1.4 && Math.abs(z) < 1.4);
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() < .5 ? 0 : Math.PI / 2);
    pas.setMatrixAt(i, M.compose(P.set(x, top + .035, z), Q, S.set(1, 1, 1)));
    pas.setColorAt(i, col.set(rnd() < .6 ? 0x6e5a3c : 0x1b1b1c));
  }
  group.add(pas); Q.identity();
  const via = new THREE.InstancedMesh(new THREE.CylinderGeometry(.03, .03, .01, 10), phys({ color: 0xb79a5b, metalness: 1, roughness: .3 }), 220);
  for (let i = 0; i < 220; i++) via.setMatrixAt(i, M.compose(P.set((rnd() - .5) * 9.4, top + .005, (rnd() - .5) * 6.4), Q, S.set(1, 1, 1)));
  group.add(via);

  // Lighting (16 Nov, Nic: "improve the lighting"): a product-shot setup. A neutral key from the front left and above, a cool rim
  // from behind that draws the edges of the parts and the frames, a weak warm fill from the right, and a studio reflection map
  // with a big overhead softbox, so the metal (shield frames, cans, standoffs, gold) has something bright to reflect.
  scene.add(new THREE.HemisphereLight(0xe8eef5, 0x080808, .45));
  const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(-5, 7, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbcd2ff, 2.2); rim.position.set(3, 4, -7); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffe6c8, .6); fill.position.set(7, 2, 3); scene.add(fill);
  boardEnvironment(scene, 1.1);

  const anchorOn = (obj, y) => { const a = new THREE.Object3D(); a.position.set(0, y, 0); obj.add(a); return a; };
  const up = new THREE.Vector3(0, 1, 0);
  const homeDir = new THREE.Vector3(.35, 1, .75).normalize();
  const lvl = {
    name: '02 / BOARD', scene, near: .01, far: 100, U: 10, title: 'Inside the headset', sub: 'LEVEL 02 · THE CIRCUIT BOARD',
    home: () => pose(new THREE.Vector3(0, 0, .3), homeDir, fitDist(11, 8)),
    subject: () => [lvl.realBoard ? flip : group],
    hotspots: [
      // (16 Nov) the motion-sensor hotspot moved off the board: the headset's IMU is not on this board's public chip list, so
      // there is no real part to point at. Wi-Fi took its place. Names and parts: iFixit, "Meta Quest 3 Chip ID" (2023).
      { id: 'wifi', label: 'WI-FI 6E\nWCN6856', anchor: anchorOn(mem, .06), normal: up, zoom: 2.6, title: 'Wi-Fi 6E',
        text: 'Qualcomm WCN6856 with its two Qorvo front ends (2.4 and 5 GHz), under the right-hand shield frame. Prediction does not need it: a model as small as k8 can run on the headset itself, with no round trip to a server.',
        facts: [['PART', 'WCN6856-102'], ['FRONT ENDS', 'QORVO QM42391 · QM45392']] },
      { id: 'mem', label: 'MEMORY\n8 GB LPDDR5', anchor: anchorOn(mem, .06), normal: up, zoom: 3.4, title: 'Memory',
        text: '8 GB of LPDDR5 working memory for the operating system, apps and frames (SK hynix, per iFixit\'s chip ID). k8 barely needs it: its weights are 44 KB, small enough to sit in the chip\'s own on-chip memory.',
        facts: [['PART', 'H58G66BK8BX105'], ['K8 WEIGHTS', '44,196 BYTES']] },
      { id: 'soc', label: 'XR2 GEN 2\nCPU · GPU · NPU', anchor: anchorOn(lid, .03), normal: up, zoom: 3.4, dive: 'die', title: 'Processor: Snapdragon XR2 Gen 2',
        text: 'Qualcomm\'s Snapdragon XR2 Gen 2: CPU, GPU and a neural processing unit on one chip. A model the size of k8 would fit on its NPU. Go inside the chip.',
        facts: [['PART', 'SXR2230P-100-AB'], ['INSIDE', 'ILLUSTRATED, NOT A DIE PHOTO']] },
    ],
    approach(h) { const p = h.anchor.getWorldPosition(new THREE.Vector3()); return pose(p, homeDir.clone().lerp(up, .4), h.zoom * fitScale()); },
    // the dive into the SoC ends straight above the lid, so close that the lid fills the frame
    exitPose(h) { const p = h.anchor.getWorldPosition(new THREE.Vector3()); return pose(p, new THREE.Vector3(.02, 1, .03), .05); },
    update(dt) { this.t = (this.t || 0) + dt; group.rotation.y = Math.sin(this.t * .25) * .015; group.rotation.x = Math.sin(this.t * .19) * .008; },
  };
  // ---- side 2 (16 Nov): the underside's parts, named by iFixit's chip ID (step 3). Their surfaces face down until the board is turned
  // over, so their normal is -y (placeDots hides a dot whose surface faces away; after the flip, -y points up).
  const down = new THREE.Vector3(0, -1, 0), SIDE1 = lvl.hotspots, flip = new THREE.Group(); flip.name = 'board-flip';
  const SIDE2 = [
    { id: 'mcu', label: 'STM32G071\nST · CORTEX-M0+', anchor: anchorOn(mem, .06), normal: down, zoom: 2.4, title: 'Microcontroller: STMicroelectronics STM32G071',
      text: 'A small Arm Cortex-M0+ microcontroller from STMicroelectronics, the company running this challenge. It sits beside the main processor; its exact job in the headset is not public.',
      facts: [['PART', 'STM32G071EB'], ['MAKER', 'STMICROELECTRONICS']] },
    { id: 'nand', label: 'STORAGE\n128 GB', anchor: anchorOn(mem, .06), normal: down, zoom: 3.0, title: 'Storage: 128 GB',
      text: 'SK hynix flash storage for the operating system, apps and games. A model file like k8 (44 KB) would be stored here, next to the apps, and loaded into the processor\'s memory to run.',
      facts: [['PART', 'HN8T05DEHKX073'], ['K8 FILE', '44,196 BYTES']] },
    { id: 'pmic', label: 'POWER\n4 QUALCOMM PMICS', anchor: anchorOn(mem, .06), normal: down, zoom: 2.4, title: 'Power management',
      text: 'Four Qualcomm power-management chips, under the tin frames, make the voltages the processor, memory and displays run on.',
      facts: [['PARTS', 'PMXR2230 · B · VE · VS']] },
  ];
  let side = 1, flipAnim = null;
  lvl.side = () => side;
  lvl.setSide = n => {
    if (n === side || busy) return; side = n;
    flipAnim = { t: 0, from: flip.rotation.z, to: n === 2 ? Math.PI : 0 };
    lvl.hotspots = n === 2 ? SIDE2 : SIDE1;
    mountDots(lvl); mountPanel(lvl); markOpen(null);
    document.querySelectorAll('#bswitch button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.s === n)));
    lvl.zoomed = false; showBack(); busy = true; flyTo(lvl.home(), 1300, ease.inOut).then(() => { busy = false; });
  };
  const baseUpdate = lvl.update;
  lvl.update = function (dt) {
    baseUpdate.call(this, dt);
    if (flipAnim) { flipAnim.t = Math.min(1, flipAnim.t + dt / 1.2); const e = ease.inOut(flipAnim.t);
      flip.rotation.z = flipAnim.from + (flipAnim.to - flipAnim.from) * e; if (flipAnim.t >= 1) flipAnim = null; }
  };
  // the replica: when it arrives, the placeholder's meshes are hidden and each hotspot moves to the replica's anchor for its part
  lvl.ready = makeGLTFLoader().loadAsync(BOARD_URL).then(gltf => {
    for (const c of group.children) c.visible = false;
    // the replica sits in a flip group: setSide(2) turns it over like a page (half a turn about z: left and right swap, the tab stays
    // at the top), as iFixit photographs side 2. board_build.py builds side 2 under the board, mirrored to match.
    flip.add(gltf.scene); group.add(flip);
    gltf.scene.updateMatrixWorld(true);
    for (const h of [...SIDE1, ...SIDE2]) { const a = gltf.scene.getObjectByName('anchor_' + h.id); if (a) h.anchor = a; }
    $('bswitch').hidden = false;
    // Material touch-ups for the browser's lighting (Blender's values were tuned for Cycles): the solder mask darker and less
    // brown, with a sharper clear coat so it picks up the softbox; metals a little smoother so they reflect it.
    gltf.scene.traverse(o => {
      if (!o.isMesh) return; const m = o.material, n = m.name;
      if (n === 'solder_mask') { m.color.set(0x15140f); m.roughness = .45; m.clearcoat = .8; m.clearcoatRoughness = .12; }
      else if (n === 'mask_over_copper') { m.color.set(0x1c1a14); m.clearcoat = .8; m.clearcoatRoughness = .12; }
      else if (n === 'shield_tin') { m.roughness = .38; }
      else if (n === 'standoff_steel') { m.roughness = .38; }                         // any smoother and it mirrors the dark floor
      else if (n === 'capacitor_can') { m.roughness = .4; }                          // smoother turned dark: it mirrored the floor
      else if (n === 'chip_epoxy') { m.color.set(0x161618); m.roughness = .78; }     // matt black, or the softbox washes it grey
      else if (n === 'soc_top') { m.color.set(0x0b0c0e); m.roughness = .18; m.metalness = .1; }
      else if (n === 'connector_plastic') { m.roughness = .7; }
      m.needsUpdate = true;
    });
    applyBoardTextures(THREE, gltf.scene, renderer);   // mask copper, dimpled tin, grain (board_textures.js)
    lvl.realBoard = true;
  }).catch(e => console.warn('board_q3.glb did not load; keeping the placeholder board', e));
  return lvl;
}

// ---------------------------------------------------------------- level C: the SoC die (procedural, placeholder)
// The die is one flat square whose look is a picture drawn in code on a 2D canvas (a "floorplan": CPU cores, GPU, cache, NPU,
// the ring of I/O pads), put on a metal-and-rainbow material so it catches the light like a real die shot. No downloaded image.
// Die units: the die runs from -5 to 5 in x and z; canvas pixel (px, py) = ((x + 5) / 10, (z + 5) / 10) * S.
// The die's picture, its block layout (DIE) and the NPU tile grid live in die_texture.js (16 Nov: redrawn in the style of Apple's
// die renders). ?die=pastel (default) or ?die=tactical picks the palette.
const SMALL_SCREEN = Math.min(screen.width, screen.height) <= 768;   // a phone in either orientation
const DIE_PALETTE = (new URLSearchParams(location.search).get('die') || 'pastel').toLowerCase() === 'tactical' ? 'tactical' : 'pastel';

// ---------------------------------------------------------------- the 10 ms data path on the die (16 Nov, Nic's pick)
// What happens on the chip once per head-pose sample (every 10 ms), slowed down (~650x) so it can be followed: a pulse of light travels
// the die's wiring channels from the I/O pads to the system cache (the recent history), into the k8 tile on the NPU (one run of the
// model), out to the GPU (it draws the frame for the predicted pose) and off to the displays. Each stop glows while the pulse
// waits there, and the caption (#flow) steps along. The route follows the bus channels drawn in die_texture.js; the stops are the
// blocks' centres. Like the floorplan, the route is illustrative: it shows the order of work, not measured wiring.
const CYCLE_MS = 10;                                               // one real cycle; the slowed view's length comes from the route
function dataPath(group, k8c) {
  const [kx, kz] = k8c, cache = [-2.8, .3], gpu = [1.95, -2.1];
  // the route: points [x, z], and the stops (index into the steps below) with how long the pulse waits there (s)
  const route = [
    { p: [-4.9, 1.7], step: 0, hold: .35 }, { p: [-2.8, 1.7] }, { p: cache, step: 1, hold: .55 }, { p: [-2.8, 1.7] },
    { p: [-.85, 1.7] }, { p: [-.85, .61] }, { p: [kx, .61] }, { p: [kx, kz], step: 2, hold: .8 }, { p: [kx, .61] },
    { p: [gpu[0], .61] }, { p: gpu, step: 3, hold: .55 }, { p: [gpu[0], -.4] }, { p: [4.9, -.4], step: 4, hold: .3 },
  ];
  const Y = .012, acid = new THREE.Color(0xdff140);
  // the track: thin flat strips along the route, faint, so the path reads before the pulse runs it
  const trackMat = new THREE.MeshBasicMaterial({ color: acid, transparent: true, opacity: .22, depthWrite: false });
  for (let i = 0; i < route.length - 1; i++) {
    const [x0, z0] = route[i].p, [x1, z1] = route[i + 1].p, len = Math.hypot(x1 - x0, z1 - z0); if (len < 1e-3) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len + .05, .05), trackMat);
    m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(z1 - z0, x1 - x0); m.position.set((x0 + x1) / 2, Y, (z0 + z1) / 2); group.add(m);
  }
  // the pulse: a bright core and a soft additive glow, plus a trail of fading dots behind it
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const q = c.getContext('2d');
    const gr = q.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(223,241,64,.8)'); gr.addColorStop(1, 'rgba(223,241,64,0)');
    q.fillStyle = gr; q.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const sprite = o => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: o }));
  const head = sprite(1); head.scale.setScalar(.7); group.add(head);
  const TRAIL = 18, trail = []; for (let i = 0; i < TRAIL; i++) { const t = sprite(.5 * (1 - i / TRAIL)); t.scale.setScalar(.32 * (1 - i / TRAIL * .6)); group.add(t); trail.push(t); }
  // the stops' glows: a flat additive square over each block, brightened while the pulse is there
  const stopBox = [[-4.95, 1.45, -4.55, 1.95], [-4.5, -.9, -1.1, 1.5], [kx - .26, kz - .23, kx + .26, kz + .23], [-.6, -4.5, 4.5, .3], [4.55, -.65, 4.95, -.15]];
  const glows = stopBox.map(([x0, z0, x1, z1]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ color: acid, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, Y + .002, (z0 + z1) / 2); group.add(m); return m;
  });
  // Timeline (16 Nov, second pass, Nic: "something feels off ... how the data light moves"). The first version moved at a constant
  // speed with hard stops, and its 4 s cycle was shorter than the route (5.2 s), so the light was cut off and snapped back. Now:
  // the route is measured by distance; the light travels stop to stop in legs, each eased (it speeds up leaving a block, glides,
  // and slows into the next), waits at each stop, and the cycle is as long as the route plus a short pause.
  const cum = [0]; for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i].p[0] - route[i - 1].p[0], route[i].p[1] - route[i - 1].p[1]));
  const pointAt = d => {                                           // the point at distance d along the route
    d = Math.max(0, Math.min(cum[cum.length - 1], d)); let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
    const f = cum[i] > cum[i - 1] ? (d - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0, a = route[i - 1].p, b = route[i].p;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  const SPEED = 7.5;                                               // average die units per second on a leg (slowed view)
  const ease = x => x < .5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  const stops = route.map((r, i) => ({ i, d: cum[i], step: r.step, hold: r.hold || 0 })).filter(r => r.step !== undefined);
  const plan = []; let t = 0;                                      // [{ t0, t1, d0, d1, step }]: a hold has d0 === d1
  stops.forEach((st, k) => {
    if (k) { const prev = stops[k - 1], dur = (st.d - prev.d) / SPEED; plan.push({ t0: t, t1: t + dur, d0: prev.d, d1: st.d, step: -1 }); t += dur; }
    plan.push({ t0: t, t1: t + st.hold, d0: st.d, d1: st.d, step: st.step }); t += st.hold;
  });
  const total = t + .7;                                            // the route, then a short pause before the next sample
  const slow = Math.round(total / (CYCLE_MS / 1000) / 50) * 50;    // shown this many times slower than real time
  const cap = document.querySelector('#flow p'); if (cap) cap.textContent = `One 10 ms cycle · shown ${slow}× slower`;
  const at = time => {                                             // distance along the route, speed (0..1) and the current step
    for (const seg of plan) if (time < seg.t1) {
      if (seg.d0 === seg.d1) return { d: seg.d0, v: 0, step: seg.step };
      const x = (time - seg.t0) / (seg.t1 - seg.t0), e = ease(x), v = 1 - Math.abs(2 * x - 1);   // v: 0 at the ends, 1 mid-leg
      return { d: seg.d0 + (seg.d1 - seg.d0) * e, v, step: -1, last: plan[plan.indexOf(seg) - 1].step };
    }
    return { d: cum[cum.length - 1], v: 0, step: -1, done: true };
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rows = [...document.querySelectorAll('#flow li')];
  let clock = 0, shown = -2;
  return {
    update(dt) {
      if (reduced) { head.visible = false; trail.forEach(s => (s.visible = false)); return; }   // the track and caption still explain it
      clock = (clock + dt) % total;
      const now = at(clock);
      head.visible = !now.done; const hp = pointAt(now.d); head.position.set(hp[0], Y + .02, hp[1]);
      head.scale.setScalar(.42 + .12 * now.v);
      // comet tail: points spaced along the route behind the light, stretched by its speed, gone when it stops
      const len = .16 * now.v;
      trail.forEach((s, i) => { const q = pointAt(now.d - (i + 1) * len); s.visible = !now.done && now.v > .02; s.position.set(q[0], Y + .015, q[1]); });
      glows.forEach((g, i) => { const target = now.step === i ? (i === 3 ? .14 : .26) : 0; g.material.opacity += (target - g.material.opacity) * Math.min(1, dt * 8); });
      // the caption: lit on the stop the light is at; while it travels, the stop it left stays lit
      const step = now.done ? -1 : now.step >= 0 ? now.step : (now.last ?? -1);
      if (step !== shown) { shown = step; rows.forEach((r, i) => r.classList.toggle('now', i === step)); }
    },
  };
}

function buildDie() {
  const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
  const tex = dieTexture(THREE, DIE_PALETTE, SMALL_SCREEN ? 2048 : 4096);   // 4096² is ~85 MB of GPU memory with mipmaps: too much for a phone
  // the package substrate the die sits on, then the die: a thin slab whose top face carries the floorplan
  const sub = new THREE.Mesh(new RoundedBoxGeometry(14, .4, 14, 3, .08), new THREE.MeshPhysicalMaterial({ color: 0x0d1210, roughness: .6 }));
  sub.position.y = -.28; group.add(sub);
  const side = new THREE.MeshPhysicalMaterial({ color: 0x2a2c31, metalness: .6, roughness: .4 });
  // The face glows a little on its own (emissive = the same picture), so it reads like a lit die render rather than a dark metal
  // plate, with a light thin-film sheen on top that shifts as the die turns.
  const face = new THREE.MeshPhysicalMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: DIE_PALETTE === 'tactical' ? .35 : .6,
    metalness: .15, roughness: .38, iridescence: .35, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 480] });
  const die = new THREE.Mesh(new THREE.BoxGeometry(10, .08, 10), [side, side, face, side, side, side]);
  die.position.y = -.04; group.add(die);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x0b0c0d, .2));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.2); key.position.set(-8, 4, -3); scene.add(key);     // grazing: brings out the iridescence
  const rim = new THREE.DirectionalLight(0xbfd2ff, 1.4); rim.position.set(7, 5, 6); scene.add(rim);
  addEnvironment(scene, 1.1);

  const up = new THREE.Vector3(0, 1, 0), homeDir = new THREE.Vector3(.18, 1, .55).normalize();
  const at = (x, z) => { const a = new THREE.Object3D(); a.position.set(x, .01, z); group.add(a); return a; };
  const mid = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const k8 = npuTile(...NPU_K8), k8c = mid(k8);
  const flow = dataPath(group, k8c);                                // the 10 ms cycle, animated (below)
  return {
    name: '03 / SOC DIE', scene, near: .005, far: 120, title: 'The processor', sub: 'LEVEL 03 · THE SILICON DIE, ILLUSTRATIVE',
    home: () => pose(new THREE.Vector3(0, 0, .2), homeDir, fitDist(11, 11)),
    subject: () => [die],
    hotspots: [
      { id: 'cpu', label: 'CPU\n6 CORES', anchor: at(...mid(DIE.cpu)), normal: up, zoom: 7, title: 'CPU',
        text: 'Six general-purpose Kryo cores: the operating system, the app and its logic. Each core is a mirrored layout, as on real dies.', facts: [['CORES', '6'], ['LAYOUT', 'ILLUSTRATIVE']] },
      { id: 'gpu', label: 'ADRENO GPU\nDRAWS THE VR SCENE', anchor: at(...mid(DIE.gpu)), normal: up, zoom: 8, title: 'GPU',
        text: 'Draws the scene, once for each eye. It is the part that needs to know where the head will be.', facts: [['NEEDS', 'THE PREDICTED POSE']] },
      { id: 'sram', label: 'SYSTEM CACHE\nON-CHIP MEMORY', anchor: at(...mid(DIE.sram)), normal: up, zoom: 6, title: 'System cache',
        text: 'Fast memory on the chip itself. The memory pattern on a die shot is this regular woven grid. k8\'s 7,555 weights and the past values its blocks wait on are small enough to keep here.',
        facts: [['K8 PARAMETERS', '7,555']] },
      { id: 'npu', label: 'HEXAGON NPU · K8\n44 KB · EVERY 10 MS', anchor: at(...k8c), normal: up, zoom: 3.2, dive: 'model', title: 'Neural processing unit (Hexagon)',
        text: 'A grid of multiply-add tiles built for small neural networks. One tile is plenty for k8. Go into the yellow tile to see the model run.',
        facts: [['ONE CALL', '≈78 µS, MEASURED ON A PC CPU'], ['CALLS', 'EVERY 10 MS']] },
    ],
    approach(h) { const p = h.anchor.getWorldPosition(new THREE.Vector3()); return pose(p, homeDir.clone().lerp(up, .5), h.zoom * fitScale()); },
    exitPose(h) { const p = h.anchor.getWorldPosition(new THREE.Vector3()); return pose(p, new THREE.Vector3(.02, 1, .03), .12); },
    update(dt) { this.t = (this.t || 0) + dt; group.rotation.y = Math.sin(this.t * .22) * .012; flow.update(dt); },
  };
}

// ---------------------------------------------------------------- level D: the model (the real viewer, unedited)
// viewer.mjs reads ~70 elements of the page it lives in, so instead of rebuilding that page here the prototype loads the real page
// (../index.html?explore=1) in a same-origin iframe and drives it through its own API, window.K8Viewer. CSS injected into the iframe
// hides the viewer's toolbars and panels (only the 3D canvas #scene and the label layer #labels stay) and makes its stage-name pills
// invisible but still laid out, so their screen positions become our dots. The iframe has its own WebGL context: two in total.
const STAGES = { input: 'INPUT\nQUATERNIONS IN', feat: 'FEATURES\n7 MEASUREMENTS', proj: 'PROJECTION\n7 → 32', mirror: 'MIRROR\nLEFT/RIGHT, SHARED WEIGHTS',
  blk0: 'BLOCK 1\nDILATION 1', blk1: 'BLOCK 2\nDILATION 8', blk2: 'BLOCK 3\nDILATION 47', head: 'READOUT\nNINE DIALS',
  traj: 'TRAJECTORY\nPRIOR + CORRECTION', out: 'FORECAST\n20 POSES, 200 MS' };
const HIDE_CHROME = `body > *:not(#scene):not(#labels) { display: none !important; }
  #labels .lbl { visibility: hidden !important; }
  html, body { background: #010101 !important; }`;

function buildModel() {
  const frame = document.createElement('iframe');
  frame.title = 'The k8 model in 3D';
  Object.assign(frame.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', border: '0', opacity: '0', visibility: 'hidden', background: '#010101' });
  glCanvas.after(frame);                                            // above our canvas, below the frozen frame and the dots
  let loading = null, V = null, doc = null;
  const lvl = {
    name: '04 / MODEL · 3D VIEWER', external: true, frame, layer: frame,
    enter() { V.setPlaying(true); }, leave() { V.setPlaying(false); }, reset() { V.showStep('whole'); }, unzoom() { V.showStep('whole'); },
    get viewer() { return V; },
    load() {
      if (loading) return loading;
      $('stat').textContent = 'loading model…';
      frame.src = '../index.html?explore=1';
      loading = new Promise(ok => frame.addEventListener('load', ok, { once: true })).then(async () => {
        const w = frame.contentWindow; doc = frame.contentDocument;
        const st = doc.createElement('style'); st.textContent = HIDE_CHROME; doc.head.append(st);
        for (let i = 0; i < 400 && !(w.K8Viewer && w.K8Viewer.ready); i++) await new Promise(r => setTimeout(r, 50));
        V = w.K8Viewer; await V.ready;
        V.showStep('whole'); V.setPlaying(false);
        $('stat').textContent = 'model ready';
      });
      return loading;
    },
    // dots: one per stage whose name pill the viewer is currently showing (it builds the model up stage by stage)
    hotspots: Object.entries(STAGES).map(([key, label]) => ({ id: key, label, stage: key,
      screen() {
        const el = doc && doc.querySelector(`#labels .lbl.stage[data-key="${key}"]`);
        if (!el || el.style.display === 'none') return null;
        const r = el.getBoundingClientRect(); if (!r.width) return null;
        return { x: r.left + 6, y: r.top + r.height / 2 };
      } })),
    update() {},
  };
  return lvl;
}

// ---------------------------------------------------------------- hotspots: DOM dots over projected anchors
const v = new THREE.Vector3(), n = new THREE.Vector3(), toCam = new THREE.Vector3();
let dots = [];
function mountDots(lvl) {
  dotsEl.replaceChildren(); dots = [];
  for (const h of lvl.hotspots) {
    const b = document.createElement('button'); b.className = 'dot'; b.type = 'button';
    b.setAttribute('aria-label', h.label.replace('\n', ', '));
    const s = document.createElement('span'); s.textContent = h.label; b.append(s);
    b.addEventListener('click', () => onHotspot(h));
    const hold = on => () => { lvl.hold = on; };                 // hovering or focusing a dot holds the scene still
    b.addEventListener('pointerenter', hold(true)); b.addEventListener('pointerleave', hold(false));
    b.addEventListener('focus', hold(true)); b.addEventListener('blur', hold(false));
    b.addEventListener('pointerenter', () => hilite(h.id, true)); b.addEventListener('pointerleave', () => hilite(h.id, false));
    dotsEl.append(b); dots.push({ h, b });
  }
}
function placeDots() {
  const lay = layout(), { W: w, H: hgt, model: m } = lay, pad = lay.form === 'phone' ? -22 : 24;   // phone: the whole 44 px dot inside the rect
  for (const { h, b } of dots) {
    let x, y, on;
    if (h.screen) {                                          // the model level: positions come from the viewer's own labels
      const p = h.screen(); on = !!p && !busy && !finaleRun; if (p) { x = p.x; y = p.y; }
    } else {
      h.anchor.updateWorldMatrix(true, false);
      h.anchor.getWorldPosition(v);
      n.copy(h.normal).transformDirection(h.anchor.matrixWorld);
      toCam.subVectors(camera.position, v).normalize();
      const facing = n.dot(toCam) > .15;                     // occlusion, cheap version: hide a dot whose surface turns away
      v.project(camera);
      on = facing && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && !busy && !finaleRun && !predict;
      x = (v.x * .5 + .5) * w; y = (-v.y * .5 + .5) * hgt;
    }
    if (on && (x < m.x - pad || x > m.x + m.w + pad || y < m.y - pad || y > m.y + m.h + pad)) on = false;   // under the panel: the row is there instead
    b.classList.toggle('hidden', !on);
    if (lay.form === 'phone' && x !== undefined) {                 // the label under the dot, slid so it stays on screen
      const s = b.firstChild, sw = s._w || (s._w = s.offsetWidth);
      s.style.setProperty('--lx', (Math.max(8, Math.min(w - 8 - sw, x - sw / 2)) - x).toFixed(0) + 'px');
    }
    if (x !== undefined) b.style.transform = `translate(${x}px, ${y}px)`;
  }
}

// ---------------------------------------------------------------- the match-cut
const levels = {}; let L = null, busy = false; const stack = [];
const T = () => { const k = finaleRun ? .6 : 1; return { dive: +$('tDive').value * k, cut: +$('tCut').value * k, flash: $('tFlash').checked }; };
let finaleRun = false, predict = false;   // the ending: climbing out (finaleRun), then the prediction view (predict)
const sleep = ms => new Promise(r => setTimeout(r, ms));

function setLevel(lvl) {
  L = lvl;
  if (!lvl.external) { camera.near = lvl.near; camera.far = lvl.far; camera.updateProjectionMatrix(); }
  $('lvl').textContent = lvl.name; mountDots(lvl); mountPanel(lvl);
  lvl.zoomed = false; showBack();
  $('tune').style.display = lvl.external ? 'none' : '';             // the dive timing sliders only matter between the 3D levels
  $('finale').classList.toggle('on', lvl === levels.model);         // the way to the ending, on the model level only
  $('mswitch').hidden = lvl !== levels.model;                       // A / B view switch: the model level only (Nic, 16 Nov)
  $('bswitch').classList.toggle('on', lvl === levels.board);       // the board's Side 1 / Side 2 switch: the board level only
  if (lvl === levels.die) levels.model.load();                     // start the model level while the reader looks at the die
  $('flow').classList.toggle('on', lvl === levels.die);             // the 10 ms cycle's caption, on the die level only
}

// Copy the frame that is about to disappear onto #freeze. Done straight after render() in the same task: the WebGL canvas
// still holds that frame then (no preserveDrawingBuffer needed). This is the call Fable flagged to test on iOS Safari.
// The black between levels (#fade, journey.html): fadeTo(opacity, ms) animates it and resolves when done.
const fadeEl = $('fade');
function fadeTo(o, ms, easing = 'ease-in-out') {
  const from = +getComputedStyle(fadeEl).opacity;
  const a = fadeEl.animate([{ opacity: from }, { opacity: o }], { duration: ms, easing, fill: 'forwards' });
  return a.finished.then(() => { fadeEl.style.opacity = o; a.cancel(); });
}
async function diveInto(h) {
  busy = true; const t = T(); const from = L, next = levels[h.dive];
  markOpen(null); hidePanel();
  if (from.external) {                                                // a DOM level into a DOM level: no camera, the layers do the move
    from.leave(); stack.push({ lvl: from, h }); await next.load();
    from.layer.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.8)' }], { duration: t.cut * 1.4, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' });
    setLevel(next); next.layer.style.visibility = 'visible';
    next.layer.animate([{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1)' }], { duration: t.cut * 1.6, easing: 'cubic-bezier(.2,0,.1,1)', fill: 'forwards' });
    if (t.flash) flash.animate([{ opacity: .9 }, { opacity: 0 }], { duration: t.cut * .8, easing: 'ease-out' });
    next.enter(); await sleep(t.cut * 1.6); from.layer.style.visibility = 'hidden';
    busy = false; return;
  }
  if (from.playing !== undefined) from.playing = false;               // hold the head still so the target does not move
  // Fade through black (16 Nov, Nic: the cuts still froze). ONE move from where the camera is to the surface; over its last part the
  // picture fades to black. The new level is swapped in while the screen is black (loading, shader set-up and its first frame happen
  // there, where a hitch cannot be seen), then fades in while its camera settles.
  const exit = from.exitPose(h), D = t.dive / 1000, vEnd = 2 * Math.log(cur.dist / exit.dist) / D;   // in2's end speed
  const FADE = Math.min(650, t.dive * .45);
  const fadeOut = sleep(t.dive - FADE).then(() => fadeTo(1, FADE, 'ease-in'));
  await flyTo(exit, t.dive, turnFirst, ease.in2); await fadeOut;
  stack.push({ lvl: from, h });
  const t0 = performance.now(); let swapMs = 0;
  if (next.external) {
    // into a model view (a DOM layer): it appears under the black, then the black lifts while the view settles from a little smaller.
    // Its data (a 3.7 MB trace) can take a while on a phone: "Loading…" shows on the black, and a failure climbs back out.
    const slow = setTimeout(() => fadeEl.classList.add('loading'), 200);
    const failed = await next.load().then(() => null, e => e);
    clearTimeout(slow); fadeEl.classList.remove('loading');
    if (failed) {
      console.warn('model view did not load', failed); stack.pop();
      $('fadeMsg').textContent = 'The model view did not load. Try again.'; fadeEl.classList.add('loading');
      await sleep(1600); fadeEl.classList.remove('loading');
      mountPanel(from); if (from.playing !== undefined) from.playing = true;
      fadeTo(0, 600, 'ease-out'); await flyTo(from.home(), 900, ease.out);
      $('fadeMsg').textContent = 'Loading…'; busy = false; return;
    }
    setLevel(next); glCanvas.style.visibility = 'hidden';
    next.layer.getAnimations().forEach(a => a.cancel()); next.layer.style.visibility = 'visible'; next.layer.style.opacity = 1;
    next.layer.animate([{ transform: 'scale(.95)' }, { transform: 'scale(1)' }], { duration: 1000, easing: 'cubic-bezier(.2,0,.1,1)' });
    next.enter(); swapMs = performance.now() - t0;
    await sleep(40); await fadeTo(0, 700, 'ease-out');
  } else {
    await renderer.compileAsync(next.scene, camera);                  // no shader-compile stall on the first frame of the new level
    setLevel(next);
    // start the new level far enough back that its opening zoom speed equals the speed we hit the surface at, then ease to rest
    const home = next.home(), Tarr = 1.2, k = matchK(vEnd, Tarr, 3);
    Object.assign(cur, pose(home.target, home.dir, home.dist * k));
    applyPose(cur); renderer.render(L.scene, camera); swapMs = performance.now() - t0; await sleep(40);   // its first frame, drawn in the dark
    const fadeIn = fadeTo(0, 700, 'ease-out');
    await flyTo(home, Tarr * 1000, ease.out); await fadeIn;
  }
  $('stat').textContent = `swap ${swapMs.toFixed(0)} ms, in the dark`;
  busy = false;
}

async function backOut() {
  if (busy || !stack.length) return;
  busy = true; const t = T(); const { lvl: prev, h } = stack.pop(), from = L;
  const FADE = Math.min(600, t.cut);
  if (from.external) {
    if (prev.external) {                                              // back into a DOM level (model → data): it comes back down from big
      from.leave();
      from.layer.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.55)' }], { duration: t.cut * 1.2, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' });
      setTimeout(() => { from.layer.style.visibility = 'hidden'; from.reset(); }, t.cut * 1.2);
      setLevel(prev); prev.layer.style.visibility = 'visible';
      prev.layer.animate([{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: t.cut * 1.4, easing: 'cubic-bezier(.2,0,.1,1)', fill: 'forwards' });
      prev.enter(); await sleep(t.cut * 1.4); busy = false; return;
    }
    // out of a model view: the view shrinks a little while the black comes down, then the 3D level comes back underneath
    from.layer.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94)' }], { duration: FADE, easing: 'ease-in', fill: 'forwards' });
    await fadeTo(1, FADE, 'ease-in');
    from.leave(); from.layer.getAnimations().forEach(a => a.cancel()); from.layer.style.visibility = 'hidden'; from.layer.style.opacity = ''; from.reset();
    glCanvas.style.visibility = '';
  } else {
    // pull away with speed building, to exactly the speed the previous level's pull-out will start at (out2: 2 * span / T), fading out
    const span = Math.log(prev.home().dist / prev.exitPose(h).dist), vStart = 2 * span / (t.dive / 1000);
    const fadeOut = sleep(Math.max(0, t.cut - FADE)).then(() => fadeTo(1, FADE, 'ease-in'));
    await flyTo(pose(cur.target, cur.dir, cur.dist * matchK(vStart, t.cut / 1000, 2)), t.cut, ease.in2); await fadeOut;
  }
  await renderer.compileAsync(prev.scene, camera);
  setLevel(prev);
  Object.assign(cur, prev.exitPose(h));                                // start right at the surface we dived through and pull back out
  applyPose(cur); renderer.render(L.scene, camera); await sleep(40);   // its first frame, drawn in the dark
  const fadeIn = fadeTo(0, 700, 'ease-out');
  await flyTo(prev.home(), t.dive, ease.out2, ease.out2); await fadeIn;
  if (prev.playing !== undefined) prev.playing = true;
  busy = false;
}

// fromRow: chosen in the panel (or with its arrows). A dive point's DOT dives straight in; its ROW only zooms and opens, and the
// row's "Dive in" button does the dive, so the reader can read first.
async function onHotspot(h, fromRow = false) {
  if (busy) return;
  if (h.stage) { L.viewer.showStep(h.stage); L.zoomed = true; showBack(); return; }   // the model level: the viewer flies there itself
  // a dive is one continuous move (see diveInto). On a phone the first tap only selects it, so the reader sees what it is first.
  if (h.dive && !fromRow && (layout().form !== 'phone' || openId === h.id)) return diveInto(h);
  if (L.playing !== undefined) L.playing = false;                    // the head holds still while one of its parts is shown
  markOpen(h.id);
  busy = true; L.zoomed = true; showBack(); await flyTo(L.approach(h), 1100); busy = false;   // zoom to the part's own view
}

// ---------------------------------------------------------------- the panel (3D levels): numbered rows, one per hotspot
function mountPanel(lvl) {
  panelOn = !lvl.external && lvl.hotspots.length > 0 && !finaleRun;   // no panel flashing up while the ending climbs out
  $('panel').classList.toggle('off', !panelOn); $('pnav').classList.toggle('off', !panelOn); $('panel').classList.remove('is-ending');
  openId = null;
  credit(lvl);
  if (!panelOn) return;
  $('psub').textContent = lvl.sub || ''; $('ptitle').textContent = lvl.title || '';
  const rows = $('rows'); rows.replaceChildren();
  lvl.hotspots.forEach((h, i) => {
    const r = document.createElement('div'); r.className = 'prow'; r.dataset.id = h.id;
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-expanded', 'false');
    b.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}<i>/${String(lvl.hotspots.length).padStart(2, '0')}</i></span><span></span><span class="pm">+</span>`;
    b.children[1].textContent = h.title || h.label.split('\n')[0];
    const body = document.createElement('div'); body.className = 'body';
    const pp = document.createElement('p'); pp.textContent = h.text || ''; body.append(pp);
    if (h.facts) { const f = document.createElement('div'); f.className = 'facts';
      for (const [k, v] of h.facts) { const d = document.createElement('div'); d.append(k + ' · '); const bb = document.createElement('b'); bb.textContent = v; d.append(bb); f.append(d); }
      body.append(f); }
    if (h.dive) { const d = document.createElement('button'); d.type = 'button'; d.className = 'divebtn'; d.textContent = 'DIVE IN  →';
      d.addEventListener('click', () => { if (!busy) diveInto(h); }); body.append(d); }
    b.addEventListener('click', () => { if (openId === h.id) back(); else onHotspot(h, true); });
    r.addEventListener('pointerenter', () => hilite(h.id, true)); r.addEventListener('pointerleave', () => hilite(h.id, false));
    r.append(b, body); rows.append(r);
  });
}
// CC BY 4.0 credit for the headset model, under the headset level's rows (the story page also lists it in its credits)
function credit(lvl) {
  const old = document.getElementById('pcredit'); if (old) old.remove();
  if (lvl !== levels.head) return;
  const c = document.createElement('p'); c.id = 'pcredit'; c.className = 'pcredit';
  c.innerHTML = 'Headset: "<a href="https://sketchfab.com/3d-models/meta-quest-3-65a813833dc04eeeb7d33bdca58c184c" target="_blank" rel="noopener">Meta Quest 3</a>" by <a href="https://sketchfab.com/ElinHohler" target="_blank" rel="noopener">Elin</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, modified (logo removed, fitted). Not affiliated with Meta.';
  $('panel').append(c);
}
function markOpen(id) {
  openId = id;
  // the phone's one-item panel: progress rule, the open dot's label, and → becoming DIVE IN on a dive point
  const H = L ? L.hotspots : [], i = H.findIndex(h => h.id === id), dive = i >= 0 && !!H[i].dive && layout().form === 'phone';
  $('panel').classList.toggle('has-open', i >= 0); $('prule').style.setProperty('--p', i < 0 ? 0 : (i + 1) / H.length);
  dots.forEach(d => d.b.classList.toggle('on', d.h.id === id));
  $('pnav').classList.toggle('dive', dive); $('pnav').lastElementChild.setAttribute('aria-label', dive ? 'Dive in' : 'Next part');
  setMore(false);
  document.querySelectorAll('.prow').forEach(r => { const on = r.dataset.id === id; r.classList.toggle('open', on);
    r.querySelector('button').setAttribute('aria-expanded', on); r.querySelector('.pm').textContent = on ? '—' : '+'; });
}
function hilite(id, on) {                                            // a dot and its row light up together
  const r = document.querySelector(`.prow[data-id="${id}"]`); if (r) r.classList.toggle('hl', on);
  const d = dots.find(x => x.h.id === id); if (d) d.b.classList.toggle('hl', on);
}
function hidePanel() { panelOn = false; $('panel').classList.add('off'); $('pnav').classList.add('off'); }
// phone: the description is clamped to three lines; MORE (or a tap on it) opens the whole text and the facts
function setMore(on) { document.body.classList.toggle('more', on); $('pmore').textContent = on ? 'LESS —' : 'MORE +'; $('pmore').setAttribute('aria-expanded', on); }
$('pmore').addEventListener('click', () => setMore(!document.body.classList.contains('more')));
$('rows').addEventListener('click', e => { if (layout().form === 'phone' && e.target.closest('.body p, .ending p')) setMore(!document.body.classList.contains('more')); });
document.querySelectorAll('#pnav .circ').forEach(b => b.addEventListener('click', () => {
  if (!panelOn || busy) return;
  const H = L.hotspots, n = H.length, d = +b.dataset.d, i = H.findIndex(h => h.id === openId);
  if (d > 0 && i >= 0 && H[i].dive && layout().form === 'phone') return diveInto(H[i]);   // phone: → on a dive point dives
  const from = i < 0 ? (d > 0 ? -1 : 0) : i;                          // nothing open: → starts at 01, ← at the last
  onHotspot(H[((from + d) % n + n) % n], true);
}));

// Back is one step of history at a time: zoomed onto a hotspot, it first returns to this level's overview; only from the overview
// does it leave the level. (Before, Back always left the level, so from a hotspot it felt like jumping two steps.)
function showBack() {
  // at the top of the journey: ✕ closes the interactive view. On a phone ✕ is its own button (#close) on every level, so #back is only ←.
  const close = HERO && mode === 'live' && !stack.length && !L.zoomed && layout().form !== 'phone';
  $('close').classList.toggle('on', HERO && mode === 'live');
  $('back').style.display = stack.length || L.zoomed || close ? 'block' : 'none';
  $('back').textContent = close ? '✕' : '←'; $('back').setAttribute('aria-label', close ? 'Close the interactive view' : 'Back out one level');
}
async function back() {
  if (busy) return;
  if (predict) return closeView();                                  // the ending is the last view: ✕ closes the journey
  if (HERO && mode === 'live' && !stack.length && !L.zoomed) return closeView();
  if (L.zoomed) {
    L.zoomed = false; showBack(); markOpen(null);
    if (L.external) return L.unzoom();
    if (L.playing !== undefined) L.playing = true;
    busy = true; await flyTo(L.home(), 900); busy = false; return;
  }
  return backOut();
}
$('back').addEventListener('click', back);

// ---------------------------------------------------------------- the ending
// From the model level: climb back out through every level in one go (the same speed-matched back-outs, 40% faster), then land on
// the head with k8's prediction showing: the ghost headset 200 ms ahead, both pointers and the arc between them, and a live readout.
// SEE IT PREDICT (16 Nov, Nic: "instead of zooming out, it just pushes to the left, and the head comes in from the right"). The
// head level is made ready first, already in its prediction pose and drawn once; then the model view slides out to the left while the
// head's canvas slides in from the right and the panel follows. No climb back through the board and the die.
async function finale() {
  if (busy || L !== levels.model) return;
  busy = true; finaleRun = true; $('finale').classList.remove('on');
  const from = L, H = levels.head, E = 'cubic-bezier(.65,0,.35,1)', MS = 1100;
  stack.length = 0;
  await renderer.compileAsync(H.scene, camera);
  predict = true; H.setPredict(true); H.playing = true;
  setLevel(H); markOpen(null);
  finaleRun = false; mountEnding();                                  // before the pose: on a phone the panel decides where the head goes
  const p = H.predictPose(); Object.assign(cur, pose(p.target, p.dir, p.dist * 1.12));   // a touch further out, to settle in during the push
  applyPose(cur); renderer.render(L.scene, camera);
  glCanvas.style.visibility = '';
  from.leave(); from.layer.getAnimations().forEach(a => a.cancel()); from.layer.style.opacity = 1;
  const out = from.layer.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], { duration: MS, easing: E, fill: 'forwards' });
  glCanvas.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: MS, easing: E });
  $('panel').animate([{ transform: 'translateX(40%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: MS * .8, delay: MS * .35, easing: 'cubic-bezier(.2,0,.1,1)', fill: 'backwards' });
  flyTo(p, MS + 400, ease.out);
  await out.finished;
  from.layer.style.visibility = 'hidden'; from.layer.style.opacity = ''; out.cancel(); from.reset();
  busy = false; showBack();
}
function mountEnding() {
  panelOn = true; $('panel').classList.remove('off'); $('panel').classList.add('is-ending'); $('pnav').classList.add('off');
  $('psub').textContent = 'LEVEL 01 · 200 MS AHEAD'; $('ptitle').textContent = 'The prediction';
  const rows = $('rows'); rows.replaceChildren();
  const d = document.createElement('div'); d.className = 'ending';
  const p1 = document.createElement('p'); p1.textContent = 'The solid headset is a real player\'s head: 12 s of Beat Saber from the public QuestSet dataset (CC BY 4.0), which k8 never trained on. The yellow ghost is where k8 says it will be 200 ms from now, drawn before it gets there. The arc between the two pointers is the error.';
  const p2 = document.createElement('p'); p2.className = 'dim'; p2.textContent = 'The error shown is for the prediction that has just come due, the one made 200 ms ago.';
  const ro = document.createElement('div'); ro.className = 'facts ro';
  ro.innerHTML = '<div>ERROR NOW · <b data-r="err">–</b></div><div>IF THE HEAD HELD STILL · <b data-r="hold">–</b></div><div>TEST-SET MEAN, 1,049 PLAYERS · <b>4.50°</b></div>';
  const again = document.createElement('button'); again.type = 'button'; again.className = 'divebtn'; again.textContent = 'GO INSIDE AGAIN  →';
  again.addEventListener('click', exitPredict);
  d.append(p1, ro, p2, again); rows.append(d);
}
async function exitPredict() {
  if (busy) return;
  predict = false; levels.head.setPredict(false); mountPanel(levels.head);
  busy = true; await flyTo(levels.head.home(), 1100, ease.inOut); busy = false; showBack();
}
let roAt = 0;
function updateReadout(now) {
  if (!predict || now - roAt < 250) return; roAt = now;                // 4 times a second, like the story's hero
  const r = levels.head.readout(); if (!r) return;
  const e = document.querySelector('.ro [data-r="err"]'), h = document.querySelector('.ro [data-r="hold"]');
  if (e) e.textContent = r.err.toFixed(1) + '°'; if (h) h.textContent = r.hold.toFixed(1) + '°';
}
$('finale').addEventListener('click', finale);
addEventListener('k8:finale', finale);                              // the Forecast stage's own button in model views A and B

// ---------------------------------------------------------------- TAKE CONTROL: the opening state, and launching / closing the view
// mode 'hero': the type and the Launch button over a transparent canvas; no panel, dots, HUD or sliders (CSS: body.hero).
// mode 'live': the interactive journey. Skipped with ?nohero or #model.
// ?embed=1: this page runs inside the story page's TAKE CONTROL section (an iframe). The story page draws the type, labels and Launch
// button itself; this page only draws the live head on a see-through background, launches when the story page says so, and tells
// it 'ready' (loaded) and 'closed' (✕ pressed). Embedded, ✕ always works, even after a #model reload, so the reader can't get stuck.
const EMBED = new URLSearchParams(location.search).has('embed');
if (!new URLSearchParams(location.search).has('tune')) document.documentElement.classList.add('notune');   // the dive-timing sliders are a prototype tool: ?tune shows them
if (EMBED) document.documentElement.classList.add('embed');
const toPage = msg => { if (EMBED && parent !== window) parent.postMessage({ k8journey: msg }, location.origin); };
const HERO = !new URLSearchParams(location.search).has('nohero') && (location.hash !== '#model' || EMBED);
let mode = 'live';
// 'pause' / 'play' from the story page (21 Nov 2026): no frames at all while the TAKE CONTROL section is off-screen
let looping = true, last = performance.now();
function play(on) { if (on === looping) return; looping = on; last = performance.now(); renderer.setAnimationLoop(on ? loop : null); }
function enterHero() {
  mode = 'hero'; document.body.classList.add('hero'); hidePanel(); markOpen(null);
  renderer.setClearColor(0x010101, 0);                               // see-through: the type behind the head shows
  if (levels.head) levels.head.playing = true;
}
async function launch() {
  if (busy || mode !== 'hero') return;
  play(true);
  busy = true; mode = 'live'; document.body.classList.remove('hero');   // the type and labels fade out (CSS, .6 s)
  setTimeout(() => { if (mode === 'live') renderer.setClearColor(0x010101, 1); }, 650);   // opaque again once the type has gone
  mountPanel(levels.head);                                           // the panel slides in; the loop eases the picture left
  await flyTo(levels.head.home(), 1700, ease.inOut);                 // the camera pans in to the interactive framing
  busy = false; showBack(); $('back').focus({ preventScroll: true });
}
async function closeView() {
  while (busy) await sleep(50);                                     // the page's Back can arrive mid-dive: let the move finish first
  busy = true; markOpen(null); hidePanel(); showBack();
  if (predict) { predict = false; levels.head.setPredict(false); }
  if (L !== levels.head) {                                          // from deeper in (phone ✕, the page's Back): through black to the head
    await fadeTo(1, 450, 'ease-in');
    if (L.external) { L.leave(); L.layer.getAnimations().forEach(a => a.cancel()); L.layer.style.visibility = 'hidden'; L.layer.style.opacity = ''; L.reset(); glCanvas.style.visibility = ''; }
    stack.length = 0; setLevel(levels.head); hidePanel(); markOpen(null);
    Object.assign(cur, levels.head.home()); applyPose(cur); renderer.render(L.scene, camera);
    fadeTo(0, 600, 'ease-out');
  }
  levels.head.zoomed = false;
  await flyTo(levels.head.heroPose(performance.now() / 1000, face), 1400, ease.inOut);
  enterHero(); busy = false; showBack();
  if (EMBED) toPage('closed'); else $('launch').focus({ preventScroll: true });
}
let closing = false;
function requestClose() {                                           // ✕ on a phone, and the page's 'close' (its Back gesture)
  if (mode !== 'live') { toPage('closed'); return; }
  if (closing) return; closing = true; closeView().finally(() => { closing = false; });
}
$('close').addEventListener('click', requestClose);
$('launch').addEventListener('click', launch);
// the story page's messages: 'launch', and { k8journey: 'face', p } (how far the TAKE CONTROL section has scrolled into view)
let face = 0, faceTo = EMBED ? 0 : 1;                              // standalone: already facing the reader
addEventListener('message', e => { if (e.origin !== location.origin || !e.data) return;
  const m = e.data.k8journey;
  if (m === 'launch') { play(true); launch(); }
  else if (m === 'face') faceTo = Math.max(0, Math.min(1, +e.data.p || 0));
  else if (m === 'pause') play(false);                             // the TAKE CONTROL section is off-screen: no frames, state kept
  else if (m === 'play') play(true);
  else if (m === 'close') requestClose(); });
addEventListener('keydown', e => { if (e.key === 'Escape') back(); });

// ---------------------------------------------------------------- start
resize();
levels.head = buildHeadset();
levels.board = buildBoard();
levels.die = buildDie();
// the model level's own zoom (A and B handle their clicks themselves) feeds the same Back history as the 3D levels
const ctx = { setZoomed(z) { if (L && L.external) { L.zoomed = z; showBack(); } },
  dive(key) { if (!busy) diveInto({ id: 'into-' + key, dive: key }); } };   // a DOM level's own "go deeper" button
// (16 Nov) The data level (datalevel.js, a live bit wall) was tried between the die and the model and dropped: Nic found it unclear.
// The data stays explained by the story's own data section; datalevel.js is kept only for reference and is not loaded.
levels.model = MODEL === 'b' ? makeB(ctx) : MODEL === '3d' ? buildModel() : makeA(ctx);
if (levels.model.layer !== levels.model.frame) glCanvas.after(levels.model.layer);   // A and B: a DOM layer where the iframe would sit
setLevel(levels.head);
Object.assign(cur, levels.head.home());
if (HERO && location.hash !== '#model') { enterHero(); face = faceTo; Object.assign(cur, levels.head.heroPose(0, face)); }
await levels.board.ready;   // the replica board (or, if it failed, the placeholder) before compiling its shaders
await renderer.compileAsync(levels.board.scene, camera);
await renderer.compileAsync(levels.die.scene, camera);
// Warm-up (16 Nov, freeze fix): draw the board and the die once, off-screen, while the page loads. The first real frame of a level
// otherwise has to upload its textures to the GPU (the die's 4096 px picture, the board's mask maps), which stalled the dive in.
// All three 3D levels are drawn here, so the first dive's swap (in the dark, see diveInto) has as little left to do as possible.
{ const rt = new THREE.WebGLRenderTarget(64, 64), keep = { ...cur };
  for (const lv of [levels.head, levels.board, levels.die]) { Object.assign(cur, lv.home()); applyPose(cur); renderer.setRenderTarget(rt); renderer.render(lv.scene, camera); }
  renderer.setRenderTarget(null); rt.dispose(); Object.assign(cur, keep); applyPose(cur); }

// #model: start on the model level, as if the reader had dived head → board → die → NPU (Back still climbs out level by level)
if (location.hash === '#model') {
  const target = levels.model;
  await target.load();
  for (const [lv, id] of [[levels.head, 'proc'], [levels.board, 'soc'], [levels.die, 'npu']]) stack.push({ lvl: lv, h: lv.hotspots.find(h => h.id === id) });
  levels.head.playing = false;
  setLevel(target); target.layer.style.visibility = 'visible'; target.layer.style.opacity = '1'; target.enter();
}
// the switch in the top bar: reload with the other model view, landing on the model level if that is where the reader is
document.querySelectorAll('#bswitch button').forEach(b => b.addEventListener('click', () => levels.board.setSide && levels.board.setSide(+b.dataset.s)));
document.querySelectorAll('#mswitch button').forEach(b => {
  b.setAttribute('aria-pressed', b.dataset.m === MODEL);
  b.addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('model', b.dataset.m); u.hash = L.external ? 'model' : '';
    location.href = u.href; if (u.hash && u.pathname + u.search === location.pathname + location.search) location.reload(); });
});

renderer.setAnimationLoop(looping ? loop : null);
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  updateReadout(now);
  if (tween) tween.step(now);
  else if (mode === 'hero') {                                      // the TAKE CONTROL view: slow drift, turning to face the reader with scroll
    face += (faceTo - face) * Math.min(1, dt * 4);                  // eased, so a fast scroll still turns the head smoothly
    Object.assign(cur, levels.head.heroPose(now / 1000, face));
  }
  // off-centre framing: the camera's centre eases onto the model rect's centre (wide: left of the panel; phone: below it)
  const want = offsetFor(layout());
  if (Math.abs(want.x - off.x) > .5 || Math.abs(want.y - off.y) > .5) { const a = Math.min(1, dt * 5); setOffset(off.x + (want.x - off.x) * a, off.y + (want.y - off.y) * a); }
  if (reframe && !busy && !tween && mode === 'live' && !L.external) {   // after a resize or rotation: the current view, fitted again
    reframe = false; const h = L.zoomed && L.hotspots.find(x => x.id === openId);
    Object.assign(cur, predict ? levels.head.predictPose() : h ? L.approach(h) : L.home());
  }
  if (!L.external) {                                               // while the viewer is up our own canvas is covered: draw nothing
    L.update(dt);
    applyPose(cur);
    renderer.render(L.scene, camera);
  }
  placeDots();
}
toPage('ready');
// for poking at in the console, and for the phone checks (tools: the subject's projected box against the model rect)
window.DIVE = { levels, camera, cur, renderer, layout, get level() { return L; }, get busy() { return busy; },
  subjectBox() {
    if (!L || L.external || !L.subject) return null;
    const p = new THREE.Vector3(), { W, H, model: m } = layout();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;               // every vertex projected (skinned ones posed): the silhouette's box
    for (const r of L.subject()) r.traverseVisible(o => { if (!o.isMesh) return; const n = o.geometry.attributes.position.count;
      for (let i = 0; i < n; i += Math.max(1, n >> 14)) { o.getVertexPosition(i, p); p.applyMatrix4(o.matrixWorld).project(camera);
        const x = (p.x * .5 + .5) * W, y = (-p.y * .5 + .5) * H; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
    const r = v => Math.round(v);
    return { box: [r(x0), r(y0), r(x1), r(y1)], rect: [r(m.x), r(m.y), r(m.x + m.w), r(m.y + m.h)],
      inside: x0 >= m.x - 2 && y0 >= m.y - 2 && x1 <= m.x + m.w + 2 && y1 <= m.y + m.h + 2 };
  } };
