import * as THREE from 'three';
import { Llama, PALETTES, HATS, CROWN, BLANKETS } from './llama.js';
import { Course, COURSES } from './course.js';
import { Sfx } from './audio.js';
import { clamp, damp, lerp, smoothstep, wrapAngle } from './util.js';

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const HORIZON = new THREE.Color('#d9e8ef');
scene.fog = new THREE.Fog(HORIZON, 80, 650);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 900);

// sky dome gradient
{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#3b82d4') }, mid: { value: new THREE.Color('#a4cdee') }, bottom: { value: HORIZON } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.6, h)) : mix(mid, bottom, smoothstep(0.0, 0.25, -h)); gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  scene.add(sky);
  scene.userData.sky = sky;
}

scene.add(new THREE.HemisphereLight('#e2f0ff', '#8aa86a', 1.05));
const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SC = 22;
Object.assign(sun.shadow.camera, { left: -SC, right: SC, top: SC, bottom: -SC, near: 1, far: 120 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const COURSE_KEY = 'lurching-llama-course';
let courseIdx = 0;
try { courseIdx = (((parseInt(localStorage.getItem(COURSE_KEY), 10) || 0) % COURSES.length) + COURSES.length) % COURSES.length; } catch { /* storage unavailable */ }
let course = new Course(scene, COURSES[courseIdx].id);
const sfx = new Sfx();

// ---------------------------------------------------------------------------
// Llamas
// ---------------------------------------------------------------------------

const BOT_NAMES = ['Dolly Llama', 'Sir Fluffington', 'Kevin', 'Como Se Llama', 'Barb', 'Llarry', 'Fuzz Aldrin'];
const llamas = [];
let player;

const dust = makeDust();
function hookEvents(ll) {
  ll.on('onStep', (l, p, speed) => { if (speed > 3 && Math.random() < 0.5) dust.puff(p, 0.08 + speed * 0.016); if (l.isPlayer && speed > 0.5) sfx.step(); });
  ll.on('onLand', (l, v) => {
    if (v > 4) for (const leg of l.legs) dust.puff(leg.foot, 0.22);
    if (l.isPlayer) { sfx.land(v); camBump = Math.min(0.35, v * 0.025); }
  });
  ll.on('onJump', (l) => { if (l.isPlayer) sfx.jump(); });
  ll.on('onBounce', (l) => { if (l.isPlayer || l.pos.distanceTo(player.pos) < 10) sfx.boing(); if (l.isPlayer) toast('BOING!', '#f2c14e'); });
  ll.on('onTopple', (l) => {
    if (l.isPlayer && !game.mashHinted) { game.mashHinted = true; setTimeout(() => showHint('Knocked over? <b>Mash jump</b> to get up faster!'), 600); }
    if (l.isPlayer) { sfx.bleat(1); toast(['WHOOPS!', 'TOPPLED!', 'NECK FAIL!', 'TIMBERRR!'][Math.floor(Math.random() * 4)], '#e4572e'); shake = 0.5; }
    else if (l.pos.distanceTo(player.pos) < 14) sfx.bleat(0.85 + Math.random() * 0.4);
  });
  ll.on('onHit', (l, sev) => {
    if (!l.isPlayer) return;
    sfx.bonk();
    shake = Math.max(shake, sev * 0.35);
    if (sev >= 1 && !reducedMotion) hitStop = 0.28; // brief slow-mo on a big wallop
  });
}

function spawnPoint(i) { return new THREE.Vector3(-7 + i * 2, 0.3, -5 - (i % 2) * 1.5); }

function createLlamas() {
  player = new Llama(scene, course, { palette: PALETTES[0], isPlayer: true, name: 'You', spawn: spawnPoint(3) });
  llamas.push(player);
  const order = [0, 1, 2, 4, 5, 6, 7];
  BOT_NAMES.forEach((name, i) => {
    const b = new Llama(scene, course, { palette: PALETTES[(i + 1) % PALETTES.length], name, spawn: spawnPoint(order[i]) });
    const baseSkill = 0.78 + Math.random() * 0.2;
    b.bot = { wp: 0, lane: (Math.random() - 0.5) * 2, baseSkill, skill: baseSkill, think: 0, hold: false, stuck: 0, lastZ: 0, pause: 0 };
    llamas.push(b);
  });
  for (const l of llamas) { l.checkpoint = 0; l.finished = false; l.finishTime = 0; hookEvents(l); }
}
createLlamas();
// The llamas in the current race (a Show's final only has the qualifiers).
let racers = llamas.slice();

// --- personal-best ghost: record the player's run, replay the best one translucently
const GHOST_DT = 0.05;
const ghost = new Llama(scene, course, { palette: PALETTES[0], name: 'Ghost', spawn: spawnPoint(3) });
ghost.makeGhost();
let ghostRun = null;      // frames of the best run on this course
let recording = [];
let recordT = 0;
const ghostKey = () => `lurching-llama-ghost2-${course.info.id}`;
function loadGhost() {
  try { ghostRun = JSON.parse(localStorage.getItem(ghostKey()) || 'null'); } catch { ghostRun = null; }
  const valid = Array.isArray(ghostRun) && ghostRun.length > 1 && ghostRun.every((f) => Array.isArray(f) && f.length === 6 && f.every(Number.isFinite));
  if (!valid) ghostRun = null;
  ghost.course = course;
  ghost.respawn(spawnPoint(3), 0);
}
function saveGhost() {
  try { localStorage.setItem(ghostKey(), JSON.stringify(recording)); } catch {
    try { localStorage.removeItem(ghostKey()); } catch { /* storage unavailable */ } // don't replay an older, slower run
  }
  ghostRun = recording;
}
function recordFrame(dt) {
  recordT += dt;
  if (recordT < GHOST_DT) return;
  recordT -= GHOST_DT;
  const p = player;
  recording.push([p.pos.x, p.pos.y, p.pos.z, p.lean.x, p.lean.y, p.grounded ? 1 : 0].map((v) => Math.round(v * 100) / 100));
}
function updateGhost(dt) {
  const show = !!ghostRun && game.mode === 'single' && (game.state === 'racing' || game.state === 'countdown');
  ghost.root.visible = ghost.limbs.visible = ghost.neckTube.mesh.visible = show;
  if (!show) return;
  const f = game.raceT / GHOST_DT;
  const i = Math.min(Math.floor(f), ghostRun.length - 1), j = Math.min(i + 1, ghostRun.length - 1), u = f - Math.floor(f);
  const a = ghostRun[i], b = ghostRun[j];
  const L = (k) => a[k] + (b[k] - a[k]) * u;
  ghost.ghostStep(dt, game.t, L(0), L(1), L(2), L(3), L(4), a[5]);
}

// "YOU" marker over the player
const marker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 16), new THREE.MeshBasicMaterial({ color: '#f2c14e' }));
marker.rotation.x = Math.PI;
scene.add(marker);

// name tags over the other llamas
const tagLayer = document.getElementById('tags');
function makeTag(l) {
  const el = document.createElement('div');
  el.className = 'tag-name';
  el.textContent = l.name;
  el.style.setProperty('--c', l.design.colors[0]);
  tagLayer.appendChild(el);
  l.tagEl = el;
}
llamas.forEach((l) => { if (!l.isPlayer) makeTag(l); });
makeTag(ghost);
ghost.tagEl.textContent = 'Your best';
ghost.tagEl.classList.add('ghost-tag');

// one-time contextual hints as you reach each obstacle
let hintIdx = 0;
function showHint(html) {
  const el = $('hint');
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(showHint.t);
  showHint.t = setTimeout(() => el.classList.remove('show'), 4500);
}

