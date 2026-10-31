import * as THREE from 'three';
import { canvasTexture, rng, noise3 } from './util.js';

// ---------------------------------------------------------------------------
// Highland meadow look: hand-painted canvas textures and scenery pieces.
// Every texture is procedural, tileable and built once (shared by all courses).
// ---------------------------------------------------------------------------

const TEX = {};
const once = (key, make) => {
  if (!TEX[key]) { TEX[key] = make(); TEX[key].userData.shared = true; }
  return TEX[key];
};
const tile = (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };

// Draw with wrap-around so strokes that cross an edge continue on the other side.
function wrapped(ctx, w, h, x, y, draw) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
    if (x + ox < -40 || x + ox > w + 40 || y + oy < -40 || y + oy > h + 40) continue;
    draw(x + ox, y + oy);
  }
}

// Short grass seen from above, with clover and a few wildflowers.
export function grassTex() {
  return once('grass', () => tile(canvasTexture(512, 512, (ctx, w, h) => {
    const r = rng(7);
    ctx.fillStyle = '#6fae4a'; ctx.fillRect(0, 0, w, h);
    // soft mottling
    for (let i = 0; i < 90; i++) {
      const x = r() * w, y = r() * h, s = 20 + r() * 60;
      ctx.fillStyle = ['rgba(90,150,60,0.35)', 'rgba(140,190,80,0.3)', 'rgba(70,130,55,0.3)'][i % 3];
      wrapped(ctx, w, h, x, y, (X, Y) => { ctx.beginPath(); ctx.ellipse(X, Y, s, s * 0.7, r() * 3, 0, Math.PI * 2); ctx.fill(); });
    }
    // blades
    const greens = ['#5c9a3c', '#7dbd52', '#8fcb5e', '#4f8a35', '#a3d86f'];
    for (let i = 0; i < 4200; i++) {
      const x = r() * w, y = r() * h, len = 5 + r() * 9, a = -Math.PI / 2 + (r() - 0.5) * 1.2;
      ctx.strokeStyle = greens[i % greens.length]; ctx.lineWidth = 1 + r() * 1.4;
      wrapped(ctx, w, h, x, y, (X, Y) => { ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(a) * len, Y + Math.sin(a) * len); ctx.stroke(); });
    }
    // clover and flowers
    const flowers = ['#ffffff', '#ffe066', '#f7a8d8', '#b9a3ff', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      const x = r() * w, y = r() * h, c = flowers[i % flowers.length], s = 2 + r() * 2.2;
      wrapped(ctx, w, h, x, y, (X, Y) => {
        ctx.fillStyle = c;
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(X + Math.cos(a) * s, Y + Math.sin(a) * s, s * 0.8, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#ffcf3f'; ctx.beginPath(); ctx.arc(X, Y, s * 0.6, 0, Math.PI * 2); ctx.fill();
      });
    }
  })));
}

// Layered earth and rock for the sides of turf blocks.
export function earthTex() {
  return once('earth', () => tile(canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(11);
    const bands = ['#7a5536', '#8a6141', '#6d4a2f', '#94704d', '#7f5a3a'];
    let y = 0;
    while (y < h) { const bh = 14 + r() * 30; ctx.fillStyle = bands[Math.floor(r() * bands.length)]; ctx.fillRect(0, y, w, bh); y += bh; }
    for (let i = 0; i < 160; i++) {
      const x = r() * w, yy = r() * h, s = 2 + r() * 7;
      ctx.fillStyle = ['#a59a8c', '#857a6e', '#5e4430', '#b8ab98'][i % 4];
      wrapped(ctx, w, h, x, yy, (X, Y) => { ctx.beginPath(); ctx.ellipse(X, Y, s, s * 0.7, r() * 3, 0, Math.PI * 2); ctx.fill(); });
    }
  })));
}

