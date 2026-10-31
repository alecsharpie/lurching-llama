import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, damp, smoothstep, wrapAngle, woolGeometry, noise3, canvasTexture, rng } from './util.js';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const BODY_H = 1.08;          // body pivot height above the ground when standing
const FOOT_H = 0.085;         // fetlock height above the sole
const NECK_N = 10;
const NECK_SEG = 0.18;        // ~1.8m of glorious, exaggerated neck
const TOPPLE = 1.05;          // neck lean (rad) past which the llama goes over

// Rest curvature of each neck vertebra (pitch, rad). Leans out of the chest,
// then curves back to near-vertical: a gentle S.
const NECK_REST = [0.42, 0.14, 0.02, -0.05, -0.08, -0.09, -0.08, -0.07, -0.06, -0.05];
// Ducked pose: neck coils forward and down.
const NECK_DUCK = [0.5, 0.36, 0.3, 0.22, 0.12, 0.04, -0.05, -0.12, -0.18, -0.22];
// How the balance lean is distributed along the neck (sums to 1).
const NECK_LEAN_W = [0.04, 0.07, 0.09, 0.11, 0.12, 0.13, 0.13, 0.12, 0.10, 0.09];

// Speeding up is snappy but slowing down and turning are not: a llama this
// top-heavy skids, and its whole body lurches on with the momentum.
const PHYS = {
  walk: 4.8, accel: 8, brake: 5.5, airAccel: 3.2,
  gravity: 24, jumpV: 8.4, turnRate: 5.5, radius: 0.5,
};
// A: how hard acceleration throws the head; braking (Ab) throws it much harder than setting off.
const NECK = { K: 12, C: 1.6, G: 6.6, A: 0.3, Ab: 0.6, pull: 2.6 };

// Lateral-sequence walk blends into a pace (lateral pairs together) at speed,
// which is how camelids actually move.
const WALK_OFF = { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 };
const PACE_OFF = { LH: 0, LF: 0.04, RH: 0.5, RF: 0.54 };
// Sprinting breaks into a bouncy transverse gallop: hinds together, then fronts.
const GALLOP_OFF = { LH: 0, RH: 0.11, LF: 0.48, RF: 0.6 };

const LEG_DEFS = [
  { id: 'LF', side: 1, front: true },
  { id: 'RF', side: -1, front: true },
  { id: 'LH', side: 1, front: false },
  { id: 'RH', side: -1, front: false },
];

export const HATS = ['No Hat', 'Party Hat', 'Top Hat', 'Beanie', 'Flower Crown', 'Propeller Cap', 'Golden Crown'];
export const CROWN = 6; // unlocked by winning a Show

export const PALETTES = [
  { name: 'Classic Cream', wool: '#f7f0e3', face: '#efe3cf', dark: '#3b2c27', blanket: ['#ff4f8b', '#ffd23f', '#2ec4b6', '#5b3cc4'], pom: '#ff4f8b' },
  { name: 'Cocoa', wool: '#a8744b', face: '#8c5f3e', dark: '#2b1d17', blanket: ['#2ec4b6', '#ffffff', '#ff9f1c', '#e71d36'], pom: '#2ec4b6' },
  { name: 'Caramel', wool: '#e3c197', face: '#d4ac7d', dark: '#3a2a20', blanket: ['#7b2cbf', '#ff9e00', '#f15bb5', '#00bbf9'], pom: '#ff9e00' },
  { name: 'Silver Fox', wool: '#bab5af', face: '#a39d96', dark: '#2a2624', blanket: ['#ef476f', '#06d6a0', '#ffd166', '#118ab2'], pom: '#06d6a0' },
  { name: 'Midnight', wool: '#4b413b', face: '#3b322d', dark: '#120d0b', blanket: ['#ffd60a', '#ff5d8f', '#4cc9f0', '#ffffff'], pom: '#ffd60a' },
  { name: 'Choc-Dipped', wool: '#f4ede4', face: '#8b5a3c', dark: '#24170f', blanket: ['#3a86ff', '#ffbe0b', '#fb5607', '#8338ec'], pom: '#3a86ff' },
  { name: 'Ginger Snap', wool: '#c97b47', face: '#b56a3b', dark: '#2e1a10', blanket: ['#80ed99', '#38a3a5', '#fff3b0', '#e63946'], pom: '#80ed99' },
  { name: 'Latte', wool: '#d9c7b0', face: '#c6b096', dark: '#33281f', blanket: ['#ff70a6', '#70d6ff', '#ffd670', '#e9ff70'], pom: '#ff70a6' },
];

const UP = new THREE.Vector3(0, 1, 0);
const NO_INPUT = { x: 0, z: 0, moveLen: 0, jump: false, duck: false };

// Shared geometry (built once, reused by every llama).
const GEO = {};
function geo(key, make) { return GEO[key] || (GEO[key] = make()); }

// Bake several transformed copies of shared geometry into one (fewer draw calls).
function mergedGeo(key, parts) {
  return geo(key, () => mergeGeometries(parts.map(([g, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]]) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    return g.clone().applyMatrix4(m);
  })));
}

function bananaEar(side) {
  // A tapered, flattened cylinder bent inward like a llama's banana ears,
  // with a pink inner face baked in as vertex colour.
  const g = new THREE.CylinderGeometry(0.016, 0.046, 0.25, 12, 12);
  g.translate(0, 0.125, 0);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = y / 0.25;
    z *= 0.42;
    const inner = z > 0.004 && Math.abs(x) < 0.03 * (1 - t * 0.6);
    if (z > 0) z -= 0.012 * Math.sin(Math.PI * t); // cupped front
    x += -side * 0.06 * t * t;                       // curve inward
    z += 0.025 * t * t;                              // tips tilt forward
    p.setXYZ(i, x, y, z);
    const c = inner ? [1.0, 0.72, 0.72] : [1, 1, 1];
    col.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function blanketTexture(colors) {
  return canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);
    // stripes run along the spine (u = around the back)
    const bands = [
      [0.0, 0.07, colors[3]], [0.07, 0.1, colors[1]], [0.1, 0.16, colors[2]],
      [0.84, 0.9, colors[2]], [0.9, 0.93, colors[1]], [0.93, 1.0, colors[3]],
      [0.46, 0.54, colors[1]],
    ];
    for (const [a, b, c] of bands) { ctx.fillStyle = c; ctx.fillRect(a * w, 0, (b - a) * w, h); }
    // zig-zags
    const zig = (x0, x1, c) => {
      ctx.strokeStyle = c; ctx.lineWidth = 7; ctx.beginPath();
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const y = (i / n) * h, x = i % 2 ? x1 : x0;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    zig(0.22 * w, 0.32 * w, colors[3]); zig(0.68 * w, 0.78 * w, colors[3]);
    zig(0.36 * w, 0.42 * w, colors[2]); zig(0.58 * w, 0.64 * w, colors[2]);
    // little diamonds
    ctx.fillStyle = colors[1];
    for (let i = 0; i < 5; i++) {
      const cx = 0.5 * w, cy = (i + 0.5) / 5 * h;
      ctx.beginPath(); ctx.moveTo(cx, cy - 9); ctx.lineTo(cx + 9, cy); ctx.lineTo(cx, cy + 9); ctx.lineTo(cx - 9, cy); ctx.fill();
    }
  });
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _e1 = new THREE.Euler();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();

// Two-bone IK. Writes knee and (possibly clamped) end positions.
function solveIK(a, target, L1, L2, pole, knee, end) {
  const d = _v1.subVectors(target, a);
  let len = d.length();
  const maxL = L1 + L2 - 0.002;
  len = clamp(len, 0.08, maxL);
  d.normalize();
  const x = (L1 * L1 - L2 * L2 + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  const pd = _v2.copy(pole).addScaledVector(d, -pole.dot(d));
  if (pd.lengthSq() < 1e-6) pd.set(0, 0, 1);
  pd.normalize();
  knee.copy(a).addScaledVector(d, x).addScaledVector(pd, h);
  end.copy(a).addScaledVector(d, len);
}

function placeSegment(mesh, p0, p1, sx, sz, lenScale = 1) {
  const dir = _v3.subVectors(p1, p0);
  const len = dir.length();
  mesh.position.addVectors(p0, p1).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(len || 1));
  mesh.scale.set(sx, len * lenScale, sz);
}