// --- pick your llama's look (bots take the remaining styles)
const STYLE_KEY = 'lurching-llama-style';
let styleIdx = 0;
try { styleIdx = Math.abs(parseInt(localStorage.getItem(STYLE_KEY), 10) || 0) % PALETTES.length; } catch { /* storage unavailable */ }
function applyStyle(i) {
  styleIdx = (i + PALETTES.length) % PALETTES.length;
  player.setPalette(PALETTES[styleIdx]);
  const others = PALETTES.filter((_, k) => k !== styleIdx);
  llamas.filter((l) => !l.isPlayer).forEach((b, k) => {
    b.setPalette(others[k % others.length]);
  });
  $('style-name').textContent = PALETTES[styleIdx].name;
  try { localStorage.setItem(STYLE_KEY, String(styleIdx)); } catch { /* storage unavailable */ }
}
// hats: the player picks; bots get a random one each
const HAT_KEY = 'lurching-llama-hat';
let hatIdx = 0;
try { hatIdx = Math.abs(parseInt(localStorage.getItem(HAT_KEY), 10) || 0) % HATS.length; } catch { /* storage unavailable */ }
const CROWN_KEY = 'lurching-llama-crown';
let crownUnlocked = false;
try { crownUnlocked = localStorage.getItem(CROWN_KEY) === '1'; } catch { /* storage unavailable */ }
function applyHat(i, dir = 1) {
  hatIdx = (i + HATS.length) % HATS.length;
  if (hatIdx === CROWN && !crownUnlocked) hatIdx = (hatIdx + dir + HATS.length) % HATS.length;
  player.setHat(hatIdx);
  $('hat-name').textContent = HATS[hatIdx];
  try { localStorage.setItem(HAT_KEY, String(hatIdx)); } catch { /* storage unavailable */ }
}
$('hat-prev').addEventListener('click', () => applyHat(hatIdx - 1, -1));
$('hat-next').addEventListener('click', () => applyHat(hatIdx + 1));
llamas.forEach((l) => { if (!l.isPlayer) l.setHat(Math.floor(Math.random() * CROWN)); });

// saddle blankets: the player picks; bots wear the other designs
const BLANKET_KEY = 'lurching-llama-blanket';
let blanketIdx = 0;
try { blanketIdx = Math.abs(parseInt(localStorage.getItem(BLANKET_KEY), 10) || 0) % BLANKETS.length; } catch { /* storage unavailable */ }
function applyBlanket(i) {
  blanketIdx = (i + BLANKETS.length) % BLANKETS.length;
  player.setBlanket(BLANKETS[blanketIdx]);
  const others = BLANKETS.filter((d, k) => k !== blanketIdx && d.pattern !== 'none');
  llamas.filter((l) => !l.isPlayer).forEach((b, k) => {
    b.setBlanket(others[k % others.length]);
    b.tagEl?.style.setProperty('--c', b.design.colors[0]);
  });
  $('blanket-name').textContent = BLANKETS[blanketIdx].name;
  try { localStorage.setItem(BLANKET_KEY, String(blanketIdx)); } catch { /* storage unavailable */ }
}
$('blanket-prev').addEventListener('click', () => applyBlanket(blanketIdx - 1));
$('blanket-next').addEventListener('click', () => applyBlanket(blanketIdx + 1));

$('style-prev').addEventListener('click', () => applyStyle(styleIdx - 1));
$('style-next').addEventListener('click', () => applyStyle(styleIdx + 1));
applyStyle(styleIdx);
applyBlanket(blanketIdx);
applyHat(hatIdx);

// --- course picker
function applyCourse(i, persist = true) {
  courseIdx = (i + COURSES.length) % COURSES.length;
  if (course.info.id !== COURSES[courseIdx].id) {
    course.dispose();
    course = new Course(scene, COURSES[courseIdx].id);
    for (const l of llamas) { l.course = course; l.support = null; }
    resetRace();
  }
  $('course-name').textContent = COURSES[courseIdx].name;
  $('intro-title').textContent = COURSES[courseIdx].name.toUpperCase();
  $('intro-sub').textContent = COURSES[courseIdx].sub;
  if ($('menu-best')) $('menu-best').textContent = loadBest() ? `Personal best: ${fmtTime(loadBest())}` : '';
  if (persist) try { localStorage.setItem(COURSE_KEY, String(courseIdx)); } catch { /* storage unavailable */ }
}
$('course-prev').addEventListener('click', () => applyCourse(courseIdx - 1));
$('course-next').addEventListener('click', () => applyCourse(courseIdx + 1));

// --- difficulty: how wobbly your neck is, and how sharp the bots are
const DIFFS = [
  { name: 'Chill', neck: 0.6, bot: -0.12 },
  { name: 'Wobbly', neck: 1, bot: 0 },
  { name: 'Chaos', neck: 1.22, bot: 0.06 },
];
const DIFF_KEY = 'lurching-llama-diff';
let diffIdx = 1;
try { const d = parseInt(localStorage.getItem(DIFF_KEY), 10); if (d >= 0 && d < DIFFS.length) diffIdx = d; } catch { /* storage unavailable */ }
function applyDiff(i) {
  diffIdx = clamp(i, 0, DIFFS.length - 1);
  player.wobbliness = DIFFS[diffIdx].neck;
  llamas.forEach((l) => { if (l.bot) l.bot.skill = clamp(l.bot.baseSkill + DIFFS[diffIdx].bot, 0.6, 1); });
  $('diff-name').textContent = DIFFS[diffIdx].name;
  try { localStorage.setItem(DIFF_KEY, String(diffIdx)); } catch { /* storage unavailable */ }
}
$('diff-prev').addEventListener('click', () => applyDiff(diffIdx - 1));
$('diff-next').addEventListener('click', () => applyDiff(diffIdx + 1));
applyDiff(diffIdx);

// lifetime stats shown on the title screen
const STATS_KEY = 'lurching-llama-stats';
function loadStats() {
  try { return { shows: 0, crowns: 0, wins: 0, ...JSON.parse(localStorage.getItem(STATS_KEY) || '{}') }; } catch { return { shows: 0, crowns: 0, wins: 0 }; }
}
function bumpStat(k) {
  const st = loadStats();
  st[k] = (Number(st[k]) || 0) + 1;
  try { localStorage.setItem(STATS_KEY, JSON.stringify(st)); } catch { /* storage unavailable */ }
  renderStats();
}
function renderStats() {
  const st = loadStats();
  $('menu-stats').textContent = st.shows || st.wins
    ? `Shows played ${st.shows} · Crowns ${st.crowns} · Quick Race wins ${st.wins}`
    : '';
}
renderStats();

// Best times and ghosts from before the momentum rework (when you could sprint) don't count.
const BEST_KEY = 'lurching-llama-best2';
try {
  localStorage.removeItem('lurching-llama-best');
  for (const c of COURSES) localStorage.removeItem(`lurching-llama-ghost-${c.id}`);
} catch { /* storage unavailable */ }
const bestKey = () => (course.info.id === 'gauntlet' ? BEST_KEY : `${BEST_KEY}-${course.info.id}`);
function loadBest() { try { return parseFloat(localStorage.getItem(bestKey())) || 0; } catch { return 0; } }
function saveBest(t) { try { localStorage.setItem(bestKey(), String(t)); } catch { /* storage unavailable */ } }
applyCourse(courseIdx);

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const keys = {};
let jumpPressed = false;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'Space' || e.code === 'Enter') e.preventDefault(); // don't also "click" a focused menu button
  if (game.paused) {
    if (e.code === 'KeyP') setPaused(false);
    return;
  }
  if (e.code === 'Space' || e.code === 'KeyZ') jumpPressed = true;
  if ((e.code === 'Space' || e.code === 'KeyZ' || e.code === 'Enter') && game.state === 'intro') startCountdown();
  else if (e.code === 'Enter' && game.state === 'menu') startQuickRace();
  else if (e.code === 'Enter' && game.state === 'results') $('again').click();
  if (e.code === 'KeyR' && game.state === 'racing' && !player.finished) respawnAtCheckpoint(player);
  if (e.code === 'KeyP' && (game.state === 'racing' || game.state === 'countdown') && !player.finished) setPaused(true);
  if (e.code === 'KeyM') { sfx.setMuted(!sfx.muted); toast(sfx.muted ? 'SOUND OFF' : 'SOUND ON', '#2f5d8a'); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
// browsers only allow audio after a real gesture (a gamepad press doesn't count), so wake it on any
for (const ev of ['keydown', 'pointerdown']) addEventListener(ev, () => { if (game.state !== 'menu') sfx.init(); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function setPaused(p) {
  game.paused = p;
  $('paused').classList.toggle('hidden', !p);
  if (p) { document.exitPointerLock?.(); for (const k in keys) keys[k] = false; } else lockPointer();
}
let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  // Esc releases the mouse: treat that as "pause" mid-race
  if (hadLock && !locked && (game.state === 'racing' || game.state === 'countdown') && !player.finished) setPaused(true);
  hadLock = locked;
});

function lockPointer() {
  try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* not available (iframe / headless) */ }
}