// Weathered planks running along v.
export function woodTex(tint = 0) {
  return once('wood' + tint, () => tile(canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(23 + tint);
    const base = tint ? ['#a8743f', '#b9844b', '#9b6a39'] : ['#c49a63', '#b88d57', '#cfa771'];
    const n = 4, pw = w / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = base[i % base.length]; ctx.fillRect(i * pw, 0, pw, h);
      for (let k = 0; k < 14; k++) {
        ctx.strokeStyle = `rgba(80,50,25,${0.12 + r() * 0.18})`; ctx.lineWidth = 1 + r();
        const x = i * pw + 4 + r() * (pw - 8);
        ctx.beginPath(); ctx.moveTo(x, 0);
        for (let yy = 0; yy <= h; yy += 16) ctx.lineTo(x + Math.sin(yy * 0.05 + k) * 2.5, yy);
        ctx.stroke();
      }
      // knots, nail heads and plank gaps
      if (r() < 0.8) { ctx.fillStyle = 'rgba(90,55,25,0.55)'; ctx.beginPath(); ctx.ellipse(i * pw + pw / 2, r() * h, 5, 9, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#5a3b20'; ctx.fillRect(i * pw, 0, 3, h);
      ctx.fillStyle = '#4a4a4a';
      for (const yy of [h * 0.1, h * 0.9]) for (const xx of [i * pw + 9, i * pw + pw - 9]) { ctx.beginPath(); ctx.arc(xx, yy, 2.5, 0, Math.PI * 2); ctx.fill(); }
    }
  })));
}

// Mossy grey stone.
export function stoneTex() {
  return once('stone', () => tile(canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(31);
    ctx.fillStyle = '#9a9a92'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = r() * w, y = r() * h, s = 3 + r() * 16;
      ctx.fillStyle = ['rgba(120,120,112,0.5)', 'rgba(170,170,160,0.45)', 'rgba(100,104,96,0.4)', 'rgba(110,150,80,0.35)'][i % 4];
      wrapped(ctx, w, h, x, y, (X, Y) => { ctx.beginPath(); ctx.ellipse(X, Y, s, s * 0.7, r() * 3, 0, Math.PI * 2); ctx.fill(); });
    }
    ctx.strokeStyle = 'rgba(60,60,55,0.5)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      let x = r() * w, y = r() * h;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  })));
}

// Top of a millstone: stone with radial grooves, so you can see it turn.
export function millTex() {
  return once('mill', () => canvasTexture(512, 512, (ctx, w, h) => {
    const img = stoneTex().image;
    ctx.drawImage(img, 0, 0, w / 2, h / 2); ctx.drawImage(img, w / 2, 0, w / 2, h / 2);
    ctx.drawImage(img, 0, h / 2, w / 2, h / 2); ctx.drawImage(img, w / 2, h / 2, w / 2, h / 2);
    ctx.strokeStyle = 'rgba(55,55,50,0.55)'; ctx.lineWidth = 6;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(w / 2 + Math.cos(a) * w * 0.1, h / 2 + Math.sin(a) * h * 0.1);
      ctx.lineTo(w / 2 + Math.cos(a + 0.35) * w * 0.49, h / 2 + Math.sin(a + 0.35) * h * 0.49); ctx.stroke();
    }
    ctx.fillStyle = '#6b4a2e'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.07, 0, Math.PI * 2); ctx.fill();
  }));
}

// Grassy disc top (for round platforms that stand still).
export function grassDiscTex() {
  return once('grassDisc', () => canvasTexture(512, 512, (ctx, w, h) => {
    ctx.drawImage(grassTex().image, 0, 0, w, h);
  }));
}

export function barkTex() {
  return once('bark', () => tile(canvasTexture(256, 128, (ctx, w, h) => {
    const r = rng(41);
    ctx.fillStyle = '#6e4b2e'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = ['#523620', '#7d5838', '#5f4128'][i % 3]; ctx.lineWidth = 2 + r() * 4;
      const y = r() * h;
      ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.08 + i) * 3);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(110,150,70,0.5)';
    for (let i = 0; i < 25; i++) { ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 6 + r() * 8, 3, 0, 0, Math.PI * 2); ctx.fill(); }
  })));
}

