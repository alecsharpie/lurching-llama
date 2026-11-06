import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, wrapAngle, canvasTexture, woolGeometry, rng, closestOnSegment } from './util.js';
import {
  grassTex, earthTex, woodTex, stoneTex, millTex, barkTex, ringsTex, hayTex, railTex, ashlarTex, aguayoTex, thatchTex,
  drawAguayoBand, ichuTussocks, rockColumn, bunting, pomMat,
} from './meadow.js';
import { Altiplano } from './altiplano.js';

const LAKE_Y = -26;
// A per-use copy of a shared texture (own repeat/offset, same image on the GPU).
function texCopy(t, rx = 1, ry = 1) {
  const c = t.clone();
  c.userData = {};
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}
// Painted obstacle colours: red means jump it, blue means duck under it.
const JUMP_RED = '#d6372f', DUCK_BLUE = '#2f6db5';

const STEP_UP = 0.55;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3();

function checkerTex(c1, c2, n = 8) {
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    const s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      ctx.fillStyle = (i + j) % 2 ? c1 : c2;
      ctx.fillRect(i * s, j * s, s, s);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function textTex(text, bg, fg, w = 1024, h = 192) {
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    // woven aguayo borders top and bottom
    const r = rng(text.length * 31);
    drawAguayoBand(ctx, 0, 0, w, h * 0.13, r, 2);
    drawAguayoBand(ctx, 0, h * 0.87, w, h * 0.13, r, 2);
    ctx.fillStyle = fg;
    ctx.font = `${Math.floor(h * 0.62)}px "Lilita One", "Arial Black", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  });
}

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
// Surfaces laid on top of other surfaces (grass caps, the finish line): lifted clear and
// pulled toward the camera in the depth buffer so they never fight with what's beneath.
const CAP_Y = 0.015;
const decal = (color, extra = {}, k = 1) => std(color, { polygonOffset: true, polygonOffsetFactor: -1 * k, polygonOffsetUnits: -4 * k, ...extra });

function shadowed(m) { m.castShadow = true; m.receiveShadow = true; return m; }

// A fat yarn pompom in wedges of hot pink, orange, yellow and teal, curly and shaded in its crevices.
let POMPOM = null;
function pompomGeometry() {
  if (POMPOM) return POMPOM;
  const g = woolGeometry(63, 5, { lump: 0.05, curl: 0.38, curlFreq: 13 });
  const p = g.attributes.position, col = g.attributes.color;
  const cols = ['#e91e63', '#ff7a1a', '#ffc928', '#1e9e8a', '#e91e63', '#7b2d8b'].map((c) => new THREE.Color(c));
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const c = cols[Math.floor(((a / (Math.PI * 2)) + 1) * cols.length) % cols.length];
    const sh = col.getX(i);
    col.setXYZ(i, c.r * sh, c.g * sh, c.b * sh);
  }
  POMPOM = g;
  return g;
}

// ---------------------------------------------------------------------------

class Platform {
  constructor(o) {
    Object.assign(this, { yaw: 0, hy: 0.5 }, o);
    this.pos = new THREE.Vector3(...(o.pos || [0, 0, 0]));
    this.dynamic = !!o.motion || !!o.belt;
    this.prevPos = this.pos.clone();
    this.prevYaw = this.yaw;
    this.dYaw = 0;
    this.vel = new THREE.Vector3();
  }

  update(t, dt) {
    this.dt = dt;
    if (this.belt) this.beltTex.offset.y -= (this.belt * dt) / 3; // scroll the conveyor surface
    if (!this.motion) return;
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    this.motion(t, this);
    this.dYaw = wrapAngle(this.yaw - this.prevYaw);
    if (dt > 0) this.vel.subVectors(this.pos, this.prevPos).divideScalar(dt);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  get top() { return this.pos.y + this.hy; }

  local(x, z, yaw = this.yaw, pos = this.pos) {
    const dx = x - pos.x, dz = z - pos.z, c = Math.cos(yaw), s = Math.sin(yaw);
    return [dx * c - dz * s, dx * s + dz * c];
  }

  topAt(x, z, m) {
    if (this.type === 'ramp') {
      if (Math.abs(x - this.cx) > this.w / 2 + m || z < this.z0 - m || z > this.z1 + m) return null;
      const t = clamp((z - this.z0) / (this.z1 - this.z0), 0, 1);
      return this.y0 + (this.y1 - this.y0) * t;
    }
    if (this.type === 'cyl') {
      return Math.hypot(x - this.pos.x, z - this.pos.z) <= this.r + m ? this.top : null;
    }
    const [lx, lz] = this.local(x, z);
    return Math.abs(lx) <= this.hx + m && Math.abs(lz) <= this.hz + m ? this.top : null;
  }

  // Move a world point rigidly with this platform's motion over the last frame.
  carry(v) {
    if (this.belt) v.z += this.belt * (this.dt || 0);
    const [lx, lz] = this.local(v.x, v.z, this.prevYaw, this.prevPos);
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    v.x = this.pos.x + lx * c + lz * s;
    v.z = this.pos.z - lx * s + lz * c;
    v.y += this.pos.y - this.prevPos.y;
  }

  pushOut(ch, r) {
    if (this.type === 'ramp') return;
    const top = this.top, bottom = this.pos.y - this.hy;
    if (top <= ch.pos.y + STEP_UP || bottom >= ch.pos.y + 1.5) return;
    let nx, nz, push;
    if (this.type === 'cyl') {
      const dx = ch.pos.x - this.pos.x, dz = ch.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d >= this.r + r) return;
      nx = d > 1e-5 ? dx / d : 1; nz = d > 1e-5 ? dz / d : 0;
      push = this.r + r - d;
    } else {
      const [lx, lz] = this.local(ch.pos.x, ch.pos.z);
      const cx = clamp(lx, -this.hx, this.hx), cz = clamp(lz, -this.hz, this.hz);
      let dx = lx - cx, dz = lz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return;
      let lnx, lnz;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2); lnx = dx / d; lnz = dz / d; push = r - d;
      } else {
        const ex = this.hx - Math.abs(lx), ez = this.hz - Math.abs(lz);
        if (ex < ez) { lnx = Math.sign(lx) || 1; lnz = 0; push = ex + r; } else { lnx = 0; lnz = Math.sign(lz) || 1; push = ez + r; }
      }
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      nx = lnx * c + lnz * s; nz = -lnx * s + lnz * c;
    }
    ch.pos.x += nx * push; ch.pos.z += nz * push;
    const vn = ch.vel.x * nx + ch.vel.z * nz;
    if (vn < 0) { ch.vel.x -= vn * nx; ch.vel.z -= vn * nz; }
  }
}


// A teeter-totter board pivoting about its centre (x axis). Tips under the
// weight of llamas standing on it, and their heavy heads count too.
class Seesaw {
  constructor(o) {
    Object.assign(this, o);
    this.pos = new THREE.Vector3(...o.pos);
    this.dynamic = true;
    this.dYaw = 0;
    this.vel = new THREE.Vector3();
    this.theta = 0; this.omega = 0; this.dTheta = 0;
    this.type = 'seesaw';
  }

  get top() { return this.pos.y + this.hy; }

  applyLoads(llamas, dt) {
    let torque = 0;
    for (const l of llamas) {
      if (l.support !== this) continue;
      torque += (l.pos.z - this.pos.z) + (l.headPos.z - this.pos.z) * 0.6;
    }
    const alpha = torque * 0.5 - 2.2 * this.omega - 2.4 * this.theta;
    this.omega += alpha * dt;
    const prev = this.theta;
    this.theta = clamp(this.theta + this.omega * dt, -this.maxTilt, this.maxTilt);
    if (this.theta !== prev + this.omega * dt) this.omega *= 0.3; // bump the end stop
    this.dTheta = this.theta - prev;
    this.mesh.rotation.x = this.theta;
  }

  update() {}

  topAt(x, z, m) {
    const lx = x - this.pos.x, lz = z - this.pos.z;
    if (Math.abs(lx) > this.hx + m || Math.abs(lz) > this.hz * Math.cos(this.theta) + m) return null;
    return this.pos.y + this.hy - lz * Math.tan(this.theta);
  }

  carry(v) {
    const d = this.dTheta, c = Math.cos(d), s = Math.sin(d);
    const dy = v.y - this.pos.y, dz = v.z - this.pos.z;
    v.y = this.pos.y + dy * c - dz * s;
    v.z = this.pos.z + dy * s + dz * c;
  }

  pushOut() {}
}

// ---------------------------------------------------------------------------

// A big spinning log lying across the course. Its top rolls back toward you like a
// treadmill, and the curved surface rocks your body as you cross.
// A big log lying along the track, spinning about its length. Its surface throws
// you sideways (and the spin keeps reversing), and anything off the crown rolls off.
class SpinLog {
  constructor(o) {
    Object.assign(this, o);
    this.pos = new THREE.Vector3(...o.pos);
    this.dynamic = true;
    this.dYaw = 0;
    this.vel = new THREE.Vector3();
    this.type = 'spinlog';
    this.dt = 0;
    this.surf = 0; // sideways surface speed at the crown
  }

  update(t, dt) {
    this.dt = dt;
    this.surf = this.spin * Math.sin(t * this.freq + this.phase);
    this.vel.set(this.surf, 0, 0);
    this.mesh.children[0].rotation.y -= (this.surf / this.r) * dt;
  }

  topAt(x, z, m) {
    const dx = x - this.pos.x;
    if (Math.abs(z - this.pos.z) > this.hl + m || Math.abs(dx) > this.r * 0.92 + m) return null;
    const d = Math.min(Math.abs(dx), this.r * 0.92);
    return this.pos.y + Math.sqrt(this.r * this.r - d * d);
  }

  carry(v) { v.x += this.surf * this.dt; }
  pushOut() {}
}

// A skinny plank that snakes left and right (and gently up and down) over the lake.
class WavyPlank {
  constructor(o) {
    Object.assign(this, o);
    this.pos = new THREE.Vector3(0, o.y, (o.z0 + o.z1) / 2);
    this.type = 'wavy';
    this.dynamic = false;
    this.vel = new THREE.Vector3();
  }

  centre(z) { const u = (z - this.z0) / (this.z1 - this.z0); return this.amp * Math.sin(u * Math.PI * 2 * this.waves); }
  height(z) { const u = (z - this.z0) / (this.z1 - this.z0); return this.y + this.bob * Math.sin(u * Math.PI * 2 * this.waves * 1.5); }
  get top() { return this.y; }

  topAt(x, z, m) {
    if (z < this.z0 - m || z > this.z1 + m) return null;
    const zc = clamp(z, this.z0, this.z1);
    return Math.abs(x - this.centre(zc)) <= this.w / 2 + m ? this.height(zc) : null;
  }

  update() {}
  carry() {}
  pushOut() {}
}

// A round platform on a ball joint: tips in any direction under the llamas on it.
class TiltDisc {
  constructor(o) {
    Object.assign(this, o);
    this.pos = new THREE.Vector3(...o.pos);
    this.dynamic = true;
    this.dYaw = 0;
    this.vel = new THREE.Vector3();
    this.type = 'tilt';
    this.tx = 0; this.tz = 0; this.wx = 0; this.wz = 0; this.dtx = 0; this.dtz = 0;
  }

  get top() { return this.pos.y + this.hy; }

  applyLoads(llamas, dt) {
    let mx = 0, mz = 0;
    for (const l of llamas) {
      if (l.support !== this) continue;
      mx += (l.pos.z - this.pos.z) + (l.headPos.z - this.pos.z) * 0.6;
      mz -= (l.pos.x - this.pos.x) + (l.headPos.x - this.pos.x) * 0.6;
    }
    // tips hard side to side, but only a little fore/aft so the bridges stay in reach
    const step = (a, w, m, max) => {
      w += (m * 0.2 - 1.5 * w - 1.4 * a) * dt;
      const na = clamp(a + w * dt, -max, max);
      if (na !== a + w * dt) w *= 0.3;
      return [na, w];
    };
    const ptx = this.tx, ptz = this.tz;
    [this.tx, this.wx] = step(this.tx, this.wx, mx, this.maxTiltX);
    [this.tz, this.wz] = step(this.tz, this.wz, mz * 1.4, this.maxTiltZ);
    this.dtx = this.tx - ptx; this.dtz = this.tz - ptz;
    this.mesh.rotation.set(this.tx, 0, this.tz);
  }

  update() {}

  topAt(x, z, m) {
    const lx = x - this.pos.x, lz = z - this.pos.z;
    if (Math.hypot(lx, lz) > this.r + m) return null;
    return this.pos.y + this.hy - lz * Math.tan(this.tx) + lx * Math.tan(this.tz);
  }

  carry(v) {
    // small rotations about the pivot: first about x (pitch), then z (roll)
    let dy = v.y - this.pos.y, dz = v.z - this.pos.z, dx = v.x - this.pos.x;
    let c = Math.cos(this.dtx), s = Math.sin(this.dtx);
    [dy, dz] = [dy * c - dz * s, dy * s + dz * c];
    c = Math.cos(this.dtz); s = Math.sin(this.dtz);
    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
    v.set(this.pos.x + dx, this.pos.y + dy, this.pos.z + dz);
  }

  pushOut() {}
}

// ---------------------------------------------------------------------------

export const COURSES = [
  { id: 'gauntlet', name: 'The Wobbly Gauntlet', sub: 'Sweepers · Sliders · Hay Hill · Windy Beams · Hammers · Spinners · Teeter-Totters' },
  { id: 'rumble', name: 'Log Roll Rumble', sub: 'Conveyor Pushers · Spinning Log · Wavy Plank · Tilting Table · Elevators · Pompom Bounces · Sweepers' },
  { id: 'duck', name: 'Duck Duck Llama', sub: 'Duck Bars · Hurdles · Sinking Stones · Head-Hunter Pendulums' },
];

export class Course {
  constructor(world, id = 'gauntlet') {
    this.world = world;
    this.scene = new THREE.Group(); // everything this course builds, so it can be swapped out
    world.add(this.scene);
    this.info = COURSES.find((c) => c.id === id) || COURSES[0];
    this.platforms = [];
    this.obstacles = [];
    this.bales = [];
    this.baleTimer = 0;
    this.rand = rng(42);
    this.wind = 0;
    this.windZone = null;
    this.fans = [];
    this.streaks = [];
    this.seesaws = [];
    this.tilts = [];
    this.pads = [];
    this.ramp = null;
    this.occluders = []; // static props the chase camera shouldn't clip through
    this.time = 0;
    this.sinkers = [];
    this.tufts = [];
    if (this.info.id === 'rumble') this.buildRumble();
    else if (this.info.id === 'duck') this.buildDuck();
    else this.buildGauntlet();
    this.buildDecor();
  }

  dispose() {
    this.world.remove(this.scene);
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) {
        if (!m.map?.userData.shared) m.map?.dispose();
        m.normalMap?.dispose();
        m.dispose();
      }
    });
  }

  addPlatform(o) {
    const p = new Platform(o);
    // pick a material look from what the platform does
    const look = o.look || (o.belt ? 'belt'
      : o.type === 'cyl' ? (o.motion ? 'mill' : 'turf')
        : o.motion || o.hy <= 0.4 ? 'wood' : 'turf');
    const sideMat = (rx, ry) => look === 'turf' ? std('#ffffff', { map: texCopy(earthTex(), rx, ry), roughness: 1 })
      : look === 'mill' || look === 'stone' ? std('#ffffff', { map: texCopy(stoneTex(), rx, ry), roughness: 0.95 })
        : look === 'hay' ? std('#ffffff', { map: texCopy(hayTex(), rx, ry), roughness: 1 })
          : std('#ffffff', { map: texCopy(woodTex(1), rx, ry), roughness: 0.9 });
    const topMat = (rx, ry) => {
      if (o.topTex) return decal('#ffffff', { map: o.topTex, roughness: 0.9 });
      const t = look === 'turf' ? grassTex() : look === 'mill' ? millTex() : look === 'stone' ? stoneTex() : look === 'hay' ? hayTex()
        : look === 'belt' ? railTex('#8a6141', 2) : woodTex();
      return decal('#ffffff', { map: look === 'mill' ? t : texCopy(t, rx, ry), roughness: 0.95 });
    };
    let mesh, beltTop = null;
    if (o.type === 'cyl') {
      mesh = new THREE.Group();
      const side = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 0.92, o.hy * 2, 48), sideMat(o.r, o.hy)));
      mesh.add(side);
      const cap = shadowed(new THREE.Mesh(new THREE.CircleGeometry(o.r - 0.02, 48), topMat(o.r / 2.5, o.r / 2.5)));
      cap.rotation.x = -Math.PI / 2; cap.position.y = o.hy + CAP_Y;
      mesh.add(cap);
      if (look === 'turf') {
        // a grassy lip that overhangs the earth a little
        const lip = shadowed(new THREE.Mesh(new THREE.TorusGeometry(o.r - 0.04, 0.13, 8, 48), std('#7e9a45', { roughness: 1 })));
        lip.rotation.x = Math.PI / 2; lip.position.y = o.hy - 0.06;
        mesh.add(lip);
      }
    } else if (o.type === 'ramp') {
      const len = Math.hypot(o.z1 - o.z0, o.y1 - o.y0), th = 1.0;
      const ang = Math.atan2(o.y1 - o.y0, o.z1 - o.z0);
      mesh = new THREE.Group();
      const box = shadowed(new THREE.Mesh(new RoundedBoxGeometry(o.w, th, len, 3, 0.18), sideMat(len / 4, 1)));
      box.position.y = -th / 2;
      mesh.add(box);
      const cap = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(o.w - 0.1, len - 0.1), topMat(o.w / 4, len / 4)));
      cap.rotation.x = -Math.PI / 2; cap.position.y = CAP_Y;
      mesh.add(cap);
      mesh.position.set(o.cx, (o.y0 + o.y1) / 2, (o.z0 + o.z1) / 2);
      mesh.rotation.x = -ang;
      p.pos.set(o.cx, (o.y0 + o.y1) / 2, (o.z0 + o.z1) / 2);
    } else {
      mesh = new THREE.Group();
      const box = shadowed(new THREE.Mesh(new RoundedBoxGeometry(o.hx * 2, o.hy * 2, o.hz * 2, 3, Math.min(0.2, o.hy * 0.9)),
        sideMat(Math.max(o.hx, o.hz) / 2, Math.max(0.5, o.hy))));
      mesh.add(box);
      const inset = look === 'turf' ? 0.1 : 0.3;
      const cap = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(o.hx * 2 - inset, o.hz * 2 - inset), topMat(o.hx / 2.5, o.hz / 2.5)));
      cap.rotation.x = -Math.PI / 2; cap.position.y = o.hy + CAP_Y;
      mesh.add(cap);
      if (o.belt) beltTop = cap.material.map;
      if (look === 'turf') {
        const lip = shadowed(new THREE.Mesh(new RoundedBoxGeometry(o.hx * 2 - 0.01, 0.2, o.hz * 2 - 0.01, 2, 0.08), std('#7e9a45', { roughness: 1 })));
        lip.position.y = o.hy - 0.13; // its top stays 3cm under the grass cap
        mesh.add(lip);
      }
    }
    if (beltTop) p.beltTex = beltTop;
    if (o.type !== 'ramp') { mesh.position.copy(p.pos); mesh.rotation.y = p.yaw; }
    this.scene.add(mesh);
    p.mesh = mesh;
    p.look = look;
    this.platforms.push(p);
    if (!o.motion && !o.belt) this.groundUnder(p);
    return p;
  }

  // Static platforms stand on rock columns rising out of the lake, and grow a few flowers.
  groundUnder(p) {
    const colMat = this.colMat || (this.colMat = std('#ffffff', { map: texCopy(stoneTex(), 2, 4), roughness: 1, vertexColors: true }));
    const column = (x, z, r, yTop) => {
      const h = yTop - LAKE_Y + 1;
      const m = shadowed(new THREE.Mesh(rockColumn(r, h), colMat));
      m.position.set(x, yTop - h / 2, z);
      this.scene.add(m);
    };
    if (p.type === 'cyl') column(p.pos.x, p.pos.z, p.r * 0.85, p.pos.y - p.hy + 0.05);
    else if (p.type === 'ramp') {
      for (let z = p.z0 + 4.5; z < p.z1 - 2; z += 8) column(p.cx, z, Math.min(p.w / 2, 3.5), p.topAt(p.cx, z, 0) - 1.4);
    } else if (p.look === 'wood') {
      // timber stilts under narrow walkways
      const stilt = this.stiltMat || (this.stiltMat = std('#ffffff', { map: texCopy(barkTex(), 1, 6), roughness: 1 }));
      const yTop = p.pos.y - p.hy, h = yTop - LAKE_Y;
      const g = this.stiltGeo || (this.stiltGeo = new THREE.CylinderGeometry(0.16, 0.22, 1, 8));
      for (let z = -p.hz + 0.6; z <= p.hz - 0.5; z += Math.max(2, (2 * p.hz - 1.2) / Math.ceil((2 * p.hz - 1.2) / 6))) {
        for (const sx of [-1, 1]) {
          const m = shadowed(new THREE.Mesh(g, stilt));
          m.scale.y = h;
          m.position.set(p.pos.x + sx * (p.hx - 0.25), yTop - h / 2, p.pos.z + z);
          this.scene.add(m);
        }
      }
    } else if (p.hx >= 1.5 && p.hz >= 1.5) {
      const n = Math.max(1, Math.round(p.hz / 5));
      for (let i = 0; i < n; i++) column(p.pos.x, p.pos.z - p.hz + (2 * p.hz * (i + 0.5)) / n, Math.min(p.hx, p.hz, 4) * 0.9, p.pos.y - p.hy + 0.05);
    }
    // flowers around the edges, clear of the racing line
    if (p.look === 'turf' && p.type === 'box' && p.hx >= 3) {
      const pts = [];
      for (let i = 0; i < p.hx * p.hz * 0.6; i++) {
        const x = (this.rand() * 2 - 1) * (p.hx - 0.3), z = (this.rand() * 2 - 1) * (p.hz - 0.3);
        if (Math.abs(x) < p.hx * 0.55 && Math.abs(z) < p.hz * 0.75) continue;
        pts.push([p.pos.x + x, p.pos.y + p.hy, p.pos.z + z]);
      }
      this.tufts.push(...pts);
    }
  }

  addSeesaw(z) {
    const sw = new Seesaw({ pos: [0, 5.6, z], hx: 1.5, hy: 0.4, hz: 5, maxTilt: 0.25 });
    const g = new THREE.Group();
    g.position.copy(sw.pos);
    const board = shadowed(new THREE.Mesh(new RoundedBoxGeometry(3, 0.8, 10, 3, 0.18), std('#ffffff', { map: texCopy(woodTex(1), 3, 1) })));
    g.add(board);
    const cap = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(2.8, 9.8), decal('#ffffff', { map: texCopy(woodTex(), 1, 3) })));
    cap.rotation.x = -Math.PI / 2; cap.position.y = 0.4 + CAP_Y;
    g.add(cap);
    this.scene.add(g);
    // fulcrum on a rock pillar rising from the lake
    const fulcrum = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.2, 3), std('#ffffff', { map: texCopy(stoneTex()) })));
    fulcrum.rotation.z = Math.PI / 2;
    fulcrum.rotation.x = Math.PI / 2;
    fulcrum.position.set(0, 4.7, z);
    fulcrum.userData.attached = true;
    this.scene.add(fulcrum);
    const pillar = shadowed(new THREE.Mesh(rockColumn(1.1, 4.2 - LAKE_Y), std('#ffffff', { map: texCopy(stoneTex(), 2, 4), vertexColors: true })));
    pillar.position.set(0, (4.2 + LAKE_Y) / 2, z);
    this.scene.add(pillar);
    sw.mesh = g;
    this.platforms.push(sw);
    return sw;
  }

  groundAt(x, z, maxY, margin = 0) {
    let best = null;
    for (const p of this.platforms) {
      const y = p.topAt(x, z, margin);
      if (y !== null && y <= maxY && (!best || y > best.y)) best = { y, plat: p };
    }
    return best;
  }

  pushOut(ch, r) {
    for (const p of this.platforms) p.pushOut(ch, r);
  }

  // -------------------------------------------------------------------------

  buildGauntlet() {

    // A: start
    this.addPlatform({ type: 'box', pos: [0, -0.6, 0], hx: 12, hy: 0.6, hz: 9 });
    this.addPlatform({ type: 'box', pos: [0, -0.6, 13], hx: 3.5, hy: 0.6, hz: 4 });
    // B: sweeper disk
    this.addPlatform({ type: 'cyl', pos: [0, -0.6, 29], r: 12, hy: 0.6 });
    this.addPlatform({ type: 'box', pos: [0, -0.6, 45.35], hx: 3.5, hy: 0.6, hz: 4.35 });
    // D: sliding platforms over the void
    this.slider = [];
    [52.5, 59.5, 66.5, 73.5].forEach((z, i) => {
      const ph = i * 1.9;
      this.slider.push(this.addPlatform({
        type: 'box', pos: [0, -0.4, z], hx: 2.4, hy: 0.4, hz: 2.75,
        motion: (t, p) => { p.pos.x = Math.sin(t * 0.7 + ph) * 4; },
      }));
    });
    // E: landing
    this.addPlatform({ type: 'box', pos: [0, -0.6, 83], hx: 5, hy: 0.6, hz: 5.5 });
    // F: hay-bale hill
    this.ramp = this.addPlatform({ type: 'ramp', cx: 0, w: 9, z0: 88.5, z1: 118, y0: 0, y1: 6 });
    // G
    this.addPlatform({ type: 'box', pos: [0, 5.4, 123], hx: 5, hy: 0.6, hz: 5 });
    // H: windy balance beams
    this.addPlatform({ type: 'box', pos: [0, 5.6, 135.85], hx: 1.0, hy: 0.4, hz: 7.85 });
    this.addPlatform({ type: 'cyl', pos: [0, 5.6, 146], r: 2.3, hy: 0.4 });
    this.addPlatform({ type: 'box', pos: [0, 5.6, 156.15], hx: 1.0, hy: 0.4, hz: 7.85 });
    // I
    this.addPlatform({ type: 'box', pos: [0, 5.4, 169], hx: 5, hy: 0.6, hz: 5 });
    // J: hammer walk
    this.addPlatform({ type: 'box', pos: [0, 5.6, 189], hx: 3, hy: 0.4, hz: 15 });
    // K: spinning disks
    [[209.5, 0.6], [219, -0.8], [228.5, 1.0]].forEach(([z, w], i) => {
      this.addPlatform({
        type: 'cyl', pos: [0, 5.4, z], r: 4.7, hy: 0.6,
        motion: (t, p) => { p.yaw = t * w; },
      });
    });
    // L: teeter-totters
    this.addPlatform({ type: 'box', pos: [0, 5.4, 236], hx: 4, hy: 0.6, hz: 2.5 });
    this.seesaws = [244, 259].map((z) => this.addSeesaw(z));
    this.addPlatform({ type: 'cyl', pos: [0, 5.4, 251.5], r: 2.2, hy: 0.6 });
    // M: finish
    this.addPlatform({ type: 'box', pos: [0, 5.4, 275], hx: 8, hy: 0.6, hz: 10.5 });
    this.finishZ = 274;
    this.finishY = 6;

    this.hayBales = true;
    this.buildBouncePads([[-2.3, 6, 125.2], [2.3, 6, 125.2]]);
    this.buildSweepers(new THREE.Vector3(0, 0, 29));
    this.buildHammers();
    this.buildWind();
    this.heightFn = (z) => (z < this.ramp.z0 ? 0 : z > this.ramp.z1 ? 6 : this.ramp.topAt(0, z, 0));

    this.checkpoints = [
      { z: -1e9, spawn: new THREE.Vector3(0, 0.5, -5) },
      { z: 42, spawn: new THREE.Vector3(0, 0.5, 45) },
      { z: 78, spawn: new THREE.Vector3(0, 0.5, 82) },
      { z: 119, spawn: new THREE.Vector3(0, 6.5, 122) },
      { z: 165, spawn: new THREE.Vector3(0, 6.5, 168) },
      { z: 205, spawn: new THREE.Vector3(0, 6.5, 207) },
      { z: 234, spawn: new THREE.Vector3(0, 6.5, 236) },
    ];

    const P = (x, z, w = 2) => ({ x, z, w });
    this.path = [
      P(0, 8, 3), P(0, 18, 2), P(0, 29, 3), P(0, 40, 2), P(0, 48.6, 1.5),
      ...this.slider.map((plat) => ({ plat })),
      P(0, 79.5, 2), P(0, 89, 3), P(0, 117.5, 3), P(0, 124, 2), P(0, 128.6, 0.05),
      P(0, 143.5, 0.05), P(0, 146, 0.3), P(0, 148.6, 0.05), P(0, 163.5, 0.05),
      P(0, 168, 2), P(0, 175, 1.2), P(0, 203.5, 1.2), P(0, 209.5, 1.5), P(0, 219, 1.5), P(0, 228.5, 1.5),
      P(0, 236, 2), P(0, 248.5, 0.4), P(0, 251.5, 0.8), P(0, 263.5, 0.4), P(0, 268, 3), P(0, 282, 4),
    ];
  }

  buildRumble() {
    const D = 16; // everything after the log and the plank
    // start
    this.addPlatform({ type: 'box', pos: [0, -0.6, 0], hx: 12, hy: 0.6, hz: 9 });
    // conveyor belt running backwards, with sliding hay-bale pushers
    this.addPlatform({ type: 'box', pos: [0, -0.6, 21], hx: 3.5, hy: 0.6, hz: 12, belt: -2.2 });
    [[15, 0], [22, 2.1], [29, 4.2]].forEach(([z, ph]) => this.addPlatform({
      type: 'box', pos: [0, 0.9, z], hx: 1.1, hy: 0.9, hz: 0.7, look: 'hay',
      motion: (t, p) => { p.pos.x = Math.sin(t * 1.25 + ph) * 2.6; },
    }));
    this.addPlatform({ type: 'box', pos: [0, -0.6, 36], hx: 3.5, hy: 0.6, hz: 3 });
    // log roll: a big spinning log along the track that keeps changing direction
    this.spinLog = this.addSpinLog(39.4, 52.6, 1.15);
    this.addPlatform({ type: 'box', pos: [0, -0.6, 55.2], hx: 3, hy: 0.6, hz: 2.6 });
    // a skinny wavy plank
    this.wavy = this.addWavy({ z0: 57.8, z1: 72.2, y: 0 });
    this.addPlatform({ type: 'box', pos: [0, -0.6, 62.5 + D], hx: 4, hy: 0.6, hz: 5 });
    // narrow bridge, tilting disc, narrow bridge
    this.addPlatform({ type: 'box', pos: [0, -0.4, 69.35 + D], hx: 1.2, hy: 0.4, hz: 1.85 }); // a gap so the tipping table clears it
    this.addTilt(78 + D);
    this.addPlatform({ type: 'box', pos: [0, -0.4, 86.65 + D], hx: 1.2, hy: 0.4, hz: 1.85 });
    // elevators bobbing up toward the plateau
    this.elevators = [0.6, 1.9, 3.2, 4.5].map((top, i) => this.addPlatform({
      type: 'box', pos: [0, top - 0.4, 90.9 + D + i * 5.2], hx: 2.2, hy: 0.4, hz: 2.2,
      motion: (t, p) => { p.pos.y = top - 0.4 + Math.sin(t * 1.0 + i * 1.6) * 1.0; },
    }));
    this.addPlatform({ type: 'box', pos: [0, 5.4, 114.5 + D], hx: 5, hy: 0.6, hz: 5 });
    // toadstools up to the top deck
    this.buildBouncePads([[-2.6, 6, 117.5 + D], [0, 6, 117.5 + D], [2.6, 6, 117.5 + D]], { aim: 0.15, minVz: 6 });
    this.addPlatform({ type: 'box', pos: [0, 8.4, 130 + D], hx: 5, hy: 0.6, hz: 7.5 });
    // sweeper finale
    this.addPlatform({ type: 'cyl', pos: [0, 8.4, 148.5 + D], r: 11, hy: 0.6 });
    this.buildSweepers(new THREE.Vector3(0, 9, 148.5 + D), 10.6, 10.2);
    this.addPlatform({ type: 'box', pos: [0, 8.4, 170 + D], hx: 8, hy: 0.6, hz: 10.5 });
    this.finishZ = 169.5 + D;
    this.finishY = 9;

    this.heightFn = (z) => (z < 88.5 + D ? 0 : z < 109.5 + D ? (6 * (z - 88.5 - D)) / 21 : z < 122 + D ? 6 : 9);
    this.checkpoints = [
      { z: -1e9, spawn: new THREE.Vector3(0, 0.5, -5) },
      { z: 53.5, spawn: new THREE.Vector3(0, 0.5, 55) },
      { z: 57.5 + D, spawn: new THREE.Vector3(0, 0.5, 62 + D) },
      { z: 110 + D, spawn: new THREE.Vector3(0, 6.5, 112.5 + D) },
      { z: 124 + D, spawn: new THREE.Vector3(0, 9.5, 127.5 + D) },
    ];
    const P = (x, z, w = 2) => ({ x, z, w });
    const plank = [];
    for (let z = 58.4; z < 72; z += 1.2) plank.push(P(this.wavy.centre(z), z, 0.05));
    this.path = [
      P(0, 8, 2), P(0, 33.5, 1.2), P(0, 38.6, 0.05), P(0, 45, 0.05), P(0, 52.4, 0.05), P(0, 55, 1), ...plank,
      P(0, 73.5, 1), P(0, 82, 1), P(0, 71 + D, 0.2), P(0, 78 + D, 0.6),
      P(0, 84.8 + D, 0.2), P(0, 88.2 + D, 0.4), ...this.elevators.map((plat) => ({ plat })),
      P(0, 111 + D, 1.5), P(0, 117.5 + D, 5.2), P(0, 127 + D, 2), P(0, 148.5 + D, 3), P(0, 162 + D, 2), P(0, 177 + D, 4),
    ];
  }

  // A course about the neck: bars at head height you must duck, low hurdles you must
  // jump, stepping stones that sink under you, and pendulums that swing at head height.
  buildDuck() {
    this.addPlatform({ type: 'box', pos: [0, -0.6, 0], hx: 12, hy: 0.6, hz: 9 });
    // the duck-and-jump corridor
    this.addPlatform({ type: 'box', pos: [0, -0.6, 25.6], hx: 3, hy: 0.6, hz: 16.6 });
    [[15, 'duck'], [21, 'hurdle'], [27, 'duck'], [31, 'hurdle'], [36, 'duck']].forEach(([z, kind]) => this.addBar(z, 0, kind, 3));
    // sinking stepping stones, three lanes wide so the pack spreads out
    const rows = Array.from({ length: 9 }, (_, i) => 44.5 + i * 4.3);
    rows.forEach((z, row) => [-2.8, 0, 2.8].forEach((x, lane) => {
      const ph = row * 1.3 + lane * 2.1;
      const p = this.addPlatform({
        type: 'cyl', pos: [x, -0.6, z], r: 1.36, hy: 0.6, look: 'stone',
        // slow settle at first, then it plunges into the lake
        motion: (t, pl) => { const k = pl.sink || 0; pl.pos.y = -0.6 - (0.35 * k + 22 * k ** 4) + Math.sin(t * 2 + ph) * 0.04; },
      });
      p.sink = 0;
      this.sinkers.push(p);
    }));
    this.addPlatform({ type: 'box', pos: [0, -0.6, 85.5], hx: 5, hy: 0.6, hz: 5 });
    // ramp up with head-height pendulums
    this.ramp = this.addPlatform({ type: 'ramp', cx: 0, w: 7, z0: 90.5, z1: 114, y0: 0, y1: 5 });
    const rampY = (z) => (5 * (z - 90.5)) / 23.5;
    this.buildHammers([96, 103, 110].map((z) => [z, rampY(z)]), 2.25, true);
    this.addPlatform({ type: 'box', pos: [0, 4.4, 118], hx: 5, hy: 0.6, hz: 4 });
    // last gauntlet: narrow catwalk with alternating bars, then the finish
    this.addPlatform({ type: 'box', pos: [0, 4.6, 131], hx: 1.6, hy: 0.4, hz: 9 });
    [[125, 'duck'], [129, 'hurdle'], [133, 'duck'], [137, 'duck']].forEach(([z, kind]) => this.addBar(z, 5, kind, 1.6));
    this.addPlatform({ type: 'box', pos: [0, 4.4, 150.5], hx: 8, hy: 0.6, hz: 10.5 });
    this.finishZ = 149;
    this.finishY = 5;

    this.heightFn = (z) => (z < 90.5 ? 0 : z < 114 ? rampY(z) : 5);
    this.checkpoints = [
      { z: -1e9, spawn: new THREE.Vector3(0, 0.5, -5) },
      { z: 38, spawn: new THREE.Vector3(0, 0.5, 38.5) },
      { z: 81, spawn: new THREE.Vector3(0, 0.5, 85) },
      { z: 114.5, spawn: new THREE.Vector3(0, 5.5, 118) },
    ];
    const P = (x, z, w = 2) => ({ x, z, w });
    this.path = [
      P(0, 8, 2), { x: 0, z: 36.5, w: 0, lanes: [-2.4, 0, 2.4] }, ...rows.map((z) => ({ x: 0, z, w: 0, lanes: [-2.8, 0, 2.8] })), P(0, 81.5, 2),
      P(0, 91, 2), P(0, 113.5, 2), P(0, 121.5, 0.5), P(0, 140.5, 0.2), P(0, 158, 4),
    ];
  }

  // A static bar across the path: 'duck' sits at head height, 'hurdle' at shin height.
  addBar(z, floor, kind, halfW) {
    const y = floor + (kind === 'duck' ? 2.1 : 0.35);
    const r = kind === 'duck' ? 0.2 : 0.18;
    const g = new THREE.Group();
    const bar = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r, r, halfW * 2, 16),
      std('#ffffff', { map: railTex(kind === 'duck' ? DUCK_BLUE : JUMP_RED, 12) })));
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, y, z);
    g.add(bar);
    for (const s of [1, -1]) {
      const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, y - floor + 0.2, 8), std('#ffffff', { map: texCopy(barkTex(), 1, 2) })));
      post.position.set(s * (halfW - 0.14), (y + floor) / 2, z);
      g.add(post);
      const knob = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.3, 8), std('#6b4a2e')));
      knob.position.set(s * (halfW - 0.14), y + 0.2, z);
      g.add(knob);
    }
    this.scene.add(g);
    this.obstacles.push({ kind: 'bar', id: 'bar' + z, z, y, r, halfW, low: kind === 'hurdle' });
  }

  updateBar(o, llamas) {
    for (const ll of llamas) {
      if ((ll.hitCD[o.id] || 0) > 0 || Math.abs(ll.pos.x) > o.halfW + 0.5) continue;
      if (o.low) {
        // body vs hurdle: the llama's chest/legs span roughly 0.2..1.4m
        if (Math.abs(ll.pos.z - o.z) < o.r + 0.5 && ll.pos.y + 0.15 < o.y + o.r && ll.pos.y + 1.4 > o.y) {
          const dir = ll.pos.z < o.z ? -1 : 1;
          ll.pos.z = o.z + dir * (o.r + 0.52);
          _n.set(ll.vel.x * 0.3, 2.5, dir * 3.2);
          ll.vel.z = 0;
          ll.hit(_n, Math.abs(ll.speed) > 3.5 ? 1 : 0.6); // trip over it at speed
          ll.hitCD[o.id] = 0.5;
        }
        continue;
      }
      for (const pt of [ll.headPos, ...ll.neckPts]) {
        // the head/neck sits ~0.14m above these points and hangs ~0.2m below
        if (Math.abs(pt.z - o.z) < o.r + 0.2 && pt.y + 0.14 > o.y - o.r && pt.y - 0.2 < o.y + o.r) {
          const dir = pt.z < o.z ? -1 : 1;
          _n.set(0, 0, dir * 3);
          ll.headHit(_n);
          ll.vel.z = dir * Math.min(Math.abs(ll.vel.z), 1);
          ll.hitCD[o.id] = 0.5;
          break;
        }
      }
    }
  }

  addSpinLog(z0, z1, r, opts = {}) {
    const log = new SpinLog({ pos: [0, -r, (z0 + z1) / 2], r, hl: (z1 - z0) / 2, spin: 2.4, freq: 0.75, phase: 0, ...opts });
    const g = new THREE.Group();
    g.position.copy(log.pos);
    const spinner = new THREE.Group();
    spinner.rotation.x = Math.PI / 2; // cylinder axis along z
    const m = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r, r, z1 - z0, 32, 1, false),
      [std('#ffffff', { map: texCopy(barkTex(), 3, (z1 - z0) / 3), roughness: 1 }), std('#ffffff', { map: ringsTex() }), std('#ffffff', { map: ringsTex() })]));
    spinner.add(m);
    g.add(spinner);
    // iron axle hubs bolted into the platforms at each end
    for (const z of [z0 - 0.35, z1 + 0.35]) {
      const hub = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 12), std('#4a4a4a', { metalness: 0.4, roughness: 0.5 })));
      hub.rotation.x = Math.PI / 2;
      hub.position.set(0, -r, z);
      hub.userData.attached = true;
      this.scene.add(hub);
    }
    log.mesh = g;
    this.scene.add(g);
    this.platforms.push(log);
    return log;
  }

  addWavy(o) {
    const wp = new WavyPlank({ w: 0.9, amp: 1.6, waves: 1, bob: 0.25, ...o });
    // a ribbon along the curve: plank top plus thick sides, textured with boards
    const N = 120, th = 0.22, pos = [], uv = [], idx = [];
    const L = wp.z1 - wp.z0;
    for (let i = 0; i <= N; i++) {
      const z = wp.z0 + (L * i) / N, cx = wp.centre(z), y = wp.height(z), v = (L * i) / N / 1.2;
      for (const [x, yy, u] of [[cx - wp.w / 2, y - th, 0], [cx - wp.w / 2, y, 0.1], [cx + wp.w / 2, y, 0.9], [cx + wp.w / 2, y - th, 1]]) {
        pos.push(x, yy, z); uv.push(u, v);
      }
    }
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) {
      const a = i * 4 + k, b = a + 1, c = a + 4, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tex = texCopy(woodTex(), 0.25, 1);
    const mesh = shadowed(new THREE.Mesh(g, std('#ffffff', { map: tex, side: THREE.DoubleSide })));
    this.scene.add(mesh);
    wp.mesh = mesh;
    // rope-lashed stilts every few metres
    const stilt = std('#ffffff', { map: texCopy(barkTex(), 1, 6), roughness: 1 });
    for (let z = wp.z0 + 1; z < wp.z1; z += 3.2) {
      const y = wp.height(z) - th, h = y - LAKE_Y;
      const m = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, h, 7), stilt));
      m.position.set(wp.centre(z), y - h / 2, z);
      this.scene.add(m);
    }
    this.platforms.push(wp);
    return wp;
  }

  addTilt(z) {
    const td = new TiltDisc({ pos: [0, -0.4, z], r: 6.5, hy: 0.4, maxTiltX: 0.08, maxTiltZ: 0.34 });
    const g = new THREE.Group();
    g.position.copy(td.pos);
    // a big wooden table-top balanced on a boulder
    const side = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.3, 0.8, 64), std('#ffffff', { map: texCopy(woodTex(1), 8, 1) })));
    g.add(side);
    const cap = shadowed(new THREE.Mesh(new THREE.CircleGeometry(6.48, 64), decal('#ffffff', { map: texCopy(woodTex(), 3, 3) })));
    cap.rotation.x = -Math.PI / 2; cap.position.y = 0.4 + CAP_Y;
    g.add(cap);
    const rim = shadowed(new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.12, 10, 64), std('#5a3b20')));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.34;
    g.add(rim);
    this.scene.add(g);
    const ball = shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), std('#ffffff', { map: texCopy(stoneTex()), flatShading: true })));
    ball.position.set(0, -1.5, z);
    ball.userData.attached = true;
    this.scene.add(ball);
    const pillar = shadowed(new THREE.Mesh(rockColumn(1.3, -2.2 - LAKE_Y), std('#ffffff', { map: texCopy(stoneTex(), 2, 4), vertexColors: true })));
    pillar.position.set(0, (-2.2 + LAKE_Y) / 2, z);
    this.scene.add(pillar);
    td.mesh = g;
    this.platforms.push(td);
    this.tilts.push(td);
    return td;
  }

  // opts.aim pulls the launch toward x=0; opts.minVz guarantees enough forward carry
  buildBouncePads(spots, opts = {}) {
    const { aim = 1.1, minVz = 0 } = opts;
    this.pads = spots.map(([x, y, z]) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      // a giant springy yarn pompom (like the tassels herders tie in their llamas' ears) on a woven drum
      const base = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.3, 16), std('#ffffff', { map: aguayoTex(2) })));
      base.position.y = 0.12;
      g.add(base);
      const coil = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.3, 16), std('#f6efdf')));
      g.add(coil);
      const top = new THREE.Group();
      const capM = shadowed(new THREE.Mesh(pompomGeometry(), std('#ffffff', { vertexColors: true, roughness: 1 })));
      capM.scale.set(0.95, 0.5, 0.95);
      top.add(capM);
      g.add(top);
      this.scene.add(g);
      return { x, y, z, r: 0.95, top, coil, squash: 0, vel: 0, aim, minVz };
    });
  }

  updatePads(dt, llamas) {
    for (const p of this.pads) {
      // springy visual
      p.vel += (-260 * p.squash - 10 * p.vel) * dt;
      p.squash += p.vel * dt;
      p.top.position.y = 0.38 + p.squash;
      p.coil.position.y = 0.26 + p.squash * 0.5;
      p.coil.scale.set(1, 1 + p.squash * 2, 1);
      for (const ll of llamas) {
        if (!ll.grounded || ll.state !== 'normal') continue;
        if (Math.hypot(ll.pos.x - p.x, ll.pos.z - p.z) > p.r || Math.abs(ll.pos.y - p.y) > 0.6) continue;
        ll.vel.y = 13.5;
        ll.vel.z = Math.max(ll.vel.z, p.minVz) + 3.5;
        ll.vel.x = -p.x * p.aim;
        ll.grounded = false;
        ll.coyote = 0; ll.jumpBuffer = 0; ll.jumpCut = true; // a jump press can't override the bounce
        ll.neckScaleVel -= 4;
        ll.squashVel += 2;
        ll.emit('onBounce');
        p.vel = -6;
      }
    }
  }

  // A central post with a low bar to jump and a high bar to duck. c.y = floor height.
  buildSweepers(c, low = 11.6, high = 11.2) {
    const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.15, 3.6, 24), std('#ffffff', { map: texCopy(barkTex(), 2, 1), roughness: 1 })));
    post.position.set(c.x, c.y + 1.8, c.z);
    post.userData.attached = true;
    this.occluders.push(post);
    this.scene.add(post);
    const cap = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.12, 24), std('#ffffff', { map: ringsTex() })));
    cap.position.set(c.x, c.y + 3.6, c.z);
    cap.userData.attached = true;
    this.scene.add(cap);
    const mk = (y, radius, len, omega, color, isLow) => {
      const g = new THREE.Group();
      g.position.set(c.x, y, c.z);
      const bar = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len * 2, 20), std('#ffffff', { map: railTex(color, 22) })));
      bar.rotation.z = Math.PI / 2;
      g.add(bar);
      for (const s of [1, -1]) {
        const end = shadowed(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.4, 16, 12), std('#6b4a2e')));
        end.position.x = s * len;
        g.add(end);
      }
      this.scene.add(g);
      this.obstacles.push({ kind: 'sweeper', id: 'sw' + c.z + ':' + y, c, y, radius, len, omega, group: g, angle: 0, low: isLow });
    };
    mk(c.y + 0.48, 0.3, low, 1.05, JUMP_RED, true);
    mk(c.y + 2.75, 0.24, high, -0.62, DUCK_BLUE, false);
  }

  // spots: [z, floorY]; `clear` is the gap between the floor and the bottom of the swing
  buildHammers(spots = [178, 185.5, 193, 200.5].map((z) => [z, 6]), clear = 0.55, headOnly = false) {
    const frameMat = std('#ffffff', { map: texCopy(barkTex(), 1, 4), roughness: 1 });
    spots.forEach(([z, floor], i) => {
      const L = 5.6, yp = floor + clear + 0.85 + L;
      for (const s of [1, -1]) {
        const postM = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, yp - LAKE_Y, 10), frameMat));
        postM.position.set(s * 6, (yp + LAKE_Y) / 2, z);
        this.scene.add(postM);
        this.occluders.push(postM);
      }
      const beam = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 12.4, 12), frameMat));
      beam.rotation.z = Math.PI / 2;
      beam.position.set(0, yp, z);
      this.scene.add(beam);
      const piv = new THREE.Group();
      piv.position.set(0, yp, z);
      const rope = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, L, 8), std('#c9a66b')));
      rope.position.y = -L / 2;
      rope.userData.attached = true; // hangs from the beam by design
      piv.add(rope);
      // a swinging hay bale with a painted warning band
      const head = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.9, 28), std('#ffffff', { map: texCopy(hayTex(), 2, 1), roughness: 1 })));
      head.rotation.x = Math.PI / 2;
      head.position.y = -L;
      piv.add(head);
      for (const s of [1, -1]) {
        const capM = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), std('#ffffff', { map: texCopy(hayTex(), 2, 1), roughness: 1 })));
        capM.scale.y = 0.35;
        capM.rotation.x = s * Math.PI / 2;
        capM.position.set(0, -L, s * 0.95);
        piv.add(capM);
      }
      this.scene.add(piv);
      this.obstacles.push({ kind: 'hammer', id: 'hm' + z, piv, yp, L, z, floor, clear, headOnly, amp: 1.05, omega: 1.25 + i * 0.1, phase: i * 1.7, center: new THREE.Vector3(), vel: new THREE.Vector3() });
    });
  }

  buildWind() {
    this.windZone = { z0: 128.5, z1: 163.5 };
    // big fans either side of the beams
    this.fans = [];
    for (const s of [1, -1]) for (const z of [137, 155]) {
      const g = new THREE.Group();
      g.position.set(s * 7.5, 6.6, z);
      g.rotation.y = -s * Math.PI / 2;
      // little wooden windmills
      const housing = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 1.2), std('#ffffff', { map: texCopy(woodTex(1)) })));
      housing.position.z = -0.8;
      g.add(housing);
      const roof = shadowed(new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.9, 4), std('#ffffff', { map: texCopy(thatchTex(), 1, 1), roughness: 1 })));
      roof.position.set(0, 1.1, -0.8); roof.rotation.y = Math.PI / 4;
      g.add(roof);
      const hub = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), std('#6b4a2e')));
      g.add(hub);
      const blades = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        // sails of woven aguayo cloth
        const b = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.0, 0.06), std('#ffffff', { map: aguayoTex(1 + (i % 3)) })));
        b.position.y = 1.0;
        const holder = new THREE.Group();
        holder.rotation.z = (i / 4) * Math.PI * 2;
        b.rotation.y = 0.5;
        holder.add(b);
        blades.add(holder);
      }
      g.add(blades);
      const standH = 6.6 - 0.7 - LAKE_Y;
      const stand = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, standH, 8), std('#ffffff', { map: texCopy(barkTex(), 1, 8) })));
      stand.position.set(0, -0.7 - standH / 2, -0.8);
      g.add(stand);
      this.scene.add(g);
      this.fans.push({ blades, side: s, spin: 0 });
    }
    // wind streaks
    this.streakMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.03, 0.03),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }), 70);
    this.streakMesh.frustumCulled = false;
    this.scene.add(this.streakMesh);
    this.streaks = [];
    for (let i = 0; i < 70; i++) {
      this.streaks.push(new THREE.Vector3((this.rand() - 0.5) * 14, 6.2 + this.rand() * 3.5, 129 + this.rand() * 34));
    }
    this._sm = new THREE.Matrix4();
  }

  buildDecor() {
    const S = this.scene;
    // gateways: Inca-style fitted-stone pillars, a eucalyptus lintel, a woven banner and bunting
    const arch = (z, y, text, c1) => {
      const g = new THREE.Group();
      g.position.set(0, y, z);
      const bark = std('#ffffff', { map: texCopy(barkTex(), 1, 3), roughness: 1 });
      const masonry = std('#ffffff', { map: texCopy(ashlarTex(), 1, 3), roughness: 1 });
      for (const s of [1, -1]) {
        // slightly battered (narrower at the top), the way Inca walls lean in
        const p = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.8, 8, 4, 1), masonry));
        p.rotation.y = Math.PI / 4;
        p.position.set(s * 6.2, 4, 0);
        g.add(p);
        this.occluders.push(p);
        const cap = shadowed(new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.45, 1.1, 2, 0.08), std('#ffffff', { map: texCopy(stoneTex()) })));
        cap.position.set(s * 6.2, 8.2, 0);
        g.add(cap);
        // a pompom tassel hanging off each pillar top
        for (const k of [-1, 1]) {
          const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), pomMat(k > 0 ? '#d81b60' : '#ffc928'));
          pom.scale.setScalar(0.17);
          pom.position.set(s * 6.2 + k * 0.4, 7.7, 0.62);
          g.add(pom);
        }
      }
      const beam = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 13.6, 10), bark));
      beam.rotation.z = Math.PI / 2; beam.position.y = 7.9;
      g.add(beam);
      const sign = textTex(text, c1, '#fff6e0');
      const banner = shadowed(new THREE.Mesh(new RoundedBoxGeometry(11, 1.5, 0.25, 2, 0.08), [
        std('#6b4a2e'), std('#6b4a2e'), std('#6b4a2e'), std('#6b4a2e'), std('#ffffff', { map: sign }), std('#ffffff', { map: sign }),
      ]));
      banner.position.y = 6.85;
      banner.rotation.y = Math.PI; // readable when approaching from -z
      g.add(banner);
      for (const s of [1, -1]) {
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), std('#c9a66b'));
        rope.position.set(s * 4.5, 7.6, 0);
        g.add(rope);
      }
      bunting(g, new THREE.Vector3(-6.2, 7.7, 0.45), new THREE.Vector3(6.2, 7.7, 0.45), 0.9, 16);
      S.add(g);
      return g;
    };
    arch(-1.5, 0, 'LURCHING LLAMA', '#7a3b2e');
    arch(this.finishZ, this.finishY, 'FINISH!', '#2f5d8a');
    // finish line
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(15.6, 1.4), decal('#ffffff', { map: checkerTex('#2b2b2b', '#f6efdf', 12) }, 2));
    fl.material.map.repeat.set(5, 0.45);
    fl.rotation.x = -Math.PI / 2;
    fl.position.set(0, this.finishY + CAP_Y + 0.015, this.finishZ);
    fl.receiveShadow = true;
    S.add(fl);
    // bunting strung around the finish meadow
    for (const s of [1, -1]) {
      // keep the poles on the finish meadow (it ends ~10m past the line)
      const posts = [2.5, 6, 9.5].map((dz) => new THREE.Vector3(s * 7.3, this.finishY, this.finishZ + dz));
      posts.forEach((p) => {
        const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3, 8), std('#6b4a2e')));
        pole.position.set(p.x, p.y + 1.5, p.z); S.add(pole);
      });
      for (let i = 0; i < posts.length - 1; i++) {
        bunting(S, posts[i].clone().setY(this.finishY + 2.9), posts[i + 1].clone().setY(this.finishY + 2.9), 0.5, 9);
      }
    }

    // ichu tussocks and flowers along the edges of the turf
    ichuTussocks(S, this.tufts, 0.85);

    // the wider world: lake, stone forest, puna, villages, mountains, condors...
    const avoid = [{ x: 0, z: this.finishZ / 2, r: 0 }];
    for (const p of this.platforms) {
      if (p.type === 'cyl') { avoid.push({ x: p.pos.x, z: p.pos.z, r: p.r + 3 }); continue; }
      const cx = p.type === 'ramp' ? p.cx : p.pos.x, hx = p.type === 'ramp' ? p.w / 2 : p.hx;
      const z0 = p.type === 'ramp' ? p.z0 : p.pos.z - p.hz, z1 = p.type === 'ramp' ? p.z1 : p.pos.z + p.hz;
      const step = Math.max(2, hx * 1.5);
      for (let z = z0; z <= z1 + 0.01; z += step) avoid.push({ x: cx, z, r: hx + 4 });
    }
    for (let z = -12; z < this.finishZ + 14; z += 4) avoid.push({ x: 0, z, r: 10 }); // keep the racing line clear
    this.land = new Altiplano(S, { lakeY: LAKE_Y, finishZ: this.finishZ, rand: this.rand, avoid });
    this.sea = this.land.sea;
  }

  // -------------------------------------------------------------------------

  // Rough track surface height along the course (for cameras).
  heightAt(z) {
    return this.heightFn(z);
  }

  windAt(pos) {
    const z = this.windZone;
    if (!z) return 0;
    return pos.z > z.z0 && pos.z < z.z1 && pos.y > 4 ? this.wind : 0;
  }

  // Where a moving platform will be `ahead` seconds from now (for bot planning).
  futureX(plat, ahead) {
    return this.futurePos(plat, ahead).x;
  }

  futurePos(plat, ahead) {
    if (!plat.motion) return plat.pos;
    const tmp = { pos: plat.pos.clone(), yaw: plat.yaw };
    plat.motion(this.time + ahead, tmp);
    return tmp.pos;
  }

  update(t, dt, llamas) {
    this.time = t;
    this.land.update(t, dt, llamas.find((l) => l.isPlayer));
    for (const sw of this.seesaws) sw.applyLoads(llamas, dt);
    for (const td of this.tilts) td.applyLoads(llamas, dt);
    for (const sk of this.sinkers) {
      const loaded = llamas.some((l) => l.support === sk && l.grounded);
      sk.sink = clamp(sk.sink + (loaded ? 0.34 : -0.6) * dt, 0, 1);
      if (sk.sink >= 1) sk.sink = 0; // fully under: it bobs back up empty
    }
    // tipped boards are slippery: llamas slide downhill
    for (const ll of llamas) {
      const sp = ll.support;
      if (!ll.grounded || !sp) continue;
      if (sp.type === 'seesaw') ll.vel.z += Math.sin(sp.theta) * 7 * dt;
      if (sp.type === 'tilt') { ll.vel.z += Math.sin(sp.tx) * 7 * dt; ll.vel.x -= Math.sin(sp.tz) * 7 * dt; }
      // off the crown of a log you roll down its side
      if (sp.type === 'spinlog') ll.vel.x += clamp((ll.pos.x - sp.pos.x) / sp.r, -1, 1) * 9 * dt;
    }
    for (const p of this.platforms) p.update(t, dt);

    // wind gusts alternate direction
    const w = Math.sin(t * 0.75) + 0.35 * Math.sin(t * 2.3);
    this.wind = Math.sign(w) * Math.pow(Math.min(1, Math.abs(w)), 0.6) * 1.8;
    for (const f of this.fans) {
      const on = Math.sign(this.wind) === f.side ? Math.abs(this.wind) : 0.15;
      f.spin += dt * (2 + on * 7);
      f.blades.rotation.z = f.spin * -f.side;
    }
    this.streaks.forEach((p, i) => {
      p.x -= this.wind * dt * 9;
      if (p.x > 8) p.x = -8;
      if (p.x < -8) p.x = 8;
      this.streakMesh.setMatrixAt(i, this._sm.makeTranslation(p.x, p.y, p.z));
    });
    if (this.streakMesh) this.streakMesh.instanceMatrix.needsUpdate = true;
    if (this.streakMesh) this.streakMesh.material.opacity = Math.min(0.55, Math.abs(this.wind) * 0.22);

    for (const ll of llamas) {
      const wv = this.windAt(ll.pos);
      if (wv) {
        // wind blows from the active fan toward -side; positive wind pushes -x
        ll.ext.x -= wv * 1.0;
        ll.vel.x -= wv * 0.35 * dt;
      }
    }

    for (const o of this.obstacles) {
      if (o.kind === 'sweeper') this.updateSweeper(o, t, llamas);
      else if (o.kind === 'hammer') this.updateHammer(o, t, llamas);
      else if (o.kind === 'bar') this.updateBar(o, llamas);
    }
    if (this.hayBales) this.updateBales(dt, llamas);
    this.updatePads(dt, llamas);
  }

  updateSweeper(o, t, llamas) {
    o.angle = t * o.omega;
    o.group.rotation.y = o.angle;
    const ax = Math.cos(o.angle), az = -Math.sin(o.angle);
    _a.set(o.c.x - ax * o.len, o.y, o.c.z - az * o.len);
    _b.set(o.c.x + ax * o.len, o.y, o.c.z + az * o.len);
    for (const ll of llamas) {
      if ((ll.hitCD[o.id] || 0) > 0) continue;
      // body
      if (ll.pos.y < o.y + o.radius && ll.pos.y + 1.6 > o.y - o.radius) {
        _p.set(ll.pos.x, o.y, ll.pos.z);
        closestOnSegment(_p, _a, _b, _c);
        const dx = _p.x - _c.x, dz = _p.z - _c.z, d = Math.hypot(dx, dz);
        if (d < o.radius + 0.45) {
          const rx = _c.x - o.c.x, rz = _c.z - o.c.z;
          const vx = o.omega * rz, vz = -o.omega * rx;
          if (dx * vx + dz * vz > 0) {
            const nx = dx / (d || 1), nz = dz / (d || 1);
            ll.pos.x = _c.x + nx * (o.radius + 0.46); ll.pos.z = _c.z + nz * (o.radius + 0.46);
            _n.set(vx * 1.1 + nx * 3, 4.2, vz * 1.1 + nz * 3);
            ll.hit(_n, 1);
            ll.hitCD[o.id] = 0.6;
            continue;
          }
        }
      }
      // head, and the upper neck (a bar can catch you mid-neck too)
      for (const [pt, rad, k] of [[ll.headPos, 0.22, 1.1], [ll.neckPts[1], 0.17, 0.8], [ll.neckPts[0], 0.19, 0.6]]) {
        closestOnSegment(pt, _a, _b, _c);
        if (_c.distanceTo(pt) >= o.radius + rad) continue;
        const rx = _c.x - o.c.x, rz = _c.z - o.c.z;
        _n.set(o.omega * rz * k, 0, -o.omega * rx * k);
        ll.headHit(_n);
        ll.hitCD[o.id] = 0.6;
        break;
      }
    }
  }

  updateHammer(o, t, llamas) {
    const th = o.amp * Math.sin(t * o.omega + o.phase);
    const thd = o.amp * o.omega * Math.cos(t * o.omega + o.phase);
    o.piv.rotation.z = th;
    o.center.set(Math.sin(th) * o.L, o.yp - Math.cos(th) * o.L, o.z);
    o.vel.set(Math.cos(th) * thd * o.L, Math.sin(th) * thd * o.L, 0);
    const R = 0.85;
    for (const ll of llamas) {
      if ((ll.hitCD[o.id] || 0) > 0) continue;
      const cy = clamp(o.center.y, ll.pos.y + 0.35, ll.pos.y + 1.45);
      const cz = clamp(ll.pos.z, o.z - 0.95, o.z + 0.95);
      const dx = ll.pos.x - o.center.x, dy = cy - o.center.y, dz = ll.pos.z - cz;
      const d = Math.hypot(dx, dy, dz);
      let hit = !o.headOnly && d < R + 0.45;
      if (!hit) {
        const struck = [ll.headPos, ...ll.neckPts].find((pt) =>
          Math.hypot(pt.x - o.center.x, pt.y - o.center.y, pt.z - clamp(pt.z, o.z - 0.95, o.z + 0.95)) < R + 0.2);
        if (struck) {
          _n.copy(o.vel).multiplyScalar(struck === ll.headPos ? 0.9 : 0.7);
          ll.headHit(_n);
          ll.hitCD[o.id] = 0.6;
          continue;
        }
      }
      if (hit) {
        const hx = Math.hypot(dx, dz) || 1;
        _n.set(o.vel.x * 1.25 + (dx / hx) * 3, 4, (dz / hx) * 3);
        ll.hit(_n, 1);
        ll.hitCD[o.id] = 0.7;
      }
    }
  }

  updateBales(dt, llamas) {
    this.baleTimer -= dt;
    if (this.baleTimer <= 0) {
      this.baleTimer = 1.7 + this.rand() * 1.0;
      if (!this.baleGeo) {
        this.baleGeo = new THREE.CylinderGeometry(0.75, 0.75, 2.4, 24);
        this.baleGeo.rotateZ(Math.PI / 2);
        this.baleMat = std('#ffffff', { map: texCopy(hayTex(), 2, 1), roughness: 1 });
        this.bandGeo = new THREE.TorusGeometry(0.77, 0.05, 6, 24).rotateY(Math.PI / 2);
        this.bandMat = std('#7a5536');
      }
      const g = new THREE.Group();
      const m = shadowed(new THREE.Mesh(this.baleGeo, this.baleMat));
      g.add(m);
      for (const x of [-0.6, 0.6]) { const b = new THREE.Mesh(this.bandGeo, this.bandMat); b.position.x = x; g.add(b); }
      const x = (this.rand() - 0.5) * 6;
      this.scene.add(g);
      this.bales.push({ g, x, z: this.ramp.z1 + 0.5, vz: -2.5, r: 0.75, life: 1, spin: 0 });
    }
    for (let i = this.bales.length - 1; i >= 0; i--) {
      const b = this.bales[i];
      b.vz = Math.max(b.vz - 6 * dt, -8.5);
      b.z += b.vz * dt;
      b.spin += (b.vz / b.r) * dt;
      const yTop = this.ramp.topAt(b.x, clamp(b.z, this.ramp.z0, this.ramp.z1), 0) ?? 0;
      if (b.z < this.ramp.z0 + 1.5) b.life -= dt * 3;
      const s = Math.max(0.001, Math.min(1, b.life));
      b.g.position.set(b.x, yTop + b.r * s, b.z);
      b.g.rotation.x = b.spin;
      b.g.scale.setScalar(s);
      if (b.life <= 0) { this.scene.remove(b.g); this.bales.splice(i, 1); continue; }
      _a.set(b.x - 1.2, b.g.position.y, b.z); _b.set(b.x + 1.2, b.g.position.y, b.z);
      for (const ll of llamas) {
        if ((ll.hitCD.bale || 0) > 0) continue;
        _p.set(ll.pos.x, ll.pos.y + 0.7, ll.pos.z);
        closestOnSegment(_p, _a, _b, _c);
        const d = _p.distanceTo(_c);
        if (d < b.r * s + 0.5) {
          _n.set((_p.x - _c.x) * 2, 4.5, b.vz * 0.9);
          ll.hit(_n, 1);
          ll.hitCD.bale = 0.8;
        }
      }
    }
  }
}