let camYaw = 0, camPitch = 0.32, camDist = 8.5;
let lastLook = 0;     // last time the player moved the camera themselves
let steerOnlyForward = false;
let dragging = false;
canvas.addEventListener('mousedown', () => {
  if (game.state === 'racing' || game.state === 'countdown') lockPointer();
  dragging = true;
});
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas || dragging) {
    camYaw -= e.movementX * 0.0028;
    lastLook = performance.now();
    camPitch = clamp(camPitch + e.movementY * 0.0022, -0.15, 1.1);
  }
});
canvas.addEventListener('wheel', (e) => { camDist = clamp(camDist + e.deltaY * 0.005, 5, 15); }, { passive: true });

// --- touch controls: left stick, right-hand buttons, drag anywhere else to look
const touch = { x: 0, y: 0, duck: false };
function setupTouch() {
  document.body.classList.add('touch');
  const joy = $('joy'), knob = $('knob');
  let joyId = null, cx = 0, cy = 0;
  joy.addEventListener('pointerdown', (e) => {
    joyId = e.pointerId; joy.setPointerCapture(e.pointerId);
    const r = joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    moveJoy(e);
  });
  const moveJoy = (e) => {
    if (e.pointerId !== joyId) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const R = 55, l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    touch.x = dx / R; touch.y = dy / R;
  };
  joy.addEventListener('pointermove', moveJoy);
  const endJoy = (e) => { if (e.pointerId !== joyId) return; joyId = null; touch.x = touch.y = 0; knob.style.transform = ''; };
  joy.addEventListener('pointerup', endJoy);
  joy.addEventListener('pointercancel', endJoy);
  joy.addEventListener('lostpointercapture', endJoy);
  const hold = (id, key) => {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); touch[key] = true; el.classList.add('on'); });
    const up = () => { touch[key] = false; el.classList.remove('on'); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
  };
  hold('t-duck', 'duck');
  const tj = $('t-jump');
  tj.addEventListener('pointerdown', (e) => { e.preventDefault(); jumpPressed = true; touch.jumpHeld = true; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) tj.addEventListener(ev, () => { touch.jumpHeld = false; });
  // look around by dragging on the open screen
  let lookId = null, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; } });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    camYaw -= (e.clientX - lx) * 0.006;
    lastLook = performance.now();
    camPitch = clamp(camPitch + (e.clientY - ly) * 0.004, -0.15, 1.1);
    lx = e.clientX; ly = e.clientY;
  });
  const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
  canvas.addEventListener('pointerup', endLook);
  canvas.addEventListener('pointercancel', endLook);
}
if (matchMedia('(pointer: coarse)').matches) setupTouch();

// --- gamepad (standard mapping): polled once per frame
const pad = { x: 0, y: 0, lx: 0, ly: 0, jump: false, duck: false, prev: [] };
const deadzone = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
let padBroken = false; // getGamepads() can throw in iframes without the gamepad permission
function pollPad(dt) {
  if (padBroken) return;
  let gp;
  try {
    const pads = [...(navigator.getGamepads?.() || [])].filter((g) => g && g.connected);
    gp = pads.find((g) => g.mapping === 'standard') || pads[0];
  } catch { padBroken = true; return; }
  if (!gp) { pad.x = pad.y = 0; pad.jump = pad.duck = false; return; }
  const b = (i) => !!gp.buttons[i]?.pressed;
  const edge = (i) => b(i) && !pad.prev[i];
  pad.x = deadzone(gp.axes[0] || 0); pad.y = deadzone(gp.axes[1] || 0);
  // right stick only on standard-mapped pads (elsewhere axes 2/3 may be triggers resting at -1)
  const std = gp.mapping === 'standard';
  pad.lx = std ? deadzone(gp.axes[2] || 0) : 0; pad.ly = std ? deadzone(gp.axes[3] || 0) : 0;
  pad.jump = b(0); pad.duck = b(1) || b(2) || b(4) || b(5);
  if (edge(0)) {
    if (game.state === 'intro') startCountdown();
    else if (game.state === 'menu') startQuickRace();
    else if (game.state === 'results') $('again').click();
    else if (game.paused) setPaused(false);
    else jumpPressed = true;
  }
  if (edge(9) && (game.state === 'racing' || game.state === 'countdown') && !player.finished) setPaused(!game.paused);
  if (edge(8) && game.state === 'racing' && !player.finished && !game.paused) respawnAtCheckpoint(player);
  if (pad.lx || pad.ly) {
    camYaw -= pad.lx * 2.6 * dt;
    camPitch = clamp(camPitch + pad.ly * 1.6 * dt, -0.15, 1.1);
    lastLook = performance.now();
  }
  pad.prev = gp.buttons.map((x) => x.pressed);
}
addEventListener('gamepadconnected', () => toast('CONTROLLER READY', '#5a9e4b'));