export function ringsTex() {
  return once('rings', () => canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d9b47c'; ctx.fillRect(0, 0, w, h);
    for (let i = 14; i > 0; i--) {
      ctx.strokeStyle = i % 2 ? '#b98d55' : '#c9a066'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(w / 2 + i * 0.6, h / 2, (i / 14) * w * 0.46, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = '#6e4b2e'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.47, 0, Math.PI * 2); ctx.stroke();
  }));
}

export function hayTex() {
  return once('hay', () => tile(canvasTexture(256, 128, (ctx, w, h) => {
    const r = rng(53);
    ctx.fillStyle = '#e2bd5a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      ctx.strokeStyle = ['#d4a83d', '#f5da82', '#c99a32', '#ecca6c'][i % 4];
      ctx.lineWidth = 1 + r() * 2;
      const x = r() * w, y = r() * h, l = 6 + r() * 16, d = (r() - 0.5) * 6;
      wrapped(ctx, w, h, x, y, (X, Y) => { ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + l, Y + d); ctx.stroke(); });
    }
  })));
}

// Painted fence-rail stripes: a colour and cream.
export function railTex(color, n = 10) {
  return once('rail' + color + n, () => tile(canvasTexture(64, 256, (ctx, w, h) => {
    for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? '#f3ead2' : color; ctx.fillRect(0, (i / n) * h, w, h / n); }
    ctx.fillStyle = 'rgba(80,50,25,0.15)';
    for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 1, 12);
  })));
}

// Toadstool cap: red with white spots (bounce pads).
export function toadstoolTex() {
  return once('toad', () => canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d6372f'; ctx.fillRect(0, 0, w, h);
    const r = rng(61);
    ctx.fillStyle = '#fff6e6';
    for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.arc(r() * w, r() * h * 0.85, 8 + r() * 12, 0, Math.PI * 2); ctx.fill(); }
  }));
}

// ---------------------------------------------------------------------------
// Scenery
// ---------------------------------------------------------------------------

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

// A ring of low-poly mountains with snowy peaks, coloured per vertex by height.
export function mountains(group, centerZ, seed = 3) {
  const r = rng(seed);
  const geos = [];
  const add = (x, z, rad, hgt, snowLine) => {
    const g = new THREE.ConeGeometry(rad, hgt, 9, 6).toNonIndexed();
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      let px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      const u = (py + hgt / 2) / hgt;
      if (u < 0.99) {
        const n = noise3(px * 0.02 + x, py * 0.03, pz * 0.02 + z, seed);
        px *= 1 + n * 0.35; pz *= 1 + n * 0.35; py += n * hgt * 0.06;
      }
      p.setXYZ(i, px + x, py + hgt / 2 - 30, pz + z);
      const snow = u > snowLine + noise3(px * 0.05, pz * 0.05, 1, seed) * 0.08;
      const c = snow ? [0.95, 0.97, 1] : u < 0.25 ? [0.36, 0.52, 0.3] : u < 0.5 ? [0.45, 0.5, 0.42] : [0.55, 0.55, 0.56];
      col.set(c, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  };
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + r() * 0.15;
    const k = 1 + r() * 0.45, big = r();
    add(Math.cos(a) * 300 * k, centerZ + Math.sin(a) * 400 * k, 70 + big * 70, 90 + big * 150, 0.62 + r() * 0.12);
  }
  // closer green foothills
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + r() * 0.2;
    const k = 1 + r() * 0.3;
    add(Math.cos(a) * 200 * k, centerZ + Math.sin(a) * 280 * k, 40 + r() * 35, 40 + r() * 40, 2);
  }
  const merged = mergeAll(geos);
  merged.computeVertexNormals();
  const m = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  group.add(m);
  return m;
}