// One continuous fleece tube skinned along the neck's spring chain. Rebuilt every
// frame from the vertebra positions through a Catmull-Rom spline with
// parallel-transported frames, so the neck bends smoothly instead of looking
// like a stack of rings.
const TUBE_RINGS = 64, TUBE_SIDES = 34;
let TUBE_DISP = null;
function tubeDisplacement() {
  if (TUBE_DISP) return TUBE_DISP;
  const disp = new Float32Array(TUBE_RINGS * TUBE_SIDES), shade = new Float32Array(TUBE_RINGS * TUBE_SIDES);
  for (let r = 0; r < TUBE_RINGS; r++) for (let k = 0; k < TUBE_SIDES; k++) {
    const th = (k / TUBE_SIDES) * Math.PI * 2, u = r / (TUBE_RINGS - 1);
    const cx = Math.cos(th) * 1.3, cy = Math.sin(th) * 1.3, cz = u * 13;
    const c = Math.abs(noise3(cx * 2.4, cy * 2.4, cz * 1.5, 401)) * 0.7 + Math.abs(noise3(cx * 5, cy * 5, cz * 3.2, 402)) * 0.3;
    const big = noise3(cx * 0.8, cy * 0.8, cz * 0.45, 403);
    disp[r * TUBE_SIDES + k] = 1 + (c - 0.3) * 0.34 + big * 0.1;
    shade[r * TUBE_SIDES + k] = 0.68 + 0.32 * clamp(c * 1.3 + big * 0.4, 0, 1);
  }
  // Bump slopes of the fleece (around and along the tube), so normals can be built
  // analytically each frame instead of with computeVertexNormals().
  const dTh = new Float32Array(disp.length), dU = new Float32Array(disp.length);
  const at = (r, k) => disp[clamp(r, 0, TUBE_RINGS - 1) * TUBE_SIDES + ((k + TUBE_SIDES) % TUBE_SIDES)];
  const arc = (Math.PI * 2) / TUBE_SIDES, ring = 1.9 / (TUBE_RINGS - 1) / 0.19; // ring spacing in tube radii
  for (let r = 0; r < TUBE_RINGS; r++) for (let k = 0; k < TUBE_SIDES; k++) {
    const i = r * TUBE_SIDES + k, d = disp[i];
    dTh[i] = (at(r, k + 1) - at(r, k - 1)) / (2 * arc * d);
    dU[i] = (at(r + 1, k) - at(r - 1, k)) / (2 * ring);
  }
  return (TUBE_DISP = { disp, shade, dTh, dU });
}