function playerInput() {
  let ix = touch.x + pad.x, iz = -touch.y - pad.y;
  if (keys.KeyW || keys.ArrowUp) iz += 1;
  if (keys.KeyS || keys.ArrowDown) iz -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
  steerOnlyForward = iz > 0.5 && Math.abs(ix) < 0.3;
  let x = fx * iz + rx * ix, z = fz * iz + rz * ix;
  const l = Math.hypot(x, z);
  if (l > 1) { x /= l; z /= l; }
  const inp = {
    x, z, moveLen: Math.min(1, l), jump: jumpPressed, jumpHeld: !!(keys.Space || keys.KeyZ || touch.jumpHeld || pad.jump),
    duck: !!(keys.KeyC || keys.KeyX || keys.ControlLeft || keys.KeyQ || touch.duck || pad.duck),
  };
  jumpPressed = false;
  return inp;
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

// finished llamas bounce around happily
function celebrate(l, inp) {
  l.celebT = (l.celebT || Math.random()) - 1 / 60;
  if (l.celebT < 0) { l.celebT = 0.9 + Math.random() * 0.8; inp.jump = true; }
  const a = game.t * 0.8 + l.id;
  inp.x = Math.sin(a) * 0.25 + l.lean.x; inp.z = Math.cos(a) * 0.25 + l.lean.y; inp.moveLen = 0.3;
  // stay on the finish platform
  const hx = -l.pos.x, hz = course.finishZ + 5 - l.pos.z, hd = Math.hypot(hx, hz);
  if (hd > 4) { inp.x += (hx / hd) * 0.6; inp.z += (hz / hd) * 0.6; inp.moveLen = 0.6; }
  return inp;
}

// How far a llama can go in direction (ux, uz) before running out of ground.
function ledgeDist(b, ux, uz) {
  for (let d = 0.3; d < 4; d += 0.3) {
    const g = course.groundAt(b.pos.x + ux * d, b.pos.z + uz * d, b.pos.y + 0.5, 0);
    if (!g || g.y < b.pos.y - 0.6) return d;
  }
  return 4;
}

function botInput(b, dt) {
  const B = b.bot;
  const path = course.path;
  const inp = { x: 0, z: 0, moveLen: 0, jump: false, duck: false };
  if (b.finished) return celebrate(b, inp);
  if (B.wp >= path.length) B.wp = path.length - 1;
  let wp = path[B.wp];
  let tx, tz, hold = false;
  if (wp.plat) {
    const onIt = b.support === wp.plat;
    if (onIt && Math.hypot(b.pos.x - wp.plat.pos.x, b.pos.z - wp.plat.pos.z) < 1.4) { B.wp++; wp = path[B.wp]; }
  } else {
    const dz = wp.z - b.pos.z;
    if (dz < 0.8 && (wp.lanes || Math.abs(b.pos.x - wp.x) < 2.5 + wp.w)) { B.wp++; wp = path[B.wp]; }
  }
  if (!wp) return inp;
  if (wp.plat) {
    // Go when the next platform will be under us by the time we arrive.
    const dzp = Math.abs(wp.plat.pos.z - b.pos.z);
    const tArr = clamp((dzp - 1.2) / 3.6, 0.25, 1.4);
    const myX = b.pos.x + (b.support && b.support.dynamic ? b.support.vel.x * tArr : 0);
    const fut = course.futurePos(wp.plat, tArr);
    // close enough sideways, and its top not too high to hop onto (elevators)
    const later = course.futurePos(wp.plat, tArr + 0.35);
    const top = (p) => p.y + (wp.plat.hy || 0) - b.pos.y;
    const aligned = Math.abs(fut.x - myX) < 1.6 && top(fut) < 0.7 && top(later) < 0.9;
    tx = course.futureX(wp.plat, B.crossing ? tArr * 0.6 : tArr); tz = wp.plat.pos.z;
    if (b.support !== wp.plat && !B.crossing && !aligned) {
      hold = true;
      tx = b.support ? b.support.pos.x : b.pos.x;
      tz = b.support && b.support.dynamic ? b.support.pos.z - 0.8 : b.pos.z; // wait at the back: room for a run-up
    } else if (b.support !== wp.plat) {
      B.crossing = true;
    }
    if (b.support === wp.plat) B.crossing = false;
  } else {
    tx = wp.lanes ? wp.lanes[clamp(Math.round(B.lane + 1), 0, wp.lanes.length - 1)] : wp.x + B.lane * wp.w * 0.5;
    tz = wp.z;
    // riding something that moves up and down: wait until the ledge ahead is in reach
    const ledge = b.support?.motion && b.support.sink === undefined && course.groundAt(tx, tz, b.pos.y + 20, 0);
    if (ledge && ledge.y - b.pos.y > 1.1) { hold = true; tx = b.support.pos.x; tz = b.support.pos.z + 1.2; }
  }
  let dx = tx - b.pos.x, dz = tz - b.pos.z;
  const d = Math.hypot(dx, dz);
  let speed = hold ? clamp(d * 0.8, 0, 0.6) : B.crossing ? 1 : B.skill;
  if (B.pause > 0) { B.pause -= dt; speed = 0; }
  else if (Math.random() < dt * 0.04) B.pause = 0.3 + Math.random() * 1.2;
  if (d > 0.01) { dx /= d; dz /= d; }
  let ix = dx * speed, iz = dz * speed;
  // Llamas take a while to stop: when waiting for a platform, ease off well before the edge.
  if ((hold || (wp.plat && !B.crossing && b.support !== wp.plat)) && b.grounded && b.speed > 0.4) {
    const ux = b.vel.x / b.speed, uz = b.vel.z / b.speed;
    const room = ledgeDist(b, ux, uz);
    const vmax = Math.sqrt(2 * 3.2 * Math.max(0, room - 0.7));
    if (b.speed > vmax) { ix = -ux; iz = -uz; }
    else if (ix * ux + iz * uz > 0) { const k = Math.min(1, vmax / 4.8 / Math.max(1e-3, Math.hypot(ix, iz))); ix *= k; iz *= k; }
  }

  // Balance like a real llama: step toward where the head is falling.
  // On narrow beams only correct fore/aft and lean hard on staying centred.
  const narrow = !wp.plat && !wp.lanes && wp.w < 0.5;
  const bal = 1.7 * B.skill;
  ix += (b.lean.x * bal + b.leanVel.x * 0.25) * (narrow ? 0.35 : 1);
  iz += b.lean.y * bal + b.leanVel.y * 0.25;
  if (narrow) ix += clamp((wp.x - b.pos.x) * 1.2 - b.vel.x * 0.4, -0.8, 0.8);
  const l = Math.hypot(ix, iz);
  if (l > 1) { ix /= l; iz /= l; }
  inp.x = ix; inp.z = iz; inp.moveLen = Math.min(1, l);

  B.think -= dt;
  if (B.think <= 0) {
    B.think = 0.5 + Math.random();
    // stuck?
    if (Math.abs(b.pos.z - B.lastZ) < 0.2 && !hold && b.state === 'normal') B.stuck += 1; else B.stuck = 0;
    B.lastZ = b.pos.z;
    if (B.stuck > 4) { B.lane = (Math.random() - 0.5) * 2; B.stuck = 0; inp.jump = true; }
  }

  // jump gaps
  if (b.grounded && !hold && b.speed > 1.2 && (b.vel.z > 1.6 || B.crossing)) {
    const px = b.pos.x + (b.vel.x / b.speed) * 0.75, pz = b.pos.z + (b.vel.z / b.speed) * 0.75;
    if (!course.groundAt(px, pz, b.pos.y + 0.6, 0)) inp.jump = true;
  }
  // hop up ledges too tall to step (e.g. the end of a tipped teeter-totter)
  if (b.grounded && b.speed > 0.8) {
    const px = b.pos.x + (b.vel.x / b.speed) * 0.9, pz = b.pos.z + (b.vel.z / b.speed) * 0.9;
    const ahead = course.groundAt(px, pz, b.pos.y + 2.5, 0);
    if (ahead && ahead.y > b.pos.y + 0.45) inp.jump = true;
  }
  // sidestep hay bales rolling down at us
  for (const bale of course.bales) {
    const ahead = bale.z - b.pos.z;
    if (ahead < -0.5 || ahead > 10 || Math.abs(bale.x - b.pos.x) > 2.1) continue;
    const away = b.pos.x > bale.x ? 1 : -1;
    // dodge toward whichever side has room on the 9m-wide ramp
    const dir = Math.abs(b.pos.x + away * 2) > 4 ? -away : away;
    inp.x += dir * 1.3 * B.skill;
    inp.moveLen = Math.min(1, Math.hypot(inp.x, inp.z));
  }

  // time the hammers: wait if one will be swinging through our lane as we pass
  for (const o of course.obstacles) {
    if (o.kind === 'bar') {
      const ahead = o.z - b.pos.z;
      if (!o.low && ahead > -0.6 && ahead < 3.2) {
        // decide once per bar whether this llama remembers to duck
        if (B.barSeen !== o.id) { B.barSeen = o.id; B.willDuck = Math.random() < 0.6 + B.skill * 0.35; }
        inp.duck = B.willDuck;
      }
      if (o.low && ahead > 0.5 && ahead < 1.0 + b.speed * 0.12 && b.grounded) inp.jump = true;
      continue;
    }
    if (o.kind !== 'hammer') continue;
    if (o.headOnly) {
      if (Math.abs(o.z - b.pos.z) < 3.4) inp.duck = true;
      continue;
    }
    const ahead = o.z - b.pos.z;
    if (ahead < -2.3 || ahead > 7) continue;
    if (ahead < 3) continue; // already committed: keep going
    // will the hammer sweep our lane while we cross its ~3m wide zone?
    let danger = false;
    const v = 4.8 * B.skill, lag = b.speed < 1.5 ? 0.35 : 0; // a standing llama needs a moment to get going
    const tIn = (ahead - 2.3) / v + lag, tOut = (ahead + 2.3) / v + lag;
    for (let t = tIn; t <= tOut + 0.25; t += 0.1) {
      const th = o.amp * Math.sin((course.time + t) * o.omega + o.phase);
      if (Math.abs(Math.sin(th) * o.L - b.pos.x) < 2.2) { danger = true; break; }
    }
    // most llamas wait their turn; the odd one just barges on through
    if (B.hammerSeen !== o.id) { B.hammerSeen = o.id; B.willWait = Math.random() < 0.55 + B.skill * 0.45; }
    // never stop while still standing in another hammer's swing
    const inSwing = course.obstacles.some((h) => h.kind === 'hammer' && h !== o && Math.abs(h.z - b.pos.z) < 2.5);
    if (danger && B.willWait && !inSwing) {
      // pull up: brake hard (it takes a while), then just keep the head balanced
      if (b.speed > 0.5) { inp.x = -b.vel.x / b.speed + b.lean.x; inp.z = -b.vel.z / b.speed + b.lean.y; }
      else { inp.x = b.lean.x * 1.5; inp.z = b.lean.y * 1.5 - 0.2; }
      inp.moveLen = Math.min(1, Math.hypot(inp.x, inp.z));
    }
  }
  // jump the low sweeper / duck the high one
  for (const o of course.obstacles) {
    if (o.kind !== 'sweeper') continue;
    const rx = b.pos.x - o.c.x, rz = b.pos.z - o.c.z;
    const r = Math.hypot(rx, rz);
    if (r > o.len + 0.5) continue;
    const a = Math.atan2(-rz, rx); // angle in sweeper frame
    let rel = wrapAngle(a - o.angle);
    // distance (in seconds) until the bar arrives
    const arrive = Math.min(Math.abs(wrapAngle(rel)), Math.abs(wrapAngle(rel - Math.PI))) / Math.abs(o.omega);
    const approaching = Math.sign(wrapAngle(rel)) === Math.sign(o.omega) || Math.sign(wrapAngle(rel - Math.PI)) === Math.sign(o.omega);
    if (o.low && arrive < 0.32 * (2 - B.skill) && b.grounded && approaching && Math.random() < 0.9) inp.jump = true;
    if (!o.low && arrive < 0.8) inp.duck = B.skill > 0.84;
  }
  return inp;
}

// ---------------------------------------------------------------------------
// Race flow
// ---------------------------------------------------------------------------

const INTRO_LEN = 6;
const game = { state: 'menu', mode: 'single', round: 0, t: 0, raceT: 0, countdown: 0, finishOrder: [] };
let shake = 0;
let hitStop = 0;   // seconds of slow motion left
let camBump = 0;   // camera dip after a hard landing
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)] || 'th'); }