function mergeAll(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// Instanced pine trees at the given [x, y, z, scale] spots.
export function pines(group, spots) {
  if (!spots.length) return;
  const trunk = new THREE.CylinderGeometry(0.18, 0.26, 1.6, 6).translate(0, 0.8, 0);
  const tiers = [[1.5, 2.2, 1.9], [1.15, 1.9, 3.0], [0.75, 1.6, 4.0]].map(([rad, hh, y]) => new THREE.ConeGeometry(rad, hh, 8).translate(0, y, 0));
  const leaves = mergeAllPlain(tiers);
  const tm = new THREE.InstancedMesh(trunk, std('#6b4a2e'), spots.length);
  const lm = new THREE.InstancedMesh(leaves, std('#3f6e3a', { flatShading: true }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  spots.forEach(([x, y, z, s], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 2.4) % 6.28);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (0.9 + ((i * 7) % 5) * 0.06), s));
    tm.setMatrixAt(i, m); lm.setMatrixAt(i, m);
    lm.setColorAt(i, c.setHSL(0.3 + ((i * 13) % 7) * 0.008, 0.35, 0.28 + ((i * 5) % 6) * 0.015));
  });
  tm.castShadow = lm.castShadow = true;
  group.add(tm, lm);
}

function mergeAllPlain(geos) {
  const parts = geos.map((g) => g.toNonIndexed());
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

// Wildflowers and grass tufts scattered over flat ground ([x, y, z] points).
export function meadowTufts(group, points) {
  if (!points.length) return;
  const tuft = new THREE.ConeGeometry(0.09, 0.32, 5).translate(0, 0.16, 0);
  const flower = new THREE.IcosahedronGeometry(0.07, 0).translate(0, 0.28, 0);
  const tm = new THREE.InstancedMesh(tuft, std('#5f9b3e'), points.length);
  const fm = new THREE.InstancedMesh(flower, std('#ffffff', { emissive: '#222222' }), points.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), s = new THREE.Vector3();
  const cols = ['#ffffff', '#ffe066', '#f28ec4', '#b9a3ff', '#ff9f68'];
  points.forEach(([x, y, z], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7);
    const k = 0.8 + ((i * 7) % 5) * 0.12;
    m.compose(new THREE.Vector3(x, y, z), q, s.set(k, k, k));
    tm.setMatrixAt(i, m);
    fm.setMatrixAt(i, m);
    fm.setColorAt(i, c.set(cols[i % cols.length]));
  });
  tm.receiveShadow = true;
  group.add(tm, fm);
}

// Rock column under a platform, tapering down into the lake.
export function rockColumn(r, height) {
  const g = new THREE.CylinderGeometry(r * 0.92, r * 0.55, height, 10, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noise3(x * 0.4, y * 0.25, z * 0.4, 77);
    const top = y > height / 2 - 0.01;
    p.setXYZ(i, x * (1 + (top ? 0 : n * 0.25)), y, z * (1 + (top ? 0 : n * 0.25)));
  }
  g.computeVertexNormals();
  return g;
}

// A string of little triangular flags between two points.
export function bunting(group, a, b, sag = 0.6, n = 12) {
  const cols = ['#d6372f', '#f2c14e', '#3e7cb1', '#f3ead2', '#5a9e4b'];
  const tri = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-0.18, 0, 0, 0.18, 0, 0, 0, -0.38, 0], 3));
  tri.computeVertexNormals();
  const mats = cols.map((c) => std(c, { side: THREE.DoubleSide }));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -Math.sin(Math.PI * t) * sag, 0)));
  }
  const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.015, 4), std('#5a3b20'));
  group.add(line);
  const flags = [];
  for (let i = 1; i < n; i++) {
    const f = new THREE.Mesh(tri, mats[i % mats.length]);
    f.position.copy(pts[i]);
    f.lookAt(f.position.clone().add(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3(0, 1, 0))));
    group.add(f);
    flags.push(f);
  }
  return flags;
}