class NeckTube {
  constructor(material) {
    const { shade } = tubeDisplacement();
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(TUBE_RINGS * TUBE_SIDES * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.nrm = new Float32Array(TUBE_RINGS * TUBE_SIDES * 3);
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    const col = new Float32Array(TUBE_RINGS * TUBE_SIDES * 3);
    for (let i = 0; i < shade.length; i++) col.set([shade[i], shade[i], shade[i] * 0.97], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const idx = [];
    for (let r = 0; r < TUBE_RINGS - 1; r++) for (let k = 0; k < TUBE_SIDES; k++) {
      const a = r * TUBE_SIDES + k, b = r * TUBE_SIDES + (k + 1) % TUBE_SIDES;
      const c = a + TUBE_SIDES, d = b + TUBE_SIDES;
      idx.push(a, b, c, b, d, c); // counter-clockwise seen from outside
    }
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.pts = Array.from({ length: NECK_N + 3 }, () => new THREE.Vector3());
    this.curve = new THREE.CatmullRomCurve3(this.pts, false, 'centripetal');
    this.p = new THREE.Vector3(); this.t = new THREE.Vector3(); this.n = new THREE.Vector3(); this.b = new THREE.Vector3();
  }

  update(ll, thick) {
    const pts = this.pts;
    ll.neckBase.localToWorld(pts[0].set(0, -0.22, -0.14));   // buried in the chest
    ll.neckBase.localToWorld(pts[1].set(0, 0, 0));
    for (let i = 1; i < NECK_N; i++) ll.neck[i].g.localToWorld(pts[i + 1].set(0, 0, 0));
    ll.headPivot.localToWorld(pts[NECK_N + 1].set(0, 0, 0));
    ll.head.localToWorld(pts[NECK_N + 2].set(0, 0.07, -0.03)); // buried in the skull
    const { disp, dTh, dU } = tubeDisplacement();
    const P = this.pos, N = this.nrm, p = this.p, t = this.t, n = this.n, b = this.b;
    n.setFromMatrixColumn(ll.body.matrixWorld, 0).normalize();
    for (let r = 0; r < TUBE_RINGS; r++) {
      const u = r / (TUBE_RINGS - 1);
      this.curve.getPoint(u, p);
      this.curve.getTangent(u, t);
      n.addScaledVector(t, -n.dot(t)).normalize();   // parallel transport
      b.crossVectors(t, n);
      let rad = lerp(0.24, 0.15, smoothstep((u - 0.08) / 0.84));
      rad *= 1 + 0.25 * (1 - smoothstep(u / 0.12));    // flares into the chest
      rad *= lerp(1, 0.8, smoothstep((u - 0.9) / 0.1)); // tucks into the head
      rad *= thick;
      for (let k = 0; k < TUBE_SIDES; k++) {
        const th = (k / TUBE_SIDES) * Math.PI * 2;
        const d = rad * disp[r * TUBE_SIDES + k];
        // slightly deeper front-to-back than side-to-side, like a real neck
        const cs = Math.cos(th) * d, sn = Math.sin(th) * d * 1.08;
        const i = r * TUBE_SIDES + k, o = i * 3;
        P[o] = p.x + n.x * cs + b.x * sn;
        P[o + 1] = p.y + n.y * cs + b.y * sn;
        P[o + 2] = p.z + n.z * cs + b.z * sn;
        // radial normal, tilted by the fleece bump slopes (around: -sin/cos dir, along: tangent)
        const c0 = Math.cos(th), s0 = Math.sin(th), a = dTh[i], g = dU[i];
        let nx = n.x * c0 + b.x * s0 - (-n.x * s0 + b.x * c0) * a - t.x * g;
        let ny = n.y * c0 + b.y * s0 - (-n.y * s0 + b.y * c0) * a - t.y * g;
        let nz = n.z * c0 + b.z * s0 - (-n.z * s0 + b.z * c0) * a - t.z * g;
        const l = 1 / Math.hypot(nx, ny, nz);
        N[o] = nx * l; N[o + 1] = ny * l; N[o + 2] = nz * l;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }
}

let llamaCount = 0;

export class Llama {
  constructor(scene, course, opts = {}) {
    this.id = llamaCount++;
    this.scene = scene;
    this.course = course;
    this.name = opts.name || 'Llama';
    this.isPlayer = !!opts.isPlayer;
    this.palette = opts.palette || PALETTES[0];
    this.rand = rng(1234 + this.id * 77);

    this.pos = new THREE.Vector3().copy(opts.spawn || new THREE.Vector3());
    this.vel = new THREE.Vector3();
    this.yaw = opts.yaw || 0;
    this.yawRate = 0;
    this.grounded = false;
    this.support = null;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCut = true;

    this.prevVel = new THREE.Vector2();
    this.surge = { f: 0, s: 0, vf: 0, vs: 0 }; // body sloshing over the hooves (forward, sideways)
    this.acc = new THREE.Vector2();

    // Balance state: the neck as a springy inverted pendulum (world x/z lean in radians).
    this.lean = new THREE.Vector2();
    this.leanVel = new THREE.Vector2();
    this.ext = new THREE.Vector2(); // external forcing (wind etc.), cleared every frame

    this.wobbliness = 1;             // difficulty: scales how unstable the neck is
    this.state = 'normal';           // normal | toppled | rising
    this.stateT = 0;
    this.invuln = 0;
    this.tumble = 0;
    this.fallDir = new THREE.Vector2(1, 0);
    this.fallPitch = 0; this.fallRoll = 0;
    this.hitCD = {};

    this.duck = 0;
    this.neckScale = 1; this.neckScaleVel = 0;
    this.squash = 0; this.squashVel = 0;
    this.gaitPhase = this.rand();
    this.gaitW = 0;
    this.paceB = 0;
    this.gallopB = 0;
    this.bodyPitch = 0; this.bodyRoll = 0; this.bodyY = BODY_H;

    this.blinkT = 1 + this.rand() * 3; this.blink = 0;
    this.chew = this.rand() * 10;
    this.lookT = 0; this.lookYaw = 0; this.lookTarget = 0;
    this.lookAt = null;   // optional world point of interest (set by the game)
    this.annoyed = 0;     // ears pinned back after being hit
    this.earTwitch = [0, 0];

    this.headPos = new THREE.Vector3();
    this.neckPts = [new THREE.Vector3(), new THREE.Vector3()]; // mid and upper neck, for collisions
    this.events = {}; // onStep, onJump, onLand, onTopple, onHit

    this.build();
    this.resetLegs();
  }

  on(name, fn) { this.events[name] = fn; return this; }
  emit(name, ...a) { this.events[name]?.(this, ...a); }

  // -------------------------------------------------------------------------
  // Model
  // -------------------------------------------------------------------------

  build() {
    const pal = this.palette;
    const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, ...extra });
    const M = this.mats = {
      wool: std(pal.wool, { vertexColors: true }),
      face: std(pal.face),
      muzzle: std(new THREE.Color(pal.face).multiplyScalar(0.8)),
      faceWool: std(pal.face, { vertexColors: true }),
      dark: std(pal.dark, { roughness: 0.6 }),
      nail: std('#2a211d', { roughness: 0.45 }),
      eye: new THREE.MeshPhysicalMaterial({ color: '#120b08', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
      white: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      sclera: std('#fff6ea', { roughness: 0.4 }),
      teeth: std('#fffbe8', { roughness: 0.4 }),
      ear: std(pal.face, { vertexColors: true }),
      pom: std(pal.pom, { vertexColors: true }),
      blanket: std('#ffffff', { map: blanketTexture(pal.blanket), side: THREE.DoubleSide, roughness: 0.85 }),
      tassels: pal.blanket.map((c) => std(c)),
      star: new THREE.MeshBasicMaterial({ color: '#ffe14d' }),
    };

    const woolA = geo('woolA', () => woolGeometry(11, 7, { curlFreq: 5 }));
    const woolB = geo('woolB', () => woolGeometry(23, 7, { curlFreq: 5 }));
    const woolC = geo('woolC', () => woolGeometry(37, 7, { curlFreq: 5 }));
    const woolSmall = [woolA, woolB, woolC];
    const sphere = geo('sphere', () => new THREE.SphereGeometry(1, 28, 20));

    const mesh = (g, m, parent, pos, scale, rot) => {
      const o = new THREE.Mesh(g, m);
      if (pos) o.position.set(...pos);
      if (scale) o.scale.set(...scale);
      if (rot) o.rotation.set(...rot);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    };

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.body = new THREE.Group();
    this.body.position.y = BODY_H;
    this.root.add(this.body);

    // --- torso: barrel, chest and rump, all big fluffy fleece ---
    const torso = geo('torso', () => woolGeometry(5, 18, { sx: 0.45, sy: 0.41, sz: 0.74, lump: 0.1, curl: 0.07, curlFreq: 7 }));
    const chest = geo('chest', () => woolGeometry(8, 12, { sx: 0.37, sy: 0.41, sz: 0.33, lump: 0.1, curl: 0.08, curlFreq: 6 }));
    const rump = geo('rump', () => woolGeometry(9, 12, { sx: 0.41, sy: 0.39, sz: 0.34, lump: 0.1, curl: 0.08, curlFreq: 6 }));
    mesh(torso, M.wool, this.body, [0, 0.04, -0.02]);
    this.chestM = mesh(chest, M.wool, this.body, [0, 0.02, 0.44], null, [0.25, 0, 0]);
    this.rumpM = mesh(rump, M.wool, this.body, [0, 0.05, -0.5], null, [-0.15, 0, 0]);
    // belly fluff that hangs a little lower
    mesh(woolA, M.wool, this.body, [0, -0.2, 0], [0.3, 0.18, 0.5]);

    // --- blanket with fringe tassels ---
    const blanketGeo = geo('blanket', () => {
      const g = new THREE.CylinderGeometry(0.5, 0.5, 0.72, 40, 1, true, Math.PI - 1.15, 2.3);
      g.rotateX(Math.PI / 2);
      return g;
    });
    const blanket = mesh(blanketGeo, M.blanket, this.body, [0, 0.07, -0.02], [1.04, 0.96, 1]);
    blanket.castShadow = true;
    const tasselGeo = mergedGeo('tassel', [
      [new THREE.CylinderGeometry(0.008, 0.012, 0.09, 6).translate(0, -0.045, 0)],
      [new THREE.SphereGeometry(0.022, 10, 8), [0, -0.1, 0]],
    ]);
    this.tassels = [];
    for (const s of [1, -1]) {
      for (let i = 0; i < 7; i++) {
        const z = -0.33 + i * 0.11;
        const piv = new THREE.Group();
        piv.position.set(s * 0.456 * 1.04, 0.204 * 0.96 + 0.07, z - 0.02);
        this.body.add(piv);
        const m = M.tassels[(i + (s > 0 ? 0 : 2)) % 4];
        mesh(tasselGeo, m, piv).castShadow = false;
        this.tassels.push({ piv, side: s, ax: 0, az: 0, vx: 0, vz: 0 });
      }
    }

    // --- tail ---
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.2, -0.8);
    this.body.add(this.tail);
    mesh(woolB, M.wool, this.tail, [0, 0.11, 0], [0.085, 0.15, 0.08]);
    this.tailA = { x: -1.25, z: 0, vx: 0, vz: 0 };

    // --- neck: chain of vertebra pivots; the fleece is a NeckTube skinned over them ---
    this.neckBase = new THREE.Group();
    this.neckBase.position.set(0, 0.2, 0.55);
    this.body.add(this.neckBase);
    this.neck = [];
    let parent = this.neckBase;
    for (let i = 0; i < NECK_N; i++) {
      const g = new THREE.Group();
      g.position.y = i === 0 ? 0 : NECK_SEG;
      parent.add(g);
      this.neck.push({ g, ax: NECK_REST[i], az: 0, vx: 0, vz: 0 });
      parent = g;
    }

    // --- head ---
    this.headPivot = new THREE.Group();
    this.headPivot.position.y = NECK_SEG;
    parent.add(this.headPivot);
    this.head = new THREE.Group();
    this.headPivot.add(this.head);
    this.neckTube = new NeckTube(M.wool);
    this.scene.add(this.neckTube.mesh);
    const H = this.head;
    mesh(mergedGeo('skull', [
      [sphere, [0, 0.07, 0.0], [0.15, 0.135, 0.17]],                     // cranium
      [sphere, [0, 0.035, 0.17], [0.104, 0.094, 0.165], [0.12, 0, 0]],   // muzzle
      [sphere, [0, -0.01, 0.06], [0.12, 0.08, 0.13]],                    // cheeks / jowl
    ]), M.face, H);
    // camelid muzzle: soft darker tip, two puffy upper-lip pads split by a cleft
    mesh(mergedGeo('muzzleTip', [
      [sphere, [0, 0.045, 0.285], [0.08, 0.068, 0.062]],
      [sphere, [0.03, 0.002, 0.315], [0.042, 0.036, 0.036]],   // upper-lip pads
      [sphere, [-0.03, 0.002, 0.315], [0.042, 0.036, 0.036]],
    ]), M.muzzle, H);
    mesh(mergedGeo('nostrils', [
      [sphere, [0.036, 0.072, 0.335], [0.006, 0.02, 0.008], [-0.5, 0, 0.65]],  // slit nostrils
      [sphere, [-0.036, 0.072, 0.335], [0.006, 0.02, 0.008], [-0.5, 0, -0.65]],
      [sphere, [0, 0.008, 0.349], [0.004, 0.03, 0.008]],                        // lip cleft
    ]), M.dark, H).castShadow = false;
    mesh(woolC, M.faceWool, H, [0, 0.19, 0.03], [0.1, 0.075, 0.11]);                  // forelock tuft

    // dark mouth interior, only visible when the jaw drops
    mesh(sphere, std('#7a2f45', { roughness: 0.5 }), H, [0, -0.03, 0.225], [0.062, 0.03, 0.085]).castShadow = false;
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.005, 0.07);
    H.add(this.jaw);
    mesh(sphere, M.face, this.jaw, [0, -0.028, 0.12], [0.084, 0.042, 0.14]);
    mesh(geo('lip', () => new THREE.BoxGeometry(1, 1, 1)), M.teeth, this.jaw, [0, 0.0, 0.245], [0.05, 0.022, 0.016]);
    // tongue: flops out sideways when dazed (a proper llama "blep")
    this.tongue = new THREE.Group();
    this.tongue.position.set(0.02, -0.005, 0.2);
    this.jaw.add(this.tongue);
    mesh(geo('tongue', () => new THREE.CapsuleGeometry(1, 1.4, 6, 12).rotateX(Math.PI / 2).translate(0, 0, 1.2)),
      std('#ff7a9c', { roughness: 0.35 }), this.tongue, null, [0.03, 0.012, 0.045]).castShadow = false;
    this.tongue.scale.setScalar(0.001);

    // eyes: big glossy, with lids and lashes
    this.lids = [];
    for (const s of [1, -1]) {
      const ep = new THREE.Group();
      ep.position.set(s * 0.112, 0.105, 0.065);
      ep.rotation.y = s * 0.55;
      H.add(ep);
      mesh(sphere, M.sclera, ep, [0, 0, -0.008], [0.054, 0.056, 0.05]).castShadow = false; // thin pale rim
      mesh(sphere, M.eye, ep, [0, 0, 0], [0.05, 0.052, 0.05]).castShadow = false;
      mesh(sphere, M.white, ep, [-s * 0.012, 0.022, 0.038], [0.011, 0.011, 0.011]).castShadow = false;
      mesh(sphere, M.white, ep, [s * 0.016, -0.014, 0.043], [0.005, 0.005, 0.005]).castShadow = false;
      const lid = new THREE.Group();
      ep.add(lid);
      mesh(geo('lid', () => new THREE.SphereGeometry(0.057, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)), M.face, lid);
      const lash = new THREE.CylinderGeometry(0.0025, 0.004, 0.04, 5).translate(0, 0.02, 0);
      const lashes = [-1, 0, 1].map((k) => {
        const phi = k * 0.45 - s * 0.25;
        return [lash, [Math.sin(phi) * 0.056, 0, Math.cos(phi) * 0.056], undefined, [1.1, phi, 0]];
      });
      mesh(mergedGeo('lashes' + s, lashes), M.nail, lid).castShadow = false;
      // lower lid rim
      mesh(geo('lowlid', () => new THREE.TorusGeometry(0.05, 0.007, 6, 16, Math.PI)), M.face, ep, [0, -0.004, 0.006], null, [0.25, 0, Math.PI]);
      this.lids.push(lid);
    }

    // banana ears with pompom tassels
    this.ears = [];
    for (const s of [1, -1]) {
      const piv = new THREE.Group();
      piv.position.set(s * 0.078, 0.17, -0.045);
      H.add(piv);
      mesh(geo('ear' + s, () => bananaEar(s)), M.ear, piv);
      const pomPiv = new THREE.Group();
      pomPiv.position.set(s * 0.03, 0.06, -0.01);
      piv.add(pomPiv);
      mesh(geo('pomStr', () => new THREE.CylinderGeometry(0.004, 0.004, 0.07, 5).translate(0, -0.035, 0)), M.tassels[1], pomPiv);
      mesh(woolA, M.pom, pomPiv, [0, -0.085, 0], [0.032, 0.032, 0.032]);
      this.ears.push({ piv, pomPiv, side: s, ax: 0, az: 0, vx: 0, vz: 0, pa: 0, pv: 0 });
    }

    // dizzy stars (shown when toppled)
    this.stars = new THREE.Group();
    this.stars.visible = false;
    const starG = geo('star', () => new THREE.OctahedronGeometry(0.06, 0));
    for (let i = 0; i < 4; i++) mesh(starG, M.star, this.stars).castShadow = false;
    this.scene.add(this.stars);

    // --- legs (world-space meshes driven by IK) ---
    this.limbs = new THREE.Group();
    this.scene.add(this.limbs);
    const cyl = geo('legCyl', () => new THREE.CylinderGeometry(0.86, 1, 1, 12, 1));
    const sleeve = woolSmall;
    const thigh = geo('thigh', () => woolGeometry(51, 8, { curlFreq: 4.5 }));
    const toeG = geo('toe', () => new THREE.SphereGeometry(1, 16, 12));
    this.legs = LEG_DEFS.map((d, i) => {
      const front = d.front, s = d.side;
      const hip = new THREE.Vector3(s * (front ? 0.2 : 0.21), front ? -0.14 : -0.12, front ? 0.46 : -0.5);
      // fluffy shoulder / haunch, hinged at the top so it swings with the stride
      const thighPiv = new THREE.Group();
      thighPiv.position.set(hip.x * 1.05, hip.y + 0.06, hip.z + (front ? 0.02 : -0.03));
      this.body.add(thighPiv);
      mesh(thigh, M.wool, thighPiv, [0, -0.14, 0], front ? [0.16, 0.27, 0.19] : [0.18, 0.3, 0.23]);
      const upperJoint = hip.clone().add(new THREE.Vector3(0, -0.24, front ? 0.03 : -0.02));
      const leg = {
        ...d, upperJoint, thighPiv,
        restX: s * 0.215, restZ: front ? 0.47 : -0.5,
        L1: front ? 0.36 : 0.375, L2: 0.335,
        foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(),
        groundY: 0, state: 'stance', swingT: 0, swingDur: 0.3, lift: 0.1, curl: 0,
        wasSwing: false, skip: false, noGround: false,
        knee: new THREE.Vector3(), fet: new THREE.Vector3(), upperW: new THREE.Vector3(),
        flail: this.rand() * 10,
      };
      leg.sleeve = mesh(sleeve[i % 3], M.wool, this.limbs);
      leg.kneeM = mesh(sphere, M.face, this.limbs, null, [0.052, 0.052, 0.052]);
      leg.lower = mesh(cyl, M.face, this.limbs);
      leg.fetM = mesh(sphere, M.face, this.limbs, null, [0.044, 0.044, 0.044]);
      leg.footG = new THREE.Group();
      this.limbs.add(leg.footG);
      // pastern + two padded toes, each with a nail
      mesh(mergedGeo('foot', [
        [cyl, [0, -0.03, 0.022], [0.037, 0.075, 0.035], [0.55, 0, 0]],
        ...[1, -1].map((t) => [toeG, [t * 0.026, -0.058, 0.055], [0.031, 0.027, 0.06]]),
      ]), M.face, leg.footG);
      mesh(mergedGeo('nails', [1, -1].flatMap((t) => [
        [toeG, [t * 0.026, -0.06, 0.105], [0.018, 0.016, 0.022]],
        [toeG, [t * 0.026, -0.08, 0.05], [0.027, 0.006, 0.05]], // pads
      ])), M.nail, leg.footG).castShadow = false;
      return leg;
    });
  }

  // Turn this llama into a see-through replay ghost (no shadows, no collisions).
  makeGhost() {
    this.isGhost = true;
    const mats = [...Object.values(this.mats).flat()];
    for (const m of mats) { m.transparent = true; m.opacity = 0.33; m.depthWrite = false; }
    for (const root of [this.root, this.limbs, this.neckTube.mesh]) root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  }

  // Drive the ghost from a recorded frame; the gait, neck and legs animate themselves.
  ghostStep(dt, time, x, y, z, lx, lz, grounded) {
    if (dt < 1e-5) return;
    this.time = time;
    const jump = Math.hypot(x - this.pos.x, z - this.pos.z) > 3;
    const vx = jump ? 0 : (x - this.pos.x) / dt, vy = jump ? 0 : (y - this.pos.y) / dt, vz = jump ? 0 : (z - this.pos.z) / dt;
    this.acc.set(damp(this.acc.x, (vx - this.vel.x) / dt, 20, dt), damp(this.acc.y, (vz - this.vel.z) / dt, 20, dt));
    this.vel.set(vx, vy, vz);
    this.pos.set(x, y, z);
    this.lean.set(lx, lz);
    this.grounded = !!grounded;
    this.balance = clamp(this.lean.length() / TOPPLE, 0, 1);
    if (jump) { this.yaw = 0; this.resetLegs(); }
    this.updateGait(dt);
    this.updatePose(dt, NO_INPUT);
    this.updateLegs(dt);
  }

  // Put a hat on (index into HATS). Hats sit on the forelock, between the ears.
  setHat(i) {
    if (this.hat) { this.head.remove(this.hat); this.hat.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
    this.hat = null;
    this.hatIdx = i;
    this.propeller = null;
    if (!i) return;
    const g = new THREE.Group();
    g.position.set(0, 0.235, 0.02);
    const m = (geo, color, pos = [0, 0, 0], rot = [0, 0, 0], extra = {}) => {
      const o = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra }));
      o.position.set(...pos); o.rotation.set(...rot); o.castShadow = true;
      g.add(o);
      return o;
    };
    const accent = this.palette.blanket[0], second = this.palette.blanket[1];
    if (i === 1) { // party hat
      m(new THREE.ConeGeometry(0.075, 0.2, 20), accent, [0, 0.09, 0], [-0.15, 0, 0]);
      m(new THREE.SphereGeometry(0.025, 10, 8), second, [0, 0.19, -0.015]);
    } else if (i === 2) { // top hat
      m(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 24), '#231a22', [0, 0.005, 0]);
      m(new THREE.CylinderGeometry(0.075, 0.08, 0.14, 24), '#231a22', [0, 0.075, 0]);
      m(new THREE.CylinderGeometry(0.081, 0.081, 0.025, 24), accent, [0, 0.025, 0]);
    } else if (i === 3) { // beanie with a pompom
      m(new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), accent, [0, -0.01, 0], [0, 0, 0], { roughness: 1 });
      m(new THREE.TorusGeometry(0.095, 0.022, 8, 24), second, [0, -0.005, 0], [Math.PI / 2, 0, 0], { roughness: 1 });
      m(new THREE.SphereGeometry(0.035, 10, 8), '#ffffff', [0, 0.1, 0], [0, 0, 0], { roughness: 1 });
    } else if (i === 4) { // flower crown
      const cols = ['#ff70a6', '#ffd670', '#ffffff', '#70d6ff', '#ff9e00'];
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        m(new THREE.IcosahedronGeometry(0.028, 0), cols[k % cols.length], [Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11]);
        m(new THREE.SphereGeometry(0.012, 6, 6), '#ffe14d', [Math.cos(a) * 0.115, 0.012, Math.sin(a) * 0.115]);
      }
      m(new THREE.TorusGeometry(0.11, 0.008, 6, 30), '#5aa05a', [0, -0.008, 0], [Math.PI / 2, 0, 0]);
    } else if (i === 5) { // propeller cap: spins faster the faster you run
      m(new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), accent, [0, -0.01, 0]);
      m(new THREE.BoxGeometry(0.13, 0.012, 0.09), accent, [0, -0.005, 0.1]);
      m(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6), '#333333', [0, 0.11, 0]);
      const prop = new THREE.Group();
      prop.position.y = 0.14;
      g.add(prop);
      for (const sgn of [1, -1]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.006, 0.035), new THREE.MeshStandardMaterial({ color: sgn > 0 ? second : '#ff4f8b' }));
        b.position.x = sgn * 0.07; b.rotation.x = sgn * 0.3;
        prop.add(b);
      }
      this.propeller = prop;
    }
    if (i === 6) { // golden crown
      const gold = { roughness: 0.3, emissive: '#7a4b00', emissiveIntensity: 0.35 };
      m(new THREE.CylinderGeometry(0.1, 0.09, 0.06, 20, 1, true), '#ffd23f', [0, 0.03, 0], [0, 0, 0], { ...gold, side: THREE.DoubleSide });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        m(new THREE.ConeGeometry(0.025, 0.06, 6), '#ffd23f', [Math.cos(a) * 0.092, 0.085, Math.sin(a) * 0.092], [0, 0, 0], gold);
        m(new THREE.SphereGeometry(0.012, 8, 6), ['#ff4f8b', '#3fd6c6', '#5b3cc4'][k % 3], [Math.cos(a) * 0.097, 0.03, Math.sin(a) * 0.097], [0, 0, 0], { roughness: 0.2 });
      }
    }
    this.head.add(g);
    this.hat = g;
  }

  // Recolour an existing llama (used by the style picker).
  setPalette(pal) {
    this.palette = pal;
    const M = this.mats;
    M.wool.color.set(pal.wool);
    M.face.color.set(pal.face);
    M.muzzle.color.set(pal.face).multiplyScalar(0.8);
    M.faceWool.color.set(pal.face);
    M.ear.color.set(pal.face);
    M.dark.color.set(pal.dark);
    M.pom.color.set(pal.pom);
    M.blanket.map.dispose();
    M.blanket.map = blanketTexture(pal.blanket);
    M.blanket.needsUpdate = true;
    M.tassels.forEach((m, i) => m.color.set(pal.blanket[i]));
    if (this.hatIdx) this.setHat(this.hatIdx); // re-tint the hat to match
  }

  dispose() {
    this.scene.remove(this.root, this.limbs, this.stars, this.neckTube.mesh);
  }

  // -------------------------------------------------------------------------
  // Control
  // -------------------------------------------------------------------------

  respawn(p, yaw = 0) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.lean.set(0, 0);
    this.leanVel.set((this.rand() - 0.5) * 0.6, (this.rand() - 0.5) * 0.6);
    this.state = 'normal';
    this.tumble = 0;
    this.invuln = 1.5;
    this.grounded = false;
    this.support = null;
    this.neckScaleVel = 2;
    this.idleT = 0;
    Object.assign(this.surge, { f: 0, s: 0, vf: 0, vs: 0 });
    this.resetLegs();
  }

  resetLegs() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    for (const leg of this.legs) {
      leg.foot.set(this.pos.x + leg.restX * c + leg.restZ * s, this.pos.y, this.pos.z - leg.restX * s + leg.restZ * c);
      leg.state = 'stance';
      leg.groundY = this.pos.y;
    }
  }

  hit(impulse, severity = 0.5) {
    if (this.invuln > 0 || this.state !== 'normal') {
      this.vel.addScaledVector(impulse, 0.4);
      return;
    }
    this.vel.add(impulse);
    this.jumpCut = true;
    // the body is shoved, the heavy head lags behind
    this.leanVel.x -= impulse.x * 0.45;
    this.leanVel.y -= impulse.z * 0.45;
    this.jiggle(impulse.x * 2, impulse.z * 2);
    this.annoyed = 2.5;
    this.emit('onHit', severity);
    if (severity >= 1) this.topple(_v4.set(impulse.x, 0, impulse.z));
  }

  headHit(impulse) {
    if (this.invuln > 0 || this.state !== 'normal') return;
    this.leanVel.x += impulse.x * 0.8;
    this.leanVel.y += impulse.z * 0.8;
    this.vel.addScaledVector(impulse, 0.15);
    this.jiggle(impulse.x * 4, impulse.z * 4);
    this.annoyed = 2.5;
    this.emit('onHit', 0.6);
  }

  // Rebuild the neck tube; called once per rendered frame (not per physics substep).
  updateVisuals() {
    if (this.root.visible) this.neckTube.update(this, this.tubeThick || 1);
  }

  // Kick the visual neck springs (world-space direction).
  jiggle(wx, wz) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const f = wx * s + wz * c, r = -wx * c + wz * s;
    this.neck.forEach((n, i) => { n.vx += f * (i / NECK_N); n.vz += r * (i / NECK_N); });
  }

  topple(dir) {
    if (this.state !== 'normal') return;
    const d = new THREE.Vector2(dir.x, dir.z);
    if (d.lengthSq() < 1e-4) d.set(this.lean.x || 1, this.lean.y);
    d.normalize();
    this.fallDir.copy(d);
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const f = d.x * s + d.y * c, r = -d.x * c + d.y * s;
    // llamas go over sideways, with a bit of forward/back roll mixed in
    this.fallRoll = (r >= 0 ? 1 : -1) * 1.38;
    this.fallPitch = f * 0.5;
    this.state = 'toppled';
    this.stateT = 0;
    this.jumpCut = true;
    this.vel.y = Math.max(this.vel.y, 2.5);
    this.emit('onTopple');
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  update(dt, input, time) {
    if (dt < 1e-5) return;
    this.time = time;
    const inp = this.state === 'normal' ? input : NO_INPUT;
    this.invuln = Math.max(0, this.invuln - dt);
    // standing around for a while earns a big yawn
    const still = this.state === 'normal' && this.grounded && inp.moveLen < 0.05 && !inp.jump && !inp.duck && Math.hypot(this.vel.x, this.vel.z) < 0.3;
    this.idleT = still ? (this.idleT || 0) + dt : 0;
    for (const k in this.hitCD) this.hitCD[k] -= dt;
    this.stateT += dt;
    // mashing jump while down gets you up quicker
    if (this.state === 'toppled' && input.jump) { this.stateT += 0.22; this.neck.forEach((n, i) => { n.vz += (this.rand() - 0.5) * 3 * (i / NECK_N); }); }
    if (this.state === 'toppled' && this.stateT > 1.7 && this.grounded) { this.state = 'rising'; this.stateT = 0; }
    if (this.state === 'rising' && this.stateT > 0.75) {
      this.state = 'normal'; this.stateT = 0; this.invuln = 1.2;
      this.leanVel.set(-this.fallDir.x * 0.8, -this.fallDir.y * 0.8);
    }

    this.integrate(dt, inp);
    this.updateBalance(dt, inp);
    this.updateGait(dt);
    this.updatePose(dt, inp);
    this.updateLegs(dt);
    this.ext.set(0, 0);

    // soft glow pulse while invulnerable (just respawned / got up)
    const glow = this.invuln > 0 && this.state === 'normal' ? (0.5 + 0.5 * Math.sin(this.time * 18)) * Math.min(1, this.invuln * 2) * 0.22 : 0;
    if (glow > 0 || this.mats.wool.emissiveIntensity > 0) {
      this.mats.wool.emissive.set('#ffffff');
      this.mats.wool.emissiveIntensity = glow;
      this.mats.face.emissive.set('#ffffff');
      this.mats.face.emissiveIntensity = glow;
    }
  }

  integrate(dt, inp) {
    const v = this.vel;
    const normal = this.state === 'normal';
    this.duck = damp(this.duck, inp.duck ? 1 : 0, 8, dt);
    const maxS = PHYS.walk * lerp(1, 0.55, this.duck);
    let dvx = inp.x * maxS - v.x, dvz = inp.z * maxS - v.z;
    const dl = Math.hypot(dvx, dvz), sp = Math.hypot(v.x, v.z);
    let acc;
    if (!normal) acc = this.grounded ? 7 : 0.3;
    else if (!this.grounded) acc = PHYS.airAccel;
    else {
      // how much of this change fights the current momentum (stopping, reversing, sharp turns)
      const against = sp > 0.5 && dl > 1e-3 ? clamp(-(dvx * v.x + dvz * v.z) / (dl * sp), 0, 1) : 0;
      acc = lerp(PHYS.accel, PHYS.brake, against);
      // badly off balance, the hooves can't do what you ask: the head is driving now
      acc *= lerp(1, 0.35, smoothstep(((this.balance || 0) - 0.45) / 0.45));
      this.braking = against > 0.5 && sp > 2.2 ? Math.min(1, sp / PHYS.walk) : 0;
    }
    const maxDv = acc * dt;
    if (dl > maxDv) { dvx *= maxDv / dl; dvz *= maxDv / dl; }
    v.x += dvx; v.z += dvz;

    // The heavy head drags the body wherever it is leaning: that's the lurch.
    if (normal) {
      // ...and the further it leans, the harder it hauls you along (a stumbling lurch)
      const pull = (this.grounded ? NECK.pull : 1.2) * (1 + 2.2 * (this.balance || 0) ** 2);
      v.x += this.lean.x * pull * dt;
      v.z += this.lean.y * pull * dt;
    }

    // jump (buffered + coyote time)
    this.jumpBuffer = inp.jump ? 0.14 : Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    if (normal && this.jumpBuffer > 0 && this.coyote > 0) {
      v.y = PHYS.jumpV;
      this.jumpCut = false;
      if (this.support?.dynamic) { v.x += this.support.vel.x; v.z += this.support.vel.z; }
      this.grounded = false; this.coyote = 0; this.jumpBuffer = 0;
      this.neckScaleVel -= 2.2;   // neck squashes as the body launches
      this.squashVel += 1.2;
      this.emit('onJump');
    }

    // let go of jump early for a shorter hop (only when the input says so; bots always hold)
    if (inp.jumpHeld === false && !this.jumpCut && !this.grounded && v.y > 2 && v.y < PHYS.jumpV - 1.5) { v.y *= 0.55; this.jumpCut = true; }
    v.y -= PHYS.gravity * dt;

    // ride moving / spinning platforms
    if (this.grounded && this.support && this.support.dynamic) {
      this.support.carry(this.pos);
      this.yaw += this.support.dYaw;
      for (const leg of this.legs) if (leg.state === 'stance') this.support.carry(leg.foot);
    }

    this.pos.addScaledVector(v, dt);

    // walls
    this.course.pushOut(this, PHYS.radius);

    // ground
    const wasGrounded = this.grounded;
    const g = this.course.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.55, 0.22);
    if (g && v.y <= 0 && (this.pos.y <= g.y + 0.02 || (wasGrounded && this.pos.y - g.y < 0.4))) {
      if (!wasGrounded) this.land(-v.y);
      this.pos.y = g.y;
      v.y = 0;
      this.grounded = true;
      this.support = g.plat;
    } else {
      // walking off a moving platform keeps its momentum
      if (wasGrounded && this.support?.dynamic && v.y <= 0) { v.x += this.support.vel.x; v.z += this.support.vel.z; }
      this.grounded = false;
      this.support = null;
    }

    // measured acceleration (includes wall stops, hits, landing slides...)
    const ax = (v.x - this.prevVel.x) / dt, az = (v.z - this.prevVel.y) / dt;
    const al = Math.hypot(ax, az), cap = 40;
    const k = al > cap ? cap / al : 1;
    this.acc.x = damp(this.acc.x, ax * k, 30, dt);
    this.acc.y = damp(this.acc.y, az * k, 30, dt);
    this.prevVel.set(v.x, v.z);
  }

  land(impact) {
    this.jumpCut = true; // short-hop cutting only applies to a jump you started
    this.neckScaleVel -= impact * 0.13;
    this.squashVel -= impact * 0.07;
    // head keeps travelling when the feet stop
    this.leanVel.x += this.vel.x * 0.03 * Math.min(impact, 12) / 8;
    this.leanVel.y += this.vel.z * 0.03 * Math.min(impact, 12) / 8;
    this.jiggle(0, 0);
    this.neck.forEach((n, i) => { n.vx += impact * 0.08 * (i / NECK_N); });
    for (const leg of this.legs) {
      const gy = this.course.groundAt(leg.foot.x, leg.foot.z, this.pos.y + 0.5, 0);
      leg.foot.y = gy ? gy.y : this.pos.y;
      leg.groundY = leg.foot.y;
      leg.state = 'stance';
      leg.curl = 0;
    }
    this.emit('onLand', impact);
  }

  updateBalance(dt, inp) {
    const L = this.lean, LV = this.leanVel;
    if (this.state === 'normal') {
      const G = (this.grounded ? NECK.G : 1.5) * this.wobbliness;
      const A = this.grounded ? NECK.A : 0.05;
      // gentle idle sway so the neck always feels alive
      const n1 = noise3(this.time * 0.45, this.id * 3.1, 0) * 0.55;
      const n2 = noise3(this.time * 0.45, this.id * 3.1, 9) * 0.55;
      const K = NECK.K * lerp(1, 1.35, this.duck);
      // split the acceleration into the part that slows you down and the rest
      let ax = this.acc.x, az = this.acc.y, bx = 0, bz = 0;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (this.grounded && sp > 0.3) {
        const ux = this.vel.x / sp, uz = this.vel.z / sp, along = ax * ux + az * uz;
        if (along < 0) { bx = along * ux; bz = along * uz; ax -= bx; az -= bz; }
      }
      const Ab = this.grounded ? NECK.Ab : 0.05;
      const fx = -K * L.x - NECK.C * LV.x + G * Math.sin(L.x) - A * ax - Ab * bx + n1 + this.ext.x;
      const fz = -K * L.y - NECK.C * LV.y + G * Math.sin(L.y) - A * az - Ab * bz + n2 + this.ext.y;
      LV.x += fx * dt; LV.y += fz * dt;
      L.x += LV.x * dt; L.y += LV.y * dt;
      const m = L.length();
      if (m > TOPPLE && this.invuln <= 0) this.topple(_v4.set(L.x, 0, L.y));
      else if (m > 1.25) L.multiplyScalar(1.25 / m);
    } else if (this.state === 'toppled') {
      L.x = damp(L.x, this.fallDir.x * 1.5, 5, dt);
      L.y = damp(L.y, this.fallDir.y * 1.5, 5, dt);
      LV.set(0, 0);
    } else {
      L.x = damp(L.x, 0, 5, dt);
      L.y = damp(L.y, 0, 5, dt);
      LV.set(0, 0);
    }
    this.balance = clamp(L.length() / TOPPLE, 0, 1);
  }

  footTarget(leg, tAhead, stanceDur, out) {
    const yawF = this.yaw + this.yawRate * tAhead * 0.8;
    const c = Math.cos(yawF), s = Math.sin(yawF);
    let lx = this.vel.x * (tAhead + stanceDur * 0.5), lz = this.vel.z * (tAhead + stanceDur * 0.5);
    const ll = Math.hypot(lx, lz);
    if (ll > 0.75) { lx *= 0.75 / ll; lz *= 0.75 / ll; }
    out.x = this.pos.x + leg.restX * c + leg.restZ * s + lx;
    out.z = this.pos.z - leg.restX * s + leg.restZ * c + lz;
    const g = this.course.groundAt(out.x, out.z, this.pos.y + 0.6, 0);
    leg.noGround = !g;
    out.y = g ? g.y : this.pos.y - 0.25;
    return out;
  }

  updateGait(dt) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.speed = speed;
    this.gaitW = damp(this.gaitW, clamp(speed / 1.2, 0, 1), 6, dt);
    this.paceB = smoothstep((speed - 3.0) / 2.2);
    this.gallopB = damp(this.gallopB, smoothstep((speed - 5.0) / 1.0), 5, dt);
    const duty = lerp(lerp(0.66, 0.5, this.paceB), 0.36, this.gallopB);
    const freq = 1.05 + speed * 0.4;
    this.gaitPhase = (this.gaitPhase + freq * dt) % 1;
    const swingDur = (1 - duty) / freq, stanceDur = duty / freq;

    if (!this.grounded || this.state !== 'normal') return;

    for (const leg of this.legs) {
      const off = lerp(lerp(WALK_OFF[leg.id], PACE_OFF[leg.id], this.paceB), GALLOP_OFF[leg.id], this.gallopB);
      const lp = (this.gaitPhase - off + 2) % 1;
      const swingPhase = lp >= duty;
      if (leg.state === 'stance') {
        const trigger = swingPhase && !leg.wasSwing;
        // overstretched leg (shoved, spun on a platform...) steps on its own
        this.footTarget(leg, swingDur, stanceDur, leg.to);
        const dist = Math.hypot(leg.foot.x - leg.to.x, leg.foot.z - leg.to.z);
        const stretched = dist > 0.62 || Math.abs(leg.foot.y - leg.to.y) > 0.35;
        if ((trigger && (speed > 0.3 || dist > 0.08 || leg.noGround)) || stretched) {
          leg.state = 'swing';
          leg.swingT = 0;
          leg.swingDur = Math.max(0.14, stretched && !trigger ? 0.2 : swingDur);
          leg.from.copy(leg.foot);
          leg.lift = clamp(0.07 + speed * 0.035, 0.07, 0.26) + (leg.front ? 0.03 : 0);
        }
      }
      if (leg.state === 'swing') {
        leg.swingT += dt;
        const u = clamp(leg.swingT / leg.swingDur, 0, 1);
        this.footTarget(leg, (1 - u) * leg.swingDur, stanceDur, leg.to);
        const e = smoothstep(u);
        leg.foot.x = lerp(leg.from.x, leg.to.x, e);
        leg.foot.z = lerp(leg.from.z, leg.to.z, e);
        const base = lerp(leg.from.y, leg.to.y, e);
        // quick lift, softer set-down
        leg.foot.y = base + leg.lift * Math.sin(Math.PI * Math.pow(u, 0.8));
        leg.curl = Math.sin(Math.PI * Math.pow(u, 0.7)) * (leg.front ? 1.25 : 0.8);
        leg.groundY = base;
        if (u >= 1) {
          leg.foot.copy(leg.to);
          leg.state = 'stance';
          leg.curl = 0;
          leg.groundY = leg.foot.y;
          if (!leg.noGround) this.emit('onStep', leg.foot, speed);
        }
      }
      leg.wasSwing = swingPhase;
    }
  }

  updatePose(dt, inp) {
    const normal = this.state === 'normal';

    // --- heading ---
    let targetYaw = null;
    if (normal && this.speed > 0.35) targetYaw = Math.atan2(this.vel.x, this.vel.z);
    else if (normal && inp.moveLen > 0.1) targetYaw = Math.atan2(inp.x, inp.z);
    let step = 0;
    if (targetYaw !== null) {
      const dy = wrapAngle(targetYaw - this.yaw);
      step = clamp(dy, -PHYS.turnRate * dt, PHYS.turnRate * dt) * (this.grounded ? 1 : 0.4);
      this.yaw = wrapAngle(this.yaw + step);
    }
    this.yawRate = damp(this.yawRate, step / dt, 10, dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const fwdX = s, fwdZ = c, rightX = -c, rightZ = s;

    // --- body attitude from where the feet are ---
    let fy = 0, hy = 0, ly = 0, ry = 0;
    for (const leg of this.legs) {
      const y = (this.grounded ? leg.groundY : this.pos.y) - this.pos.y;
      if (leg.front) fy += y / 2; else hy += y / 2;
      if (leg.side > 0) ly += y / 2; else ry += y / 2;
    }
    const lf = this.lean.x * fwdX + this.lean.y * fwdZ;
    const ls = this.lean.x * rightX + this.lean.y * rightZ;
    const af = this.acc.x * fwdX + this.acc.y * fwdZ;
    const gw = this.gaitW;
    const gb = this.gallopB, ph = this.gaitPhase * Math.PI * 2;
    const sway = Math.sin(ph) * lerp(0.02, 0.07, this.paceB) * gw * (1 - gb);
    // gallop: rocking-horse pitch and a floaty bound between footfalls
    const bob = -Math.cos(ph * 2) * lerp(0.018, 0.03, this.paceB) * gw * (1 - gb) + Math.sin(ph - 0.9) * 0.07 * gb;
    // Whole-body inertia: the barrel is a jelly on four planted hooves. Brake and it
    // surges on, nose diving and rump kicking up; turn and it swings out wide. The
    // body also tips the way the neck is leaning, so you can see your balance.
    const as = this.acc.x * rightX + this.acc.y * rightZ;
    const S = this.surge;
    const live = normal && this.grounded ? 1 : 0.3;
    const tf = clamp(-af * 0.034, -0.24, 0.24) * live, ts = clamp(-as * 0.03, -0.2, 0.2) * live;
    S.vf += (75 * (tf - S.f) - 6.5 * S.vf) * dt;
    S.vs += (75 * (ts - S.s) - 6.5 * S.vs) * dt;
    S.f += S.vf * dt; S.s += S.vs * dt;
    let pitch = -Math.atan2(fy - hy, 0.97) * 0.85 + S.f * 1.6 + lf * 0.3 + Math.sin(ph - 0.4) * 0.1 * gb;
    let roll = Math.atan2(ly - ry, 0.43) * 0.5 + sway + S.s * 1.7 + ls * 0.32 - this.yawRate * this.speed * 0.012;
    if (!this.grounded && normal) pitch += clamp(-this.vel.y * 0.025, -0.15, 0.15);
    let height = BODY_H + clamp((fy + hy) * 0.5, -0.4, 0.4) * 0.7 + bob - this.duck * 0.08;

    // body squash spring
    this.squashVel += (-90 * this.squash - 9 * this.squashVel) * dt;
    this.squash += this.squashVel * dt;

    this.bodyPitch = damp(this.bodyPitch, clamp(pitch, -0.6, 0.6), 12, dt);
    this.bodyRoll = damp(this.bodyRoll, clamp(roll, -0.6, 0.6), 12, dt);
    this.bodyY = damp(this.bodyY, height, 16, dt);

    const tumbleTarget = this.state === 'toppled' ? 1 : 0;
    this.tumble = damp(this.tumble, tumbleTarget, this.state === 'toppled' ? 7 : 4.5, dt);
    const T = smoothstep(this.tumble);
    this.body.position.y = lerp(this.bodyY + this.squash * 0.6 + Math.abs(S.f) * 0.15, 0.47, T);
    this.body.position.z = S.f * 0.55 * (1 - T);
    this.body.position.x = -S.s * 0.55 * (1 - T);
    // camelids get up rear end first: tip nose-down mid-rise, then level out
    const rise = this.state === 'rising' ? Math.sin(clamp(this.stateT / 0.75, 0, 1) * Math.PI) * 0.32 : 0;
    this.body.rotation.x = lerp(this.bodyPitch, this.fallPitch, T) + rise;
    this.body.rotation.z = lerp(this.bodyRoll, this.fallRoll, T);
    // spine flex: chest and rump bend into turns and flex/extend with the gallop
    const bend = clamp(this.yawRate * 0.06, -0.18, 0.18) * (1 - T);
    const flex = Math.sin(this.gaitPhase * Math.PI * 2 - 0.6) * 0.08 * this.gallopB * gw;
    this.chestM.rotation.set(0.25 + flex, bend, 0);
    this.rumpM.rotation.set(-0.15 - flex, -bend, 0);
    this.chestM.position.x = bend * 0.25;
    this.rumpM.position.x = -bend * 0.3;
    // squash & stretch, plus a slow breath (faster when running)
    this.breath = (this.breath || this.rand() * 6) + dt * (1.6 + this.speed * 0.5);
    const br = Math.sin(this.breath) * 0.012;
    this.body.scale.set(1 - this.squash * 0.3 + br, 1 + this.squash * 0.6 + br, 1);

    // --- neck: lean distributed down the chain, plus per-vertebra jiggle springs ---
    // idle yawn: a big stretch of the neck with the jaw wide open (a 1.6s envelope)
    if (this.idleT > 3 && this.idleT < 7.5 && !this.yawnT && this.rand() < dt * 0.25) this.yawnT = 1.6;
    if (this.idleT < 0.01) this.yawnT = 0;
    this.yawnT = Math.max(0, (this.yawnT || 0) - dt);
    const yawn = this.yawnT > 0 ? Math.sin((1 - this.yawnT / 1.6) * Math.PI) : 0;
    this.neckScaleVel += (-130 * (this.neckScale - lerp(1, 0.8, this.duck) - yawn * 0.12) - 6 * this.neckScaleVel) * dt;
    this.neckScale = clamp(this.neckScale + this.neckScaleVel * dt, 0.55, 1.4);
    const ns = this.neckScale;
    const bodyX = this.body.rotation.x, bodyZ = this.body.rotation.z;
    const nod = Math.sin(this.gaitPhase * Math.PI * 4 + 0.6) * 0.035 * gw;
    let sumX = 0, sumZ = 0;
    for (let i = 0; i < NECK_N; i++) {
      const n = this.neck[i];
      const w = NECK_LEAN_W[i];
      const rest = lerp(NECK_REST[i], NECK_DUCK[i], this.duck);
      const prev = i > 0 ? this.neck[i - 1] : null;
      const tx = rest + (lf * 1.8 - bodyX) * w + (i > 5 ? nod * 0.3 : 0) - (prev ? prev.vx * 0.012 : 0);
      const tz = (ls * 1.8 - bodyZ) * w - (prev ? prev.vz * 0.012 : 0);
      const k = 170 - i * 9, damping = 8.5;
      n.vx += (k * (tx - n.ax) - damping * n.vx) * dt;
      n.vz += (k * (tz - n.az) - damping * n.vz) * dt;
      n.ax += n.vx * dt;
      n.az += n.vz * dt;
      n.g.rotation.set(n.ax, 0, n.az);
      if (i > 0) n.g.position.y = NECK_SEG * ns;
      sumX += n.ax; sumZ += n.az;
    }
    this.headPivot.position.y = NECK_SEG * ns;

    // --- head: stabilised to stay roughly level, looks where it's going ---
    this.lookT -= dt;
    if (this.lookT < 0) {
      this.lookT = 1.5 + this.rand() * 3;
      this.lookTarget = this.speed < 0.5 ? (this.rand() - 0.5) * 1.4 : 0;
    }
    let look = this.lookTarget;
    if (this.lookAt && this.speed < 2) {
      // curious glance at whatever's nearby
      look = clamp(wrapAngle(Math.atan2(this.lookAt.x - this.headPos.x, this.lookAt.z - this.headPos.z) - this.yaw), -1, 1) * 0.9;
    }
    if (inp.moveLen > 0.1) look = clamp(wrapAngle(Math.atan2(inp.x, inp.z) - this.yaw), -0.8, 0.8) * 0.7;
    look += this.yawRate * 0.08;
    this.lookYaw = damp(this.lookYaw, look, 5, dt);
    const headNod = Math.sin(this.gaitPhase * Math.PI * 4) * 0.05 * gw;
    this.headPivot.rotation.set(-sumX * 0.85 + 0.14 + headNod + this.duck * 0.25 - T * 0.4, 0, -sumZ * 0.8);
    this.head.rotation.y = this.lookYaw;

    // jaw chews side to side when idle, gapes when toppled
    this.chew += dt * (this.speed < 0.5 ? 3.2 : 0.8);
    const panic = this.state === 'normal' ? smoothstep((this.balance - 0.55) / 0.35) : 0;
    let open = this.state === 'toppled' ? 0.25 : Math.max(0, Math.sin(this.chew * 2)) * 0.06;
    open = Math.max(open, panic * 0.2, yawn * 0.42);
    this.jaw.rotation.x = damp(this.jaw.rotation.x, open, 12, dt);
    const blep = this.state === 'toppled' ? 1 : 0;
    this.tongue.scale.setScalar(Math.max(0.001, damp(this.tongue.scale.x, blep, 6, dt)));
    this.tongue.rotation.set(0.5, 0.6 + Math.sin(this.time * 9) * 0.15, 0);
    this.jaw.position.x = Math.sin(this.chew) * 0.012 * (this.speed < 0.5 ? 1 : 0.3);

    // blinking (and dazed half-closed eyes after a fall)
    this.blinkT -= dt;
    if (this.blinkT < 0) { this.blink = 1; this.blinkT = 2 + this.rand() * 4; }
    this.blink = Math.max(0, this.blink - dt * 7);
    // wide-eyed when about to topple, dazed half-closed after a fall
    const lidOpen = this.state === 'normal' ? lerp(lerp(-0.75, -1.25, panic), 1.2, smoothstep(yawn * 1.4 - 0.2)) : 0.55;
    const lidA = lerp(lidOpen, 1.5, Math.sin(Math.min(1, this.blink) * Math.PI));
    for (const lid of this.lids) lid.rotation.x = damp(lid.rotation.x, lidA, 30, dt);

    // ears: springy, swing against head motion, pin back when knocked over
    this.annoyed = Math.max(0, this.annoyed - dt);
    const earBase = this.state === 'normal' ? lerp(-0.12, -0.85, smoothstep(this.annoyed)) : -0.9;
    for (const e of this.ears) {
      const idx = e.side > 0 ? 0 : 1;
      if (this.rand() < dt * 0.25) this.earTwitch[idx] = 1;
      this.earTwitch[idx] = Math.max(0, this.earTwitch[idx] - dt * 5);
      const tx = earBase - lf * 0.4 - this.speed * 0.05 + this.earTwitch[idx] * 0.5;
      const tz = -e.side * 0.2 - ls * 0.3 * e.side + this.earTwitch[idx] * 0.25 * e.side;
      e.vx += (80 * (tx - e.ax) - 5 * e.vx) * dt - this.neck[NECK_N - 1].vx * dt * 6;
      e.vz += (80 * (tz - e.az) - 5 * e.vz) * dt - this.neck[NECK_N - 1].vz * dt * 6;
      e.ax += e.vx * dt; e.az += e.vz * dt;
      e.piv.rotation.set(e.ax, 0, e.az);
      // pompom dangles like a pendulum
      e.pv += (-40 * (e.pa + e.ax * 0.8) - 2.5 * e.pv) * dt - e.vx * dt * 3;
      e.pa += e.pv * dt;
      e.pomPiv.rotation.x = e.pa;
    }

    // tail and blanket tassels
    const tl = this.tailA;
    const ttx = -1.2 + af * 0.02 - this.vel.y * 0.02 + T * 0.8;
    const ttz = Math.sin(this.gaitPhase * Math.PI * 2) * 0.25 * gw + this.yawRate * 0.05;
    tl.vx += (60 * (ttx - tl.x) - 4 * tl.vx) * dt;
    tl.vz += (60 * (ttz - tl.z) - 4 * tl.vz) * dt;
    tl.x += tl.vx * dt; tl.z += tl.vz * dt;
    this.tail.rotation.set(tl.x, 0, tl.z);
    for (const t of this.tassels) {
      const tx = -af * 0.02 + clamp(this.speed * 0.06, 0, 0.4);
      const tz = t.side * 0.1 - this.body.rotation.z;
      t.vx += (50 * (tx - t.ax) - 3 * t.vx) * dt;
      t.vz += (50 * (tz - t.az) - 3 * t.vz) * dt + sway * 30 * dt;
      t.ax += t.vx * dt; t.az += t.vz * dt;
      t.piv.rotation.set(t.ax, 0, t.az);
    }

    this.root.updateMatrixWorld(true);
    this.head.localToWorld(this.headPos.set(0, 0.06, 0.08));
    this.neck[5].g.localToWorld(this.neckPts[0].set(0, 0, 0));
    this.neck[8].g.localToWorld(this.neckPts[1].set(0, 0, 0));
    if (this.propeller) this.propeller.rotation.y += dt * (4 + this.speed * 6);
    this.tubeThick = 1 / Math.sqrt(ns);

    // dizzy stars
    this.stars.visible = this.state !== 'normal' && T > 0.4;
    if (this.stars.visible) {
      this.stars.children.forEach((st, i) => {
        const a = this.time * 4 + (i / 4) * Math.PI * 2;
        st.position.set(this.headPos.x + Math.cos(a) * 0.28, this.headPos.y + 0.25 + Math.sin(a * 2) * 0.04, this.headPos.z + Math.sin(a) * 0.28);
        st.rotation.y = a * 2;
      });
    }
  }

  updateLegs(dt) {
    const T = smoothstep(this.tumble);
    const bm = this.body.matrixWorld;
    const bodyFwd = _v4.setFromMatrixColumn(bm, 2).normalize();
    const pole = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const standFet = new THREE.Vector3();
    _q1.setFromRotationMatrix(_m1.extractRotation(bm));
    const invBody = _m2.copy(bm).invert();
    const yawQ = new THREE.Quaternion().setFromEuler(_e1.set(this.body.rotation.x * 0.6, this.yaw, 0, 'YXZ'));

    for (const leg of this.legs) {
      // hip swings a little with the leg
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const restWX = this.pos.x + leg.restX * c + leg.restZ * s, restWZ = this.pos.z - leg.restX * s + leg.restZ * c;
      const fwdOff = (leg.foot.x - restWX) * s + (leg.foot.z - restWZ) * c;
      tmp.copy(leg.upperJoint);
      tmp.z += clamp(fwdOff * 0.3, -0.15, 0.15); // shoulder blade / pelvis rotate to extend reach
      leg.upperW.copy(tmp).applyMatrix4(bm);

      if (!this.grounded && this.state === 'normal') {
        // airborne: legs tuck and trail; a long fall turns into panicked paddling
        const flail = smoothstep((-this.vel.y - 7) / 5);
        const fl = this.time * 14 + leg.flail;
        tmp.set(
          leg.upperJoint.x * (1 + flail * 0.8),
          leg.upperJoint.y - (leg.front ? 0.48 : 0.5) + Math.sin(fl) * 0.12 * flail,
          leg.upperJoint.z + (leg.front ? 0.1 : -0.12) + Math.cos(fl) * 0.22 * flail);
        tmp.applyMatrix4(bm);
        tmp.addScaledVector(this.vel, -0.02);
        tmp.y = Math.max(tmp.y - FOOT_H, this.pos.y + 0.02); // never dangle below the landing plane
        const k = 1 - Math.exp(-14 * dt);
        leg.foot.lerp(tmp, k);
        leg.curl = damp(leg.curl, leg.front ? 1.2 : 0.6, 10, dt);
        leg.state = 'air';
      }

      standFet.copy(leg.foot);
      standFet.y += FOOT_H;
      standFet.addScaledVector(bodyFwd, -0.03 * leg.curl);

      if (T > 0.001) {
        // limp, kicking legs while toppled
        const fl = this.time * 9 + leg.flail;
        const kick = this.state === 'toppled' ? 1 : 0.3;
        tmp.set(leg.upperJoint.x * 1.3, leg.upperJoint.y - 0.55 + Math.sin(fl) * 0.08 * kick, leg.upperJoint.z + Math.cos(fl * 0.8) * 0.15 * kick);
        tmp.applyMatrix4(bm);
        const g = this.course.groundAt(tmp.x, tmp.z, tmp.y + 0.6, 0);
        if (g) tmp.y = Math.max(tmp.y, g.y + 0.06);
        standFet.lerp(tmp, T);
        if (T > 0.5) { leg.foot.copy(standFet); leg.foot.y -= FOOT_H; leg.state = 'stance'; leg.groundY = leg.foot.y; }
      }

      pole.copy(bodyFwd).multiplyScalar(leg.front ? 1 : -1);
      solveIK(leg.upperW, standFet, leg.L1, leg.L2, pole, leg.knee, leg.fet);

      // swing the shoulder/haunch fleece toward where the upper leg points
      tmp.copy(leg.knee).applyMatrix4(invBody).sub(leg.upperJoint);
      leg.thighPiv.rotation.x = clamp(-Math.atan2(tmp.z, -tmp.y) * (leg.front ? 0.45 : 0.35), -0.5, 0.5);

      placeSegment(leg.sleeve, leg.upperW, leg.knee, leg.front ? 0.088 : 0.1, leg.front ? 0.092 : 0.105, 0.6);
      leg.kneeM.position.copy(leg.knee);
      placeSegment(leg.lower, leg.knee, leg.fet, 0.04, 0.04);
      leg.fetM.position.copy(leg.fet);
      leg.footG.position.copy(leg.fet);
      leg.footG.quaternion.copy(yawQ).slerp(_q1, T);
      leg.footG.rotateX(leg.curl);
    }
  }
}

export { TOPPLE };