function toast(text, color = '#e4572e') {
  const el = $('toast');
  el.textContent = text;
  el.style.color = color;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}

function respawnAtCheckpoint(l) {
  const cp = course.checkpoints[l.checkpoint];
  const p = cp.spawn.clone();
  p.x += (Math.random() - 0.5) * 3;
  p.z += (Math.random() - 0.5) * 1.5;
  const g = course.groundAt(p.x, p.z, p.y + 2, 0);
  if (g) p.y = g.y + 3.5; // drop in from above
  l.respawn(p, 0);
  if (l.bot) {
    // rewind the bot's route to just after this checkpoint
    const idx = course.path.findIndex((w) => (w.plat ? w.plat.pos.z : w.z) > cp.spawn.z);
    l.bot.wp = Math.max(0, idx);
    l.bot.crossing = false;
  }
  if (l.isPlayer) { $('fade').classList.add('flash'); setTimeout(() => $('fade').classList.remove('flash'), 350); }
}

// obstacle hints show for your first two races on each course
let hintsOn = true;
function countHintRace() {
  const key = `lurching-llama-hints-${course.info.id}`;
  let n = 0;
  try { n = parseInt(localStorage.getItem(key), 10) || 0; localStorage.setItem(key, String(n + 1)); } catch { /* storage unavailable */ }
  hintsOn = n < 2;
}

function resetRace() {
  setWatching(false);
  game.crownCounted = game.winCounted = false;
  clearTimeout(resultsTimer);
  resultsTimer = null;
  game.paused = false;
  $('paused').classList.add('hidden');
  for (const l of llamas) if (l.hatBeforeCrown !== undefined) { l.setHat(l.hatBeforeCrown); delete l.hatBeforeCrown; }
  racers.forEach((l, i) => {
    l.checkpoint = 0; l.finished = false; l.finishTime = 0;
    l.respawn(spawnPoint([3, 0, 1, 2, 4, 5, 6, 7][i]), 0);
    l.invuln = 0;
    if (l.bot) Object.assign(l.bot, { crossing: false, wp: 0, stuck: 0, pause: 0, lane: (Math.random() - 0.5) * 2 });
  });
  game.finishOrder = [];
  game.roundOver = false;
  game.raceT = 0;
  recording = [];
  recordT = 0;
  loadGhost();
  camYaw = 0;
  camTarget.copy(player.pos);
  camPull = 99;
  Object.assign(touch, { x: 0, y: 0, duck: false });
  $('knob').style.transform = '';
  document.querySelectorAll('.tbtn.on').forEach((b) => b.classList.remove('on'));
  hintIdx = 0;
}

// PLAY shows a quick flyover of the course first; RACE AGAIN goes straight to the countdown.
function startRace(withIntro) {
  sfx.init();
  sfx.startMusic();
  resetRace();
  $('menu').classList.add('hidden');
  $('results').classList.add('hidden');
  document.body.classList.remove('show-results');
  if (withIntro) {
    game.state = 'intro';
    game.introT = 0;
    $('intro').classList.remove('hidden');
    return;
  }
  startCountdown();
}

function startCountdown() {
  countHintRace();
  $('intro').classList.add('hidden');
  game.state = 'countdown';
  game.countdown = 2.999;
  lastCountdown = 4;
  $('results').classList.add('hidden');
  document.body.classList.add('playing');
  document.body.classList.remove('show-results');
  $('hud').classList.remove('hidden');
  lockPointer();
}
// --- The Show: round 1 on the Gauntlet (top 5 qualify), then a Log Roll Rumble final
const SHOW = [
  { course: 'gauntlet', quota: 5, title: 'ROUND 1' },
  { course: 'duck', quota: 3, title: 'ROUND 2' },
  { course: 'rumble', quota: 1, title: 'FINAL' },
];
const isFinal = () => game.round === SHOW.length - 1;
function setRacers(list) {
  racers = list;
  for (const l of llamas) {
    l.out = !racers.includes(l);
    l.root.visible = l.limbs.visible = l.neckTube.mesh.visible = !l.out;
    if (l.out) { l.stars.visible = false; l.pos.set(0, -200, 0); }
  }
}
function startShowRound(round) {
  if (round === 0) bumpStat('shows');
  game.mode = 'show';
  game.round = round;
  if (round === 0) setRacers(llamas.slice());
  applyCourse(COURSES.findIndex((c) => c.id === SHOW[round].course), false);
  startRace(true);
  $('intro-title').textContent = `${SHOW[round].title}: ${course.info.name.toUpperCase()}`;
  $('intro-sub').textContent = round < SHOW.length - 1
    ? `${racers.length} llamas · top ${SHOW[round].quota} go through`
    : 'First across the line wins the crown!';
}
function startQuickRace() {
  game.mode = 'single';
  setRacers(llamas.slice());
  startRace(true);
}

