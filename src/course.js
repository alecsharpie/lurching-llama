import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, wrapAngle, canvasTexture, woolGeometry, rng, closestOnSegment } from './util.js';

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

function wedgeTex(c1, c2, n = 12) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = c2; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? c1 : c2;
      ctx.beginPath(); ctx.moveTo(w / 2, h / 2);
      ctx.arc(w / 2, h / 2, w / 2, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.08, 0, Math.PI * 2); ctx.fill();
  });
}

// Tileable rippling normal map for the goo sea (sum of periodic sines).
function gooNormalMap() {
  const N = 128;
  const h = (x, y) => {
    const u = (x / N) * Math.PI * 2, v = (y / N) * Math.PI * 2;
    return Math.sin(u * 2 + Math.sin(v * 3) * 0.8) + Math.sin(v * 3 + Math.sin(u * 2) * 1.1) * 0.8 + Math.sin((u + v) * 5) * 0.25;
  };
  const t = canvasTexture(N, N, (ctx) => {
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
      const nx = -dx * 2, ny = -dy * 2, nz = 1, l = Math.hypot(nx, ny, nz);
      const i = (y * N + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function stripeTex(c1, c2, n = 6) {
  const t = canvasTexture(64, 256, (ctx, w, h) => {
    for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? c1 : c2; ctx.fillRect(0, (i / n) * h, w, h / n); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function textTex(text, bg, fg, w = 1024, h = 192) {
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = `${Math.floor(h * 0.62)}px "Lilita One", "Arial Black", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  });
}

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

function shadowed(m) { m.castShadow = true; m.receiveShadow = true; return m; }

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
class Log {
  constructor(o) {
    Object.assign(this, o);
    this.pos = new THREE.Vector3(...o.pos);
    this.dynamic = true;
    this.dYaw = 0;
    this.vel = new THREE.Vector3(0, 0, -o.speed);
    this.type = 'log';
    this.dt = 0;
  }

  update(t, dt) {
    this.dt = dt;
    this.mesh.rotation.x -= (this.speed / this.r) * dt;
  }

  topAt(x, z, m) {
    const dz = Math.abs(z - this.pos.z);
    if (Math.abs(x - this.pos.x) > this.hw + m || dz > this.r + m) return null;
    const d = Math.min(dz, this.r);
    return this.pos.y + Math.sqrt(this.r * this.r - d * d);
  }

  carry(v) { v.z -= this.speed * this.dt; }
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
    const step = (a, w, m) => {
      w += (m * 0.16 - 1.6 * w - 1.8 * a) * dt;
      const na = clamp(a + w * dt, -this.maxTilt, this.maxTilt);
      if (na !== a + w * dt) w *= 0.3;
      return [na, w];
    };
    const ptx = this.tx, ptz = this.tz;
    [this.tx, this.wx] = step(this.tx, this.wx, mx);
    [this.tz, this.wz] = step(this.tz, this.wz, mz);
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
  { id: 'rumble', name: 'Log Roll Rumble', sub: 'Conveyor Pushers · Rolling Logs · Tilting Disc · Elevators · Bounce Up · Sweepers' },
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
    this.hints = [];
    this.occluders = []; // static props the chase camera shouldn't clip through
    this.time = 0;
    this.sinkers = [];
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
        m.map?.dispose();
        m.normalMap?.dispose();
        m.dispose();
      }
    });
  }

  addPlatform(o) {
    const p = new Platform(o);
    const top = o.topTex || checkerTex(o.color2 || '#ffffff', o.color, 8);
    let mesh;
    if (o.type === 'cyl') {
      mesh = new THREE.Group();
      const side = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 0.92, o.hy * 2, 64), std(o.side || o.color)));
      mesh.add(side);
      const cap = shadowed(new THREE.Mesh(new THREE.CircleGeometry(o.r - 0.02, 64), std('#ffffff', { map: top, roughness: 0.6 })));
      cap.rotation.x = -Math.PI / 2; cap.position.y = o.hy + 0.005;
      mesh.add(cap);
      const rim = shadowed(new THREE.Mesh(new THREE.TorusGeometry(o.r, 0.12, 10, 64), std(o.rim || '#ffffff')));
      rim.rotation.x = Math.PI / 2; rim.position.y = o.hy - 0.06;
      mesh.add(rim);
    } else if (o.type === 'ramp') {
      const len = Math.hypot(o.z1 - o.z0, o.y1 - o.y0), th = 1.0;
      const ang = Math.atan2(o.y1 - o.y0, o.z1 - o.z0);
      mesh = new THREE.Group();
      const box = shadowed(new THREE.Mesh(new RoundedBoxGeometry(o.w, th, len, 3, 0.18), std(o.side || o.color)));
      box.position.y = -th / 2;
      mesh.add(box);
      top.repeat.set(o.w / 2, len / 2);
      const cap = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(o.w - 0.3, len - 0.3), std('#ffffff', { map: top })));
      cap.rotation.x = -Math.PI / 2; cap.position.y = 0.005;
      mesh.add(cap);
      mesh.position.set(o.cx, (o.y0 + o.y1) / 2, (o.z0 + o.z1) / 2);
      mesh.rotation.x = -ang;
      p.pos.set(o.cx, (o.y0 + o.y1) / 2, (o.z0 + o.z1) / 2);
    } else {
      mesh = new THREE.Group();
      const box = shadowed(new THREE.Mesh(new RoundedBoxGeometry(o.hx * 2, o.hy * 2, o.hz * 2, 3, Math.min(0.2, o.hy * 0.9)), std(o.side || o.color)));
      mesh.add(box);
      top.repeat.set(o.hx / 1.5, o.hz / 1.5);
      if (o.belt) p.beltTex = top;
      const cap = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(o.hx * 2 - 0.3, o.hz * 2 - 0.3), std('#ffffff', { map: top })));
      cap.rotation.x = -Math.PI / 2; cap.position.y = o.hy + 0.005;
      mesh.add(cap);
    }
    if (o.type !== 'ramp') { mesh.position.copy(p.pos); mesh.rotation.y = p.yaw; }
    this.scene.add(mesh);
    p.mesh = mesh;
    this.platforms.push(p);
    return p;
  }

  addSeesaw(z) {
    const sw = new Seesaw({ pos: [0, 5.6, z], hx: 1.5, hy: 0.4, hz: 5, maxTilt: 0.25 });
    const g = new THREE.Group();
    g.position.copy(sw.pos);
    const board = shadowed(new THREE.Mesh(new RoundedBoxGeometry(3, 0.8, 10, 3, 0.18), std('#ff9f43')));
    g.add(board);
    const top = checkerTex('#ffffff', '#ffc27a', 8);
    top.repeat.set(1, 3.3);
    const cap = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(2.7, 9.7), std('#ffffff', { map: top })));
    cap.rotation.x = -Math.PI / 2; cap.position.y = 0.405;
    g.add(cap);
    this.scene.add(g);
    // fulcrum and a pillar down into the clouds
    const fulcrum = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.2, 3), std('#5b3cc4')));
    fulcrum.rotation.z = Math.PI / 2;
    fulcrum.rotation.x = Math.PI / 2;
    fulcrum.position.set(0, 4.7, z);
    this.scene.add(fulcrum);
    const pillar = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 14, 16), std('#ffffff', { map: stripeTex('#5b3cc4', '#ffffff', 12) })));
    pillar.position.set(0, -2.6, z);
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
    const PINK = '#ff7eb6', PURPLE = '#9b7bff', TEAL = '#3fd6c6', YELLOW = '#ffd23f', ORANGE = '#ff9f43', BLUE = '#4fa8ff';

    // A: start
    this.addPlatform({ type: 'box', pos: [0, -0.6, 0], hx: 12, hy: 0.6, hz: 9, color: PURPLE, color2: '#b9a6ff' });
    this.addPlatform({ type: 'box', pos: [0, -0.6, 13], hx: 3.5, hy: 0.6, hz: 4.6, color: PINK, color2: '#ffb3d4' });
    // B: sweeper disk
    this.addPlatform({ type: 'cyl', pos: [0, -0.6, 29], r: 12, hy: 0.6, color: TEAL, side: '#2bb3a5', topTex: wedgeTex('#3fd6c6', '#a6f0e8', 16) });
    this.addPlatform({ type: 'box', pos: [0, -0.6, 45], hx: 3.5, hy: 0.6, hz: 4.6, color: PINK, color2: '#ffb3d4' });
    // D: sliding platforms over the void
    this.slider = [];
    [52.5, 59.5, 66.5, 73.5].forEach((z, i) => {
      const ph = i * 1.9;
      this.slider.push(this.addPlatform({
        type: 'box', pos: [0, -0.4, z], hx: 2.4, hy: 0.4, hz: 2.4, color: YELLOW, color2: '#fff1a8',
        motion: (t, p) => { p.pos.x = Math.sin(t * 0.8 + ph) * 4.5; },
      }));
    });
    // E: landing
    this.addPlatform({ type: 'box', pos: [0, -0.6, 83], hx: 5, hy: 0.6, hz: 5.5, color: BLUE, color2: '#a9d4ff' });
    // F: hay-bale hill
    this.ramp = this.addPlatform({ type: 'ramp', cx: 0, w: 9, z0: 88.5, z1: 118, y0: 0, y1: 6, color: ORANGE, color2: '#ffd1a3' });
    // G
    this.addPlatform({ type: 'box', pos: [0, 5.4, 123], hx: 5, hy: 0.6, hz: 5, color: PURPLE, color2: '#b9a6ff' });
    // H: windy balance beams
    this.addPlatform({ type: 'box', pos: [0, 5.6, 136], hx: 1.0, hy: 0.4, hz: 8, color: PINK, color2: '#ffb3d4' });
    this.addPlatform({ type: 'cyl', pos: [0, 5.6, 146], r: 2.3, hy: 0.4, color: YELLOW, topTex: wedgeTex('#ffd23f', '#fff1a8', 10) });
    this.addPlatform({ type: 'box', pos: [0, 5.6, 156], hx: 1.0, hy: 0.4, hz: 8, color: PINK, color2: '#ffb3d4' });
    // I
    this.addPlatform({ type: 'box', pos: [0, 5.4, 169], hx: 5, hy: 0.6, hz: 5, color: TEAL, color2: '#a6f0e8' });
    // J: hammer walk
    this.addPlatform({ type: 'box', pos: [0, 5.6, 189], hx: 2.5, hy: 0.4, hz: 15, color: BLUE, color2: '#a9d4ff' });
    // K: spinning disks
    [[209.5, 0.6], [219, -0.8], [228.5, 1.0]].forEach(([z, w], i) => {
      this.addPlatform({
        type: 'cyl', pos: [0, 5.4, z], r: 5, hy: 0.6, color: i % 2 ? ORANGE : PINK,
        topTex: wedgeTex(i % 2 ? '#ff9f43' : '#ff7eb6', '#ffffff', 12),
        motion: (t, p) => { p.yaw = t * w; },
      });
    });
    // L: teeter-totters
    this.addPlatform({ type: 'box', pos: [0, 5.4, 236], hx: 4, hy: 0.6, hz: 2.5, color: PURPLE, color2: '#b9a6ff' });
    this.seesaws = [244, 259].map((z) => this.addSeesaw(z));
    this.addPlatform({ type: 'cyl', pos: [0, 5.4, 251.5], r: 2.2, hy: 0.6, color: TEAL, topTex: wedgeTex('#3fd6c6', '#a6f0e8', 10) });
    // M: finish
    this.addPlatform({ type: 'box', pos: [0, 5.4, 275], hx: 8, hy: 0.6, hz: 10.5, color: YELLOW, color2: '#fff1a8' });
    this.finishZ = 274;
    this.finishY = 6;

    this.hayBales = true;
    this.buildBouncePads([[-2.3, 6, 125.2], [2.3, 6, 125.2]]);
    this.buildSweepers(new THREE.Vector3(0, 0, 29));
    this.buildHammers();
    this.buildWind();
    this.heightFn = (z) => (z < this.ramp.z0 ? 0 : z > this.ramp.z1 ? 6 : this.ramp.topAt(0, z, 0));
    this.hints = [
      { z: 10, text: 'Pink bar: <b>JUMP</b> it (Space) · Purple bar: <b>DUCK</b> (hold C)' },
      { z: 46, text: 'Ride the sliders, jump the gaps. Momentum carries over!' },
      { z: 86, text: 'Hay bales incoming! Weave up the hill' },
      { z: 121, text: 'Bounce pads launch you onto the beam. Risky shortcut!' },
      { z: 130, text: 'Gusty! Wind shoves your head. Step <b>toward</b> the lean to recover' },
      { z: 171, text: 'Wait for a gap between the hammers, then go!' },
      { z: 204, text: 'Spinning disks: don\'t fight the spin too hard' },
      { z: 234, text: 'Teeter-totters! Your heavy head tips them. Keep moving!' },
    ];

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
    const PINK = '#ff7eb6', PURPLE = '#9b7bff', TEAL = '#3fd6c6', YELLOW = '#ffd23f', ORANGE = '#ff9f43', BLUE = '#4fa8ff';
    // start
    this.addPlatform({ type: 'box', pos: [0, -0.6, 0], hx: 12, hy: 0.6, hz: 9, color: TEAL, color2: '#a6f0e8' });
    // conveyor belt running backwards, with sliding pushers
    this.addPlatform({ type: 'box', pos: [0, -0.6, 21], hx: 3.5, hy: 0.6, hz: 12, color: PINK, color2: '#ffb3d4', belt: -2.2,
      topTex: stripeTex('#ff7eb6', '#ffd6e8', 2) });
    [[15, 0], [22, 2.1], [29, 4.2]].forEach(([z, ph]) => this.addPlatform({
      type: 'box', pos: [0, 0.9, z], hx: 1.1, hy: 0.9, hz: 0.7, color: PURPLE, color2: '#b9a6ff',
      motion: (t, p) => { p.pos.x = Math.sin(t * 1.25 + ph) * 2.6; },
    }));
    this.addPlatform({ type: 'box', pos: [0, -0.6, 36], hx: 3.5, hy: 0.6, hz: 3, color: BLUE, color2: '#a9d4ff' });
    // rolling logs: a treadmill of big candy-striped rollers
    for (let i = 0; i < 6; i++) this.addLog(40.2 + i * 3.2, i);
    this.addPlatform({ type: 'box', pos: [0, -0.6, 62.5], hx: 4, hy: 0.6, hz: 5, color: YELLOW, color2: '#fff1a8' });
    // narrow bridge, tilting disc, narrow bridge
    this.addPlatform({ type: 'box', pos: [0, -0.4, 69.5], hx: 1.2, hy: 0.4, hz: 2, color: PINK, color2: '#ffb3d4' });
    this.addTilt(78);
    this.addPlatform({ type: 'box', pos: [0, -0.4, 86.5], hx: 1.2, hy: 0.4, hz: 2, color: PINK, color2: '#ffb3d4' });
    // elevators bobbing up toward the plateau
    this.elevators = [0.6, 1.9, 3.2, 4.5].map((top, i) => this.addPlatform({
      type: 'box', pos: [0, top - 0.4, 90.9 + i * 5.2], hx: 2.2, hy: 0.4, hz: 2.2, color: ORANGE, color2: '#ffd1a3',
      motion: (t, p) => { p.pos.y = top - 0.4 + Math.sin(t * 1.0 + i * 1.6) * 1.0; },
    }));
    this.addPlatform({ type: 'box', pos: [0, 5.4, 114.5], hx: 5, hy: 0.6, hz: 5, color: PURPLE, color2: '#b9a6ff' });
    // bounce pads up to the top deck
    this.buildBouncePads([[-2.6, 6, 117.5], [0, 6, 117.5], [2.6, 6, 117.5]], { aim: 0.15, minVz: 4 });
    this.addPlatform({ type: 'box', pos: [0, 8.4, 130], hx: 5, hy: 0.6, hz: 7.5, color: BLUE, color2: '#a9d4ff' });
    // sweeper finale
    this.addPlatform({ type: 'cyl', pos: [0, 8.4, 148.5], r: 11, hy: 0.6, color: TEAL, side: '#2bb3a5', topTex: wedgeTex('#3fd6c6', '#a6f0e8', 16) });
    this.buildSweepers(new THREE.Vector3(0, 9, 148.5), 10.6, 10.2);
    this.addPlatform({ type: 'box', pos: [0, 8.4, 170], hx: 8, hy: 0.6, hz: 10.5, color: YELLOW, color2: '#fff1a8' });
    this.finishZ = 169.5;
    this.finishY = 9;

    this.heightFn = (z) => (z < 88.5 ? 0 : z < 109.5 ? (6 * (z - 88.5)) / 21 : z < 122 ? 6 : 9);
    this.checkpoints = [
      { z: -1e9, spawn: new THREE.Vector3(0, 0.5, -5) },
      { z: 57.5, spawn: new THREE.Vector3(0, 0.5, 62) },
      { z: 110, spawn: new THREE.Vector3(0, 6.5, 112.5) },
      { z: 124, spawn: new THREE.Vector3(0, 9.5, 127.5) },
    ];
    const P = (x, z, w = 2) => ({ x, z, w });
    this.path = [
      P(0, 8, 2), P(0, 33.5, 1.2), P(0, 38.5, 1), P(0, 57.8, 0.6), P(0, 66, 1), P(0, 71, 0.2), P(0, 78, 0.6),
      P(0, 84.8, 0.2), P(0, 88.2, 0.4), ...this.elevators.map((plat) => ({ plat })),
      P(0, 111, 1.5), P(0, 117.5, 5.2), P(0, 127, 2), P(0, 148.5, 3), P(0, 162, 2), P(0, 177, 4),
    ];
    this.hints = [
      { z: 8, text: 'Conveyor! Keep walking and dodge the <b>pushers</b>' },
      { z: 35, text: 'Rolling logs push you back. Keep going and stay centred!' },
      { z: 66, text: 'The disc tilts toward weight, and your heavy head counts!' },
      { z: 86, text: 'Ride the elevators up. Jump when the next one is level' },
      { z: 111, text: 'Hit a bounce pad with some speed to reach the top deck' },
      { z: 136, text: 'Jump the pink bar, duck the purple one!' },
    ];
  }

  // A course about the neck: bars at head height you must duck, low hurdles you must
  // jump, stepping stones that sink under you, and pendulums that swing at head height.
  buildDuck() {
    const PINK = '#ff7eb6', PURPLE = '#9b7bff', TEAL = '#3fd6c6', YELLOW = '#ffd23f', ORANGE = '#ff9f43', BLUE = '#4fa8ff';
    this.addPlatform({ type: 'box', pos: [0, -0.6, 0], hx: 12, hy: 0.6, hz: 9, color: YELLOW, color2: '#fff1a8' });
    // the duck-and-jump corridor
    this.addPlatform({ type: 'box', pos: [0, -0.6, 25.6], hx: 3, hy: 0.6, hz: 16.6, color: PURPLE, color2: '#b9a6ff' });
    [[15, 'duck'], [21, 'hurdle'], [27, 'duck'], [31, 'hurdle'], [36, 'duck']].forEach(([z, kind]) => this.addBar(z, 0, kind, 3));
    // sinking stepping stones, three lanes wide so the pack spreads out
    const rows = Array.from({ length: 9 }, (_, i) => 44.5 + i * 4.3);
    rows.forEach((z, row) => [-2.8, 0, 2.8].forEach((x, lane) => {
      const ph = row * 1.3 + lane * 2.1;
      const p = this.addPlatform({
        type: 'cyl', pos: [x, -0.6, z], r: 1.45, hy: 0.6, color: lane === 1 ? TEAL : BLUE,
        topTex: wedgeTex(lane === 1 ? '#3fd6c6' : '#4fa8ff', '#e6fbff', 8),
        // slow settle at first, then it plunges into the goo
        motion: (t, pl) => { const k = pl.sink || 0; pl.pos.y = -0.6 - (0.35 * k + 22 * k ** 4) + Math.sin(t * 2 + ph) * 0.04; },
      });
      p.sink = 0;
      this.sinkers.push(p);
    }));
    this.addPlatform({ type: 'box', pos: [0, -0.6, 85.5], hx: 5, hy: 0.6, hz: 5, color: BLUE, color2: '#a9d4ff' });
    // ramp up with head-height pendulums
    this.ramp = this.addPlatform({ type: 'ramp', cx: 0, w: 7, z0: 90.5, z1: 114, y0: 0, y1: 5, color: PINK, color2: '#ffb3d4' });
    const rampY = (z) => (5 * (z - 90.5)) / 23.5;
    this.buildHammers([96, 103, 110].map((z) => [z, rampY(z)]), 2.25, true);
    this.addPlatform({ type: 'box', pos: [0, 4.4, 118], hx: 5, hy: 0.6, hz: 4, color: ORANGE, color2: '#ffd1a3' });
    // last gauntlet: narrow catwalk with alternating bars, then the finish
    this.addPlatform({ type: 'box', pos: [0, 4.6, 131], hx: 1.6, hy: 0.4, hz: 9, color: PURPLE, color2: '#b9a6ff' });
    [[125, 'duck'], [129, 'hurdle'], [133, 'duck'], [137, 'duck']].forEach(([z, kind]) => this.addBar(z, 5, kind, 1.6));
    this.addPlatform({ type: 'box', pos: [0, 4.4, 150.5], hx: 8, hy: 0.6, hz: 10.5, color: YELLOW, color2: '#fff1a8' });
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
    this.hints = [
      { z: 8, text: 'Purple bars: <b>DUCK</b> (hold C) · Low pink bars: <b>JUMP</b>' },
      { z: 41, text: 'Stepping stones sink while you stand on them. Keep hopping!' },
      { z: 88, text: 'The pendulums swing at head height. <b>Duck</b> and they pass over you' },
      { z: 120, text: 'Last stretch! Duck, jump, duck… and wobble home' },
    ];
  }

  // A static bar across the path: 'duck' sits at head height, 'hurdle' at shin height.
  addBar(z, floor, kind, halfW) {
    const y = floor + (kind === 'duck' ? 2.1 : 0.35);
    const r = kind === 'duck' ? 0.2 : 0.18;
    const g = new THREE.Group();
    const bar = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r, r, halfW * 2 + 0.6, 16),
      std('#ffffff', { map: stripeTex(kind === 'duck' ? '#5b3cc4' : '#ff4f8b', '#ffffff', 12) })));
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, y, z);
    g.add(bar);
    for (const s of [1, -1]) {
      const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, y - floor + 0.2, 10), std('#ffffff')));
      post.position.set(s * (halfW + 0.3), (y + floor) / 2, z);
      g.add(post);
      const knob = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), std('#ffd23f')));
      knob.position.set(s * (halfW + 0.3), y, z);
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

  addLog(z, i) {
    const log = new Log({ pos: [0, -2.2, z], r: 2.2, hw: 3.5, speed: 2.2 });
    const tex = canvasTexture(256, 64, (ctx, w, h) => {
      const n = 8;
      for (let k = 0; k < n; k++) { ctx.fillStyle = k % 2 ? '#ffffff' : (i % 2 ? '#ff9f43' : '#ff7eb6'); ctx.fillRect((k / n) * w, 0, w / n, h); }
    });
    const g = new THREE.Group();
    g.position.copy(log.pos);
    const m = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 7, 40), std('#ffffff', { map: tex })));
    m.rotation.z = Math.PI / 2;
    g.add(m);
    for (const sx of [-1, 1]) {
      const capM = shadowed(new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.18, 10, 40), std('#ffd23f')));
      capM.rotation.y = Math.PI / 2;
      capM.position.x = sx * 3.5;
      g.add(capM);
    }
    this.scene.add(g);
    log.mesh = g;
    this.platforms.push(log);
    return log;
  }

  addTilt(z) {
    const td = new TiltDisc({ pos: [0, -0.4, z], r: 6.5, hy: 0.4, maxTilt: 0.14 });
    const g = new THREE.Group();
    g.position.copy(td.pos);
    const side = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.3, 0.8, 64), std('#9b7bff')));
    g.add(side);
    const cap = shadowed(new THREE.Mesh(new THREE.CircleGeometry(6.48, 64), std('#ffffff', { map: wedgeTex('#9b7bff', '#e4dbff', 12) })));
    cap.rotation.x = -Math.PI / 2; cap.position.y = 0.405;
    g.add(cap);
    const rim = shadowed(new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.12, 10, 64), std('#ffffff')));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.34;
    g.add(rim);
    this.scene.add(g);
    const ball = shadowed(new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 16), std('#ffd23f')));
    ball.position.set(0, -1.4, z);
    this.scene.add(ball);
    const pillar = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 14, 16), std('#ffffff', { map: stripeTex('#9b7bff', '#ffffff', 12) })));
    pillar.position.set(0, -8.5, z);
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
      const base = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.25, 28), std('#5b3cc4')));
      base.position.y = 0.12;
      g.add(base);
      const coil = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.07, 8, 28), std('#ffffff', { metalness: 0.3, roughness: 0.3 })));
      coil.rotation.x = Math.PI / 2;
      g.add(coil);
      const top = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.14, 28), std('#ffffff', { map: wedgeTex('#ffd23f', '#ff4f8b', 8) })));
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
      p.coil.scale.set(1, 1, 1 + p.squash * 2);
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
    const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 3.6, 32), std('#ffffff', { map: stripeTex('#ff4f8b', '#ffffff', 8) })));
    post.position.set(c.x, c.y + 1.8, c.z);
    this.occluders.push(post);
    this.scene.add(post);
    const cap = shadowed(new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 16), std(YELLOWC)));
    cap.position.set(c.x, c.y + 3.6, c.z);
    this.scene.add(cap);
    const mk = (y, radius, len, omega, color, isLow) => {
      const g = new THREE.Group();
      g.position.set(c.x, y, c.z);
      const bar = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len * 2, 20), std('#ffffff', { map: stripeTex(color, '#ffffff', 22) })));
      bar.rotation.z = Math.PI / 2;
      g.add(bar);
      for (const s of [1, -1]) {
        const end = shadowed(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.5, 16, 12), std(color)));
        end.position.x = s * len;
        g.add(end);
      }
      this.scene.add(g);
      this.obstacles.push({ kind: 'sweeper', id: 'sw' + c.z + ':' + y, c, y, radius, len, omega, group: g, angle: 0, low: isLow });
    };
    mk(c.y + 0.48, 0.3, low, 1.05, '#ff4f8b', true);
    mk(c.y + 2.75, 0.24, high, -0.62, '#5b3cc4', false);
  }

  // spots: [z, floorY]; `clear` is the gap between the floor and the bottom of the swing
  buildHammers(spots = [178, 185.5, 193, 200.5].map((z) => [z, 6]), clear = 0.55, headOnly = false) {
    const frameMat = std('#ffffff', { map: stripeTex('#9b7bff', '#ffffff', 10) });
    spots.forEach(([z, floor], i) => {
      const L = 5.6, yp = floor + clear + 0.85 + L;
      for (const s of [1, -1]) {
        const postM = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, yp - floor + 0.8, 12), frameMat));
        postM.position.set(s * 4.6, (yp + floor - 0.8) / 2, z);
        this.scene.add(postM);
        this.occluders.push(postM);
      }
      const beam = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 9.4, 12), frameMat));
      beam.rotation.z = Math.PI / 2;
      beam.position.set(0, yp, z);
      this.scene.add(beam);
      const piv = new THREE.Group();
      piv.position.set(0, yp, z);
      const rope = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, L, 8), std('#ffffff')));
      rope.position.y = -L / 2;
      piv.add(rope);
      const head = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.9, 28), std('#ffffff', { map: stripeTex(i % 2 ? '#ff9f43' : '#ff4f8b', '#ffffff', 6) })));
      head.rotation.x = Math.PI / 2;
      head.position.y = -L;
      piv.add(head);
      for (const s of [1, -1]) {
        const capM = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), std('#ffd23f')));
        capM.rotation.x = s * Math.PI / 2;
        capM.position.set(0, -L, s * 0.95);
        piv.add(capM);
      }
      this.scene.add(piv);
      this.obstacles.push({ kind: 'hammer', id: 'hm' + z, piv, yp, L, z, floor, clear, headOnly, amp: 1.05, omega: 1.5 + i * 0.12, phase: i * 1.7, center: new THREE.Vector3(), vel: new THREE.Vector3() });
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
      const ring = shadowed(new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.25, 12, 40), std('#ffffff')));
      g.add(ring);
      const hub = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), std('#ff4f8b')));
      g.add(hub);
      const blades = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.08), std('#4fa8ff')));
        b.position.y = 1.0;
        const holder = new THREE.Group();
        holder.rotation.z = (i / 4) * Math.PI * 2;
        b.rotation.y = 0.5;
        holder.add(b);
        blades.add(holder);
      }
      g.add(blades);
      const stand = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 8, 10), std('#ffffff')));
      stand.position.y = -6;
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
    // arches
    const arch = (z, y, text, c1, c2) => {
      const g = new THREE.Group();
      g.position.set(0, y, z);
      const mat = std('#ffffff', { map: stripeTex(c1, '#ffffff', 10) });
      for (const s of [1, -1]) {
        const p = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 6, 20), mat));
        p.position.set(s * 6.2, 3, 0);
        g.add(p);
        this.occluders.push(p);
        const ball = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14), std(c2)));
        ball.position.set(s * 6.2, 6.4, 0);
        g.add(ball);
      }
      const banner = shadowed(new THREE.Mesh(new RoundedBoxGeometry(12.4, 1.6, 0.4, 3, 0.15), [
        std(c1), std(c1), std(c1), std(c1), std('#ffffff', { map: textTex(text, c1, '#ffffff') }), std('#ffffff', { map: textTex(text, c1, '#ffffff') }),
      ]));
      banner.position.y = 5.6;
      banner.rotation.y = Math.PI; // readable when approaching from -z
      g.add(banner);
      S.add(g);
      return g;
    };
    arch(-1.5, 0, 'LURCHING LLAMA', '#ff4f8b', '#ffd23f');
    arch(this.finishZ, this.finishY, 'FINISH!', '#5b3cc4', '#ff4f8b');
    // finish line
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(15.6, 1.4), std('#ffffff', { map: checkerTex('#222222', '#ffffff', 12) }));
    fl.material.map.repeat.set(5, 0.45);
    fl.rotation.x = -Math.PI / 2;
    fl.position.set(0, this.finishY + 0.02, this.finishZ);
    fl.receiveShadow = true;
    S.add(fl);
    // podium flags at the finish
    for (let i = 0; i < 6; i++) {
      const x = (i < 3 ? -1 : 1) * (7.2), z = this.finishZ + 3 + (i % 3) * 3;
      const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 8), std('#ffffff')));
      pole.position.set(x, this.finishY + 1.5, z); S.add(pole);
      const flag = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), std(['#ff4f8b', '#ffd23f', '#3fd6c6'][i % 3], { side: THREE.DoubleSide })));
      flag.position.set(x - Math.sign(x) * 0.6, this.finishY + 2.6, z); S.add(flag);
    }

    // fluffy clouds made of the same fleece as the llamas
    const cloudGeo = woolGeometry(77, 6, { lump: 0.2, curl: 0.08, curlFreq: 3 });
    const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, vertexColors: true, emissive: '#ffe8f4', emissiveIntensity: 0.25 });
    const puffs = [];
    for (let i = 0; i < 46; i++) {
      const side = this.rand() < 0.5 ? -1 : 1;
      const cx = side * (25 + this.rand() * 70), cy = -14 + this.rand() * 40, cz = -40 + this.rand() * 330;
      const rot = this.rand() * Math.PI, c = Math.cos(rot), sn = Math.sin(rot);
      const n = 3 + Math.floor(this.rand() * 4);
      for (let k = 0; k < n; k++) {
        const sc = 2 + this.rand() * 3;
        const lx = k * 3 - n * 1.5 + this.rand(), ly = this.rand() * 1.5, lz = this.rand() * 2;
        puffs.push(new THREE.Matrix4().compose(
          new THREE.Vector3(cx + lx * c + lz * sn, cy + ly, cz - lx * sn + lz * c),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot),
          new THREE.Vector3(sc * 1.3, sc * 0.8, sc)));
      }
    }
    const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, puffs.length);
    puffs.forEach((m, i) => clouds.setMatrixAt(i, m));
    S.add(clouds);

    // floating candy islands in the distance
    const islandCols = ['#ff7eb6', '#9b7bff', '#3fd6c6', '#ffd23f', '#ff9f43'];
    for (let i = 0; i < 18; i++) {
      const r = 4 + this.rand() * 8;
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 1.2, 28), std(islandCols[i % 5]));
      g.add(top);
      const under = new THREE.Mesh(new THREE.ConeGeometry(r * 0.9, r * 1.4, 28), std('#c9a6ff'));
      under.rotation.x = Math.PI; under.position.y = -0.6 - r * 0.7;
      g.add(under);
      const side = i % 2 ? -1 : 1;
      g.position.set(side * (45 + this.rand() * 80), -20 + this.rand() * 30, -60 + this.rand() * 360);
      S.add(g);
    }

    // goo sea far below
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), std('#ff8fcf', {
      roughness: 0.18, metalness: 0.05, emissive: '#ff5fb0', emissiveIntensity: 0.22,
      normalMap: gooNormalMap(), normalScale: new THREE.Vector2(0.6, 0.6),
    }));
    sea.material.normalMap.repeat.set(60, 60);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -26, 120);
    S.add(sea);
    this.sea = sea;
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
    this.sea.material.normalMap.offset.set(t * 0.012, t * 0.007);
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
        const tex = canvasTexture(256, 64, (ctx, w, h) => {
          ctx.fillStyle = '#e8c35a'; ctx.fillRect(0, 0, w, h);
          for (let i = 0; i < 400; i++) {
            ctx.strokeStyle = ['#d4a83d', '#f5da82', '#c99a32'][i % 3];
            ctx.lineWidth = 1 + Math.random() * 2;
            const x = Math.random() * w, y = Math.random() * h;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 + Math.random() * 14, y + (Math.random() - 0.5) * 6); ctx.stroke();
          }
        });
        this.baleMat = std('#ffffff', { map: tex, roughness: 1 });
        this.bandGeo = new THREE.TorusGeometry(0.77, 0.05, 6, 24).rotateY(Math.PI / 2);
        this.bandMat = std('#ff4f8b');
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

const YELLOWC = '#ffd23f';