$('play').addEventListener('click', startQuickRace);
$('play-show').addEventListener('click', () => startShowRound(0));
if (loadBest()) $('menu-best').textContent = `Personal best: ${fmtTime(loadBest())}`;
$('again').addEventListener('click', () => {
  if (game.mode !== 'show') return startRace(false);
  const pi = game.finishOrder.indexOf(player);
  const qualified = !isFinal() && pi >= 0 && pi < SHOW[game.round].quota;
  if (qualified) {
    // the qualifiers race on (topped up by whoever was furthest along, just in case)
    setRacers(rankings().slice(0, SHOW[game.round].quota));
    startShowRound(game.round + 1);
  } else startShowRound(0);
});
$('to-menu').addEventListener('click', backToMenu);
function setWatching(on) {
  $('results').classList.toggle('watching', on);
  $('show-card').hidden = !on;
  if (!on) renderResultList();
}
$('watch').addEventListener('click', () => setWatching(true));
$('show-card').addEventListener('click', () => setWatching(false));
function backToMenu() {
  if (game.mode === 'show') {
    game.mode = 'single';
    setRacers(llamas.slice());
    let saved = 0;
    try { saved = parseInt(localStorage.getItem(COURSE_KEY), 10) || 0; } catch { /* storage unavailable */ }
    applyCourse(((saved % COURSES.length) + COURSES.length) % COURSES.length, false);
  }
  resetRace();
  game.state = 'menu';
  $('results').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  document.body.classList.remove('show-results', 'playing');
  $('menu-best').textContent = loadBest() ? `Personal best: ${fmtTime(loadBest())}` : '';
}
$('intro').addEventListener('click', () => { if (game.state === 'intro') startCountdown(); });
$('paused').addEventListener('click', () => setPaused(false));

function finish(l) {
  l.finished = true;
  l.finishTime = game.raceT;
  game.finishOrder.push(l);
  const place = game.finishOrder.length;
  const show = game.mode === 'show' ? SHOW[game.round] : null;
  if (l.isPlayer) {
    const made = !show || place <= show.quota;
    if (made) { sfx.fanfare(); confetti.burst(l.pos); }
    toast(show ? (isFinal() ? (place === 1 ? 'CROWNED!' : 'TOO SLOW!') : made ? 'QUALIFIED!' : 'TOO LATE!')
      : place === 1 ? 'WINNER!' : 'FINISHED!', '#f2c14e');
    scheduleResults(1800);
  }
  // in a Show the round ends as soon as the qualifying spots are filled
  if (show && !game.roundOver && place >= show.quota) {
    game.roundOver = true;
    if (!player.finished) {
      toast(isFinal() ? `${l.name.toUpperCase()} WINS!` : 'ELIMINATED!', '#e4572e');
      sfx.bleat(0.8);
      scheduleResults(2000);
    }
  }
}

// Only one pending results timer at a time; cancelled whenever a new race starts.
let resultsTimer = null;
function scheduleResults(ms) {
  if (resultsTimer || game.state === 'results') { if (game.state === 'results') renderResultList(); return; }
  resultsTimer = setTimeout(() => { resultsTimer = null; showResults(); }, ms);
}

function showResults() {
  document.exitPointerLock?.();
  game.state = 'results';
  game.paused = false;
  $('paused').classList.add('hidden');
  document.body.classList.remove('playing');
  document.body.classList.add('show-results');
  const place = game.finishOrder.indexOf(player) + 1;
  const show = game.mode === 'show';
  $('res-course').textContent = show ? `${SHOW[game.round].title} · ${course.info.name.toUpperCase()}` : course.info.name.toUpperCase();
  if (!show && place === 1 && !game.winCounted) { game.winCounted = true; bumpStat('wins'); }
  if (!show) {
    $('res-title').textContent = place === 1 ? 'LLAMA CHAMPION!' : place <= 3 ? 'PODIUM PROUD!' : 'WOBBLED HOME!';
    $('again').textContent = 'RACE AGAIN';
  } else if (!isFinal()) {
    const ok = place > 0 && place <= SHOW[game.round].quota;
    $('res-title').textContent = ok ? 'QUALIFIED!' : 'ELIMINATED!';
    $('again').textContent = ok ? (game.round + 1 === SHOW.length - 1 ? 'ON TO THE FINAL ▶' : 'NEXT ROUND ▶') : 'NEW SHOW';
  } else {
    $('res-title').textContent = place === 1 ? 'YOU WEAR THE CROWN!' : `${game.finishOrder[0].name.toUpperCase()} TAKES THE CROWN`;
    // crown the champion (for the victory lap behind the results card)
    const champ = game.finishOrder[0];
    if (champ.hatBeforeCrown === undefined) champ.hatBeforeCrown = champ.hatIdx;
    champ.setHat(CROWN);
    if (champ.isPlayer && !game.crownCounted) { game.crownCounted = true; bumpStat('crowns'); }
    if (champ.isPlayer && !crownUnlocked) {
      crownUnlocked = true;
      try { localStorage.setItem(CROWN_KEY, '1'); } catch { /* storage unavailable */ }
      $('res-time').dataset.unlock = '1';
    }
    $('again').textContent = 'NEW SHOW';
  }
  $('res-place').textContent = place ? `${ordinal(place)} of ${racers.length}` : 'Did not finish';
  if (place && show) {
    $('res-time').textContent = fmtTime(player.finishTime);
  } else if (place) {
    const best = loadBest();
    const isBest = !best || player.finishTime < best;
    if (isBest) { saveBest(player.finishTime); saveGhost(); }
    $('res-time').innerHTML = `${fmtTime(player.finishTime)}${isBest ? ' · <b class="pb">NEW PERSONAL BEST!</b>' : ` · best ${fmtTime(best)}`}`;
  } else $('res-time').textContent = 'Better luck next time!';
  if ($('res-time').dataset.unlock) {
    $('res-time').innerHTML += '<br><b class="pb">👑 Golden Crown hat unlocked!</b>';
    delete $('res-time').dataset.unlock;
  }
  renderResultList();
  $('results').classList.remove('hidden');
}

function renderResultList() {
  $('res-list').innerHTML = rankings().map((l, i) =>
    `<li class="${l.isPlayer ? 'me' : ''}"><span>${ordinal(i + 1)}</span><b style="background:${l.palette.wool}"></b>${l.name}<em>${l.finished ? fmtTime(l.finishTime) : game.roundOver ? (isFinal() ? '—' : 'eliminated') : '…still wobbling'}</em></li>`).join('');
}

function rankings() {
  return [...racers].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.pos.z - a.pos.z;
  });
}

function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// Effects: dust and confetti
// ---------------------------------------------------------------------------

function makeDust() {
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const pool = [];
  for (let i = 0; i < 80; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#fff4fa', transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    pool.push({ m, life: 0, v: new THREE.Vector3(), s: 0 });
  }
  let idx = 0;
  return {
    puff(p, size = 0.3) {
      for (let k = 0; k < 3; k++) {
        const d = pool[idx++ % pool.length];
        d.m.position.set(p.x + (Math.random() - 0.5) * 0.2, p.y + 0.05, p.z + (Math.random() - 0.5) * 0.2);
        d.v.set((Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2);
        d.life = 1; d.s = size * (0.5 + Math.random() * 0.5); d.m.visible = true;
      }
    },
    update(dt) {
      for (const d of pool) {
        if (d.life <= 0) continue;
        d.life -= dt * 1.8;
        d.m.position.addScaledVector(d.v, dt);
        d.v.multiplyScalar(1 - dt * 3);
        const s = d.s * (1.4 - d.life * 0.6);
        d.m.scale.setScalar(Math.max(0.001, s));
        d.m.material.opacity = Math.max(0, d.life) * 0.4;
        if (d.life <= 0) d.m.visible = false;
      }
    },
  };
}

const confetti = (() => {
  const N = 400;
  const geo = new THREE.PlaneGeometry(0.12, 0.2);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const cols = ['#e4572e', '#f2c14e', '#5a9e4b', '#2f5d8a', '#3e7cb1', '#ffffff'].map((c) => new THREE.Color(c));
  const parts = [];
  for (let i = 0; i < N; i++) {
    parts.push({ p: new THREE.Vector3(0, -999, 0), v: new THREE.Vector3(), r: new THREE.Euler(), w: Math.random() * 10 });
    mesh.setColorAt(i, cols[i % cols.length]);
  }
  mesh.frustumCulled = false;
  scene.add(mesh);
  const o = new THREE.Object3D();
  return {
    burst(at) {
      for (const p of parts) {
        p.p.set(at.x + (Math.random() - 0.5) * 2, at.y + 3, at.z + (Math.random() - 0.5) * 2);
        p.v.set((Math.random() - 0.5) * 10, 6 + Math.random() * 8, (Math.random() - 0.5) * 10);
      }
    },
    update(dt) {
      parts.forEach((p, i) => {
        p.v.y -= 9 * dt; p.v.multiplyScalar(1 - dt * 1.4);
        p.p.addScaledVector(p.v, dt);
        p.w += dt * 8;
        o.position.copy(p.p);
        o.rotation.set(p.w, p.w * 0.7, 0);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
})();

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();
const camTarget = new THREE.Vector3().copy(player.pos);
let menuAngle = 0;
let lastCountdown = 4;

// Adaptive resolution: if frames are consistently slow, render fewer pixels.
let pixelRatio = Math.min(window.devicePixelRatio, 2);
let slowT = 0, fpsAvg = 60, fpsShow = false;
function adaptQuality(rawDt) {
  fpsAvg = lerp(fpsAvg, 1 / Math.max(rawDt, 1e-3), 0.05);
  if (fpsShow) $('fps').textContent = `${Math.round(fpsAvg)} fps · ${pixelRatio.toFixed(2)}x`;
  if (game.state !== 'racing' || document.hidden) return;
  slowT = fpsAvg < 45 ? slowT + rawDt : Math.max(0, slowT - rawDt);
  if (slowT > 2.5 && pixelRatio > 0.75) {
    pixelRatio = Math.max(0.75, pixelRatio - 0.25);
    renderer.setPixelRatio(pixelRatio);
    slowT = 0;
  }
}
addEventListener('keydown', (e) => {
  if (e.code === 'Backquote') { fpsShow = !fpsShow; $('fps').classList.toggle('hidden', !fpsShow); }
});

function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  adaptQuality(rawDt);
  pollPad(Math.min(rawDt, 0.05));
  let dt = Math.min(rawDt, 1 / 30);
  if (hitStop > 0) { hitStop -= dt; dt *= 0.3; }
  if (dt < 1e-4) return;
  game.t += dt;

  // fixed-ish sub-stepping keeps the springs stable on slow frames
  const steps = rawDt > 1 / 45 ? 2 : 1;
  const h = dt / steps;
  if (!game.paused) for (let s = 0; s < steps; s++) step(h);

  // neck tubes only for llamas on screen and reasonably close (hidden otherwise, never frozen)
  for (const l of [...racers, ghost]) {
    const d2 = l.pos.distanceToSquared(camera.position);
    _p.copy(l.headPos).project(camera);
    const vis = l.root.visible && d2 < 90 * 90 && (d2 < 36 || (_p.z < 1 && Math.abs(_p.x) < 1.3 && Math.abs(_p.y) < 1.6));
    l.neckTube.mesh.visible = vis;
    if (vis) l.updateVisuals();
  }
  dust.update(dt);
  confetti.update(dt);
  updateCamera(dt);
  updateHud();
  renderer.render(scene, camera);
}

let simT = 0;
function step(dt) {
  simT += dt;
  course.update(simT, dt, racers);

  if (game.state === 'intro') {
    game.introT += dt;
    if (game.introT > INTRO_LEN) startCountdown();
  }
  if (game.state === 'countdown') {
    game.countdown -= dt;
    const n = Math.ceil(game.countdown);
    if (n !== lastCountdown) {
      lastCountdown = n;
      if (n > 0) { $('count').textContent = n; sfx.beep(false); } else { $('count').textContent = 'GO!'; sfx.beep(true); }
      $('count').classList.remove('pop'); void $('count').offsetWidth; $('count').classList.add('pop');
    }
    if (game.countdown <= 0 && hintsOn && !player.finished) {
      showHint('You are top-heavy! Ease off before you stop, and if you start to tip, walk <b>toward</b> the lean');
    }
    if (game.countdown <= 0) { game.state = 'racing'; setTimeout(() => { $('count').textContent = ''; }, 700); }
  }
  const racing = game.state === 'racing' || game.state === 'results';
  if (game.state === 'racing' || game.state === 'results') game.raceT += dt;

  const idle = { x: 0, z: 0, moveLen: 0, jump: false, duck: false };
  let pin = game.state === 'racing' && !player.finished ? (testInput ? testInput(simT) : playerInput()) : (jumpPressed = false, idle);
  if (player.finished) pin = celebrate(player, { ...idle });
  for (const l of racers) {
    const inp = l.isPlayer ? pin : racing ? botInput(l, dt) : idle;
    l.update(dt, inp, simT);
  }

  // llama-on-llama bumping
  for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) {
    const a = racers[i], b = racers[j];
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, dy = b.pos.y - a.pos.y;
    const d = Math.hypot(dx, dz);
    if (d < 0.95 && Math.abs(dy) < 1.2 && d > 1e-4) {
      const nx = dx / d, nz = dz / d, push = (0.95 - d) * 0.5;
      a.pos.x -= nx * push; a.pos.z -= nz * push;
      b.pos.x += nx * push; b.pos.z += nz * push;
      const rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
      if (rv < 0) {
        a.vel.x += nx * rv * 0.6; a.vel.z += nz * rv * 0.6;
        b.vel.x -= nx * rv * 0.6; b.vel.z -= nz * rv * 0.6;
        // a bump knocks heads around
        a.leanVel.x += nx * rv * 0.25; a.leanVel.y += nz * rv * 0.25;
        b.leanVel.x -= nx * rv * 0.25; b.leanVel.y -= nz * rv * 0.25;
        if ((a.isPlayer || b.isPlayer) && rv < -1.5) sfx.boing();
      }
    }
  }

  if (game.state === 'racing' && !player.finished) recordFrame(dt);
  updateGhost(dt);
  if (game.state === 'racing' && hintsOn && hintIdx < course.hints.length && player.pos.z > course.hints[hintIdx].z) showHint(course.hints[hintIdx++].text);

  // idle llamas glance at the nearest neighbour's face
  for (const a of racers) {
    let best = null, bd = 4.5;
    for (const b of racers) {
      if (a === b) continue;
      const d = a.headPos.distanceTo(b.headPos);
      if (d < bd) { bd = d; best = b; }
    }
    a.lookAt = best ? best.headPos : null;
  }

  // long necks mean heads clonk together
  for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) {
    const a = racers[i], b = racers[j];
    const d = a.headPos.distanceTo(b.headPos);
    if (d < 0.42 && d > 1e-4 && (a.hitCD.head || 0) <= 0 && (b.hitCD.head || 0) <= 0) {
      _p.subVectors(b.headPos, a.headPos).setY(0).normalize().multiplyScalar(2.2);
      b.headHit(_p);
      a.headHit(_p.negate());
      a.hitCD.head = b.hitCD.head = 0.8;
      if (a.isPlayer || b.isPlayer) { sfx.bonk(); toast('BONK!', '#ff9f43'); }
    }
  }

  // a falling player gets one despairing bleat
  if (player.vel.y < -11 && !player.screamed && player.pos.y < -3) { player.screamed = true; sfx.bleat(1.25); }
  if (player.grounded) player.screamed = false;

  // checkpoints, falling, finishing
  for (const l of racers) {
    if (l.pos.y < -14) {
      if (l.isPlayer) toast(['SPLOOSH!', 'OOPS!', 'BYE BYE!'][Math.floor(Math.random() * 3)], '#3e7cb1');
      respawnAtCheckpoint(l);
    }
    const cps = course.checkpoints;
    while (l.checkpoint + 1 < cps.length && l.pos.z > cps[l.checkpoint + 1].z && l.pos.y > cps[l.checkpoint + 1].spawn.y - 1.5) {
      l.checkpoint++;
      if (l.isPlayer) { toast('CHECKPOINT!', '#5a9e4b'); sfx.boing(); }
    }
    if ((game.state === 'racing' || game.state === 'results') && !l.finished && l.pos.z > course.finishZ && l.pos.y > course.finishY - 2) {
      finish(l);
      if (game.state === 'results') renderResultList();
    }
  }
}

function updateCamera(dt) {
  const dbg = window.__game?.debugCam;
  if (dbg) {
    const tgt = _t.copy(dbg.head ? player.headPos : player.pos).add(_o.set(...(dbg.look || [0, 1.5, 0])));
    if (dbg.head) _o.set(...dbg.off).applyAxisAngle(_p.set(0, 1, 0), player.yaw + player.head.rotation.y);
    camera.position.copy(tgt).add(dbg.head ? _o : _o.set(...dbg.off));
    camera.lookAt(tgt);
  } else if (game.state === 'intro') {
    // swoop from the finish line back to the start, then settle behind the player
    const u = clamp(game.introT / INTRO_LEN, 0, 1);
    const e = smoothstep(u / 0.85);
    // dolly backwards down the course while looking ahead at it
    const z = lerp(course.finishZ + 6, -4, e);
    camera.position.set(10 * (1 - e * e * e), course.heightAt(z - 10) + lerp(13, 6, e), z - 10);
    _t.set(0, course.heightAt(z + 8) + 1.5, z + 8);
    const h = smoothstep((u - 0.8) / 0.2);
    if (h > 0) {
      // blend into the regular chase camera
      const tgt = _o.copy(player.pos).add(_p.set(0, 2.2, 0));
      const cp = Math.cos(camPitch);
      _p.set(tgt.x - Math.sin(camYaw) * camDist * cp, tgt.y + Math.sin(camPitch) * camDist + 0.8, tgt.z - Math.cos(camYaw) * camDist * cp);
      camera.position.lerp(_p, h);
      _t.lerp(tgt, h);
    }
    camera.lookAt(_t);
    camTarget.copy(player.pos);
  } else if (game.state === 'menu' || game.state === 'results') {
    // slow showcase orbit around the player
    menuAngle += dt * 0.3;
    const a = 0.35 + Math.sin(menuAngle) * 0.75;
    const tgt = _t.copy(player.pos).add(_o.set(game.state === 'menu' ? -1.2 : 0, 1.8, 0));
    camera.position.set(tgt.x + Math.sin(a) * 5.2, tgt.y + 0.3 + Math.sin(menuAngle * 0.7) * 0.3, tgt.z + Math.cos(a) * 5.2);
    camera.lookAt(tgt);
  } else {
    // keyboard-only comfort: running straight ahead, the camera eases back behind you
    if (game.state === 'racing' && steerOnlyForward && player.speed > 2 && performance.now() - lastLook > 2000) {
      camYaw += wrapAngle(player.yaw - camYaw) * (1 - Math.exp(-0.8 * dt));
    }
    camTarget.x = damp(camTarget.x, player.pos.x, 8, dt);
    camTarget.z = damp(camTarget.z, player.pos.z, 8, dt);
    camTarget.y = damp(camTarget.y, Math.max(player.pos.y, -8), 5, dt);
    const tgt = _t.copy(camTarget).add(_o.set(0, 2.2, 0));
    const cp = Math.cos(camPitch);
    camera.position.set(
      tgt.x - Math.sin(camYaw) * camDist * cp,
      tgt.y + Math.sin(camPitch) * camDist + 0.8,
      tgt.z - Math.cos(camYaw) * camDist * cp,
    );
    // don't let posts and pillars block the view: pull the camera in front of them
    _p.subVectors(camera.position, tgt);
    const want = _p.length();
    camRay.set(tgt, _p.normalize());
    camRay.far = want;
    const hit = camRay.intersectObjects(course.occluders, false)[0];
    camPull = damp(camPull, hit ? Math.max(1.5, hit.distance - 0.5) : want, hit ? 20 : 4, dt);
    if (camPull < want) camera.position.copy(tgt).addScaledVector(_p, camPull);
    if (reducedMotion) camBump = 0;
    camera.position.y -= camBump;
    camBump = damp(camBump, 0, 6, dt);
    if (reducedMotion) shake = 0;
    if (shake > 0) {
      shake = Math.max(0, shake - dt * 1.5);
      camera.position.x += (Math.random() - 0.5) * shake * 0.6;
      camera.position.y += (Math.random() - 0.5) * shake * 0.6;
    }
    camera.lookAt(tgt);
  }
  // shadows follow the player
  sun.position.copy(player.pos).add(_o.set(-14, 30, -10));
  sun.target.position.copy(player.pos);
  scene.userData.sky.position.copy(camera.position);
  marker.visible = game.state !== 'menu';
  // a little FOV kick at full tilt
  const fast = game.state === 'racing' && player.speed > 4.4 && !reducedMotion;
  const fov = damp(camera.fov, fast ? 60 : 55, 4, dt);
  if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  marker.position.copy(player.headPos).add(_o.set(0, 0.75 + Math.sin(game.t * 4) * 0.08, 0));
  marker.rotation.y = game.t * 2;
}
const _t = new THREE.Vector3(), _o = new THREE.Vector3(), _p = new THREE.Vector3();
const camRay = new THREE.Raycaster();
let camPull = 99;

let wasPanicking = false;
function updateTags() {
  const w = window.innerWidth, h = window.innerHeight;
  for (const l of [...llamas, ghost]) {
    if (!l.tagEl) continue;
    if (l.out) { l.tagEl.style.display = 'none'; continue; }
    if (l === ghost && !ghost.root.visible) { l.tagEl.style.display = 'none'; continue; }
    _t.copy(l.headPos); _t.y += 0.55;
    const d = _t.distanceTo(camera.position);
    _t.project(camera);
    const vis = game.state !== 'menu' && _t.z < 1 && d < 38 && Math.abs(_t.x) < 1.1 && Math.abs(_t.y) < 1.1;
    l.tagEl.style.display = vis ? 'block' : 'none';
    if (vis) {
      l.tagEl.style.transform = `translate(${(_t.x * 0.5 + 0.5) * w}px, ${(-_t.y * 0.5 + 0.5) * h}px) translate(-50%, -100%) scale(${clamp(14 / d, 0.55, 1.1)})`;
    }
  }
}

function updateHud() {
  updateTags();
  if (game.state === 'menu') return;
  const panic = player.state === 'normal' ? clamp((player.balance - 0.55) / 0.4, 0, 1) : 0;
  $('vignette').style.opacity = panic.toFixed(3);
  if (panic > 0.6 && !wasPanicking) sfx.uhoh();
  wasPanicking = panic > 0.4;
  $('timer').textContent = fmtTime(game.raceT);
  const r = rankings();
  const place = r.indexOf(player) + 1;
  $('place').innerHTML = `${ordinal(place)}<small>/${racers.length}</small>`;
  const rd = $('round');
  rd.classList.toggle('hidden', game.mode !== 'show');
  if (game.mode === 'show') {
    const sr = SHOW[game.round];
    rd.textContent = isFinal()
      ? 'FINAL · FIRST ACROSS WINS THE CROWN'
      : `${sr.title} · QUALIFIED ${Math.min(game.finishOrder.length, sr.quota)}/${sr.quota}`;
  }
  const w = course.windAt(player.pos);
  const wind = $('wind');
  wind.classList.toggle('show', Math.abs(w) > 0.6);
  // arrow points in the screen direction the wind is blowing (world -x when w>0)
  const sx = -Math.sign(w) * -Math.cos(camYaw); // dot of (-sign,0,0) with camera-right
  wind.textContent = (sx > 0 ? 'WIND ➜' : '⬅ WIND');
  const prog = clamp((player.pos.z + 5) / (course.finishZ + 5), 0, 1);
  $('progress-fill').style.width = `${prog * 100}%`;
}

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Test hook: run the simulation headlessly (no rendering) with scripted input.
let testInput = null;
frame();
window.__game = {
  game, llamas, player: () => player, get course() { return course; }, camera, botInput, renderer, scene,
  advance(seconds, inputFn = null) {
    testInput = inputFn;
    for (let t = 0; t < seconds; t += 1 / 60) { game.t += 1 / 60; step(1 / 60); }
    testInput = null;
    camTarget.copy(player.pos);
    updateCamera(1 / 60);
  },
};
