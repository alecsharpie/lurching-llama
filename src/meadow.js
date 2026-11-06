import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, rng, noise3, woolGeometry } from './util.js';

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

// High-puna turf seen from above: short green grass grazed low, threaded with golden
// ichu straw, plus the odd tiny gentian and yellow daisy.
export function grassTex() {
  return once('grass', () => tile(canvasTexture(512, 512, (ctx, w, h) => {
    const r = rng(7);
    ctx.fillStyle = '#86a64c'; ctx.fillRect(0, 0, w, h);
    // soft mottling: greener damp hollows and drier golden patches
    for (let i = 0; i < 90; i++) {
      const x = r() * w, y = r() * h, s = 20 + r() * 60;
      ctx.fillStyle = ['rgba(104,150,62,0.4)', 'rgba(196,176,92,0.32)', 'rgba(120,160,70,0.3)'][i % 3];
      wrapped(ctx, w, h, x, y, (X, Y) => { ctx.beginPath(); ctx.ellipse(X, Y, s, s * 0.7, r() * 3, 0, Math.PI * 2); ctx.fill(); });
    }
    // blades: mostly green, a quarter of them sun-cured gold
    const greens = ['#6f9a3e', '#8db552', '#9cc05e', '#5f8a36', '#d2b660', '#c4a24c'];
    for (let i = 0; i < 4200; i++) {
      const x = r() * w, y = r() * h, len = 5 + r() * 10, a = -Math.PI / 2 + (r() - 0.5) * 1.3;
      ctx.strokeStyle = greens[i % greens.length]; ctx.lineWidth = 1 + r() * 1.4;
      wrapped(ctx, w, h, x, y, (X, Y) => { ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(a) * len, Y + Math.sin(a) * len); ctx.stroke(); });
    }
    // tiny puna flowers: purple gentians, yellow daisies, white cushion stars
    const flowers = ['#7b5cc4', '#ffd54a', '#ffffff', '#9a6fe0', '#ffd54a'];
    for (let i = 0; i < 45; i++) {
      const x = r() * w, y = r() * h, c = flowers[i % flowers.length], s = 1.6 + r() * 1.8;
      wrapped(ctx, w, h, x, y, (X, Y) => {
        ctx.fillStyle = c;
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(X + Math.cos(a) * s, Y + Math.sin(a) * s, s * 0.8, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = c === '#ffd54a' ? '#d9822b' : '#ffe9a6'; ctx.beginPath(); ctx.arc(X, Y, s * 0.6, 0, Math.PI * 2); ctx.fill();
      });
    }
    // llama beans: they always use the same communal spots, so a few neat little piles
    for (let i = 0; i < 3; i++) {
      const x = r() * w, y = r() * h;
      for (let k = 0; k < 7; k++) {
        const X = x + (r() - 0.5) * 9, Y = y + (r() - 0.5) * 7;
        ctx.fillStyle = '#3d2a1c'; ctx.beginPath(); ctx.ellipse(X, Y, 1.8, 1.4, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  })));
}

// Banded red-and-ochre Andean earth with volcanic pebbles, for the sides of turf blocks.
export function earthTex() {
  return once('earth', () => tile(canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(11);
    const bands = ['#8b4f33', '#9c5f3b', '#7a4630', '#b07a45', '#93573a', '#a86c43'];
    let y = 0;
    while (y < h) { const bh = 12 + r() * 28; ctx.fillStyle = bands[Math.floor(r() * bands.length)]; ctx.fillRect(0, y, w, bh); y += bh; }
    for (let i = 0; i < 160; i++) {
      const x = r() * w, yy = r() * h, s = 2 + r() * 7;
      ctx.fillStyle = ['#b3a493', '#6f6058', '#4f3324', '#cdb89a'][i % 4];
      wrapped(ctx, w, h, x, yy, (X, Y) => { ctx.beginPath(); ctx.ellipse(X, Y, s, s * 0.7, r() * 3, 0, Math.PI * 2); ctx.fill(); });
    }
    // grass roots hanging over the top edge
    ctx.strokeStyle = 'rgba(70,95,40,0.55)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 60; i++) { const x = r() * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (r() - 0.5) * 6, 4 + r() * 12); ctx.stroke(); }
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

// Warm volcanic tuff, freckled with the bright orange and lime lichens that crust every
// rock up on the altiplano.
export function stoneTex() {
  return once('stone', () => tile(canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(31);
    ctx.fillStyle = '#cfc5b5'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = r() * w, y = r() * h, s = 3 + r() * 16;
      ctx.fillStyle = ['rgba(160,146,128,0.45)', 'rgba(222,212,194,0.45)', 'rgba(140,130,118,0.35)', 'rgba(196,174,148,0.4)'][i % 4];
      wrapped(ctx, w, h, x, y, (X, Y) => { ctx.beginPath(); ctx.ellipse(X, Y, s, s * 0.7, r() * 3, 0, Math.PI * 2); ctx.fill(); });
    }
    ctx.strokeStyle = 'rgba(90,78,66,0.45)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      let x = r() * w, y = r() * h;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // lichen rosettes, small and soft
    for (let i = 0; i < 55; i++) {
      const x = r() * w, y = r() * h, s = 1.2 + r() * 3;
      const c = ['rgba(226,140,60,0.5)', 'rgba(186,196,100,0.45)', 'rgba(230,180,90,0.45)', 'rgba(235,232,215,0.5)'][i % 4];
      wrapped(ctx, w, h, x, y, (X, Y) => {
        ctx.fillStyle = c;
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(X + (r() - 0.5) * s, Y + (r() - 0.5) * s, s * (0.4 + r() * 0.4), 0, Math.PI * 2); ctx.fill(); }
      });
    }
  })));
}

// Inca-style fitted masonry: rounded polygonal blocks with tight dark joints.
export function ashlarTex() {
  return once('ashlar', () => tile(canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(37);
    ctx.fillStyle = '#7a6c5e'; ctx.fillRect(0, 0, w, h);
    const rows = 6, rh = h / rows;
    for (let j = 0; j < rows; j++) {
      let x = -r() * 40;
      while (x < w) {
        const bw = 30 + r() * 40, y0 = j * rh;
        const shade = 168 + r() * 40;
        ctx.fillStyle = `rgb(${shade + 14},${shade + 2},${shade - 14})`;
        const pad = 1.3;
        wrapped(ctx, w, h, x, y0, (X, Y) => {
          ctx.beginPath();
          ctx.roundRect(X + pad, Y + pad, bw - pad * 2, rh - pad * 2, 9);
          ctx.fill();
        });
        // pillowed face: lighter middle
        ctx.fillStyle = 'rgba(255,245,225,0.12)';
        wrapped(ctx, w, h, x, y0, (X, Y) => { ctx.beginPath(); ctx.ellipse(X + bw / 2, Y + rh / 2, bw * 0.32, rh * 0.28, 0, 0, Math.PI * 2); ctx.fill(); });
        x += bw;
      }
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = ['rgba(232,130,40,0.6)', 'rgba(196,206,90,0.55)'][i % 2];
      ctx.beginPath(); ctx.arc(r() * w, r() * h, 1.5 + r() * 3, 0, Math.PI * 2); ctx.fill();
    }
  })));
}

// Woven aguayo cloth: bands of stripes, zigzags and diamonds in hot Andean colours.
const AGUAYO = ['#d81b60', '#ff7a1a', '#ffc928', '#1e9e8a', '#3b4cc0', '#7b2d8b', '#e8352e', '#2e8b3e'];
export function drawAguayoBand(ctx, x0, y0, w, h, r, kind) {
  const c = () => AGUAYO[Math.floor(r() * AGUAYO.length)];
  if (kind === 0) { // fine stripes
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) { ctx.fillStyle = c(); ctx.fillRect(x0, y0 + (i / n) * h, w, h / n + 0.5); }
  } else if (kind === 1) { // zigzag on a ground colour
    ctx.fillStyle = c(); ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = c(); ctx.lineWidth = h * 0.22;
    const step = h * 0.9;
    let k = 0; ctx.beginPath();
    for (let x = x0; x <= x0 + w + 0.1; x += step / 2) { ctx.lineTo(x, y0 + (k++ % 2 ? h * 0.78 : h * 0.22)); }
    ctx.stroke();
  } else { // diamonds with a centre dot
    ctx.fillStyle = c(); ctx.fillRect(x0, y0, w, h);
    const d = c(), e = c(), step = h * 1.1;
    for (let x = x0 + step / 2; x < x0 + w; x += step) {
      ctx.fillStyle = d;
      ctx.beginPath(); ctx.moveTo(x, y0 + h * 0.1); ctx.lineTo(x + h * 0.42, y0 + h / 2); ctx.lineTo(x, y0 + h * 0.9); ctx.lineTo(x - h * 0.42, y0 + h / 2); ctx.fill();
      ctx.fillStyle = e; ctx.fillRect(x - h * 0.08, y0 + h * 0.42, h * 0.16, h * 0.16);
    }
  }
}
export function aguayoTex(seed = 1) {
  return once('aguayo' + seed, () => tile(canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(101 + seed * 13);
    let y = 0, k = 0;
    while (y < h) {
      const bh = [10, 28, 34][k % 3] * (0.8 + r() * 0.4);
      drawAguayoBand(ctx, 0, y, w, Math.min(bh, h - y), r, k % 3);
      y += bh; k++;
    }
    // woven texture
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let x = 0; x < w; x += 3) ctx.fillRect(x, 0, 1, h);
  })));
}

// Bundled totora reeds: long tan stalks with darker lashings.
export function reedTex() {
  return once('reed', () => tile(canvasTexture(256, 128, (ctx, w, h) => {
    const r = rng(43);
    ctx.fillStyle = '#c9a85e'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      ctx.strokeStyle = ['#b8954c', '#dcc07a', '#a8853f', '#d2b469'][i % 4]; ctx.lineWidth = 1.5 + r() * 2.5;
      const y = r() * h;
      wrapped(ctx, w, h, 0, y, (X, Y) => { ctx.beginPath(); ctx.moveTo(0, Y); ctx.lineTo(w, Y + (r() - 0.5) * 3); ctx.stroke(); });
    }
    ctx.fillStyle = 'rgba(90,60,30,0.55)';
    for (let x = 20; x < w; x += 64) ctx.fillRect(x, 0, 5, h);
  })));
}

// Ichu-grass thatch, laid in overlapping courses.
export function thatchTex() {
  return once('thatch', () => tile(canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(47);
    ctx.fillStyle = '#b8964f'; ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) {
      const y0 = (row / 8) * h;
      for (let i = 0; i < 160; i++) {
        ctx.strokeStyle = ['#d6b866', '#a8853f', '#c9a659', '#e2c87c'][i % 4]; ctx.lineWidth = 1 + r() * 1.5;
        const x = r() * w;
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + (r() - 0.5) * 4, y0 + h / 8 + 6); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(70,50,20,0.35)'; ctx.fillRect(0, y0 + h / 8 - 3, w, 3);
    }
  })));
}

// Sun-dried adobe bricks under a worn mud render.
export function adobeTex() {
  return once('adobe', () => tile(canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(59);
    ctx.fillStyle = '#c08d5f'; ctx.fillRect(0, 0, w, h);
    const bh = 22, bw = 52;
    for (let j = 0; j < h / bh; j++) for (let i = -1; i < w / bw + 1; i++) {
      const x = i * bw + (j % 2) * bw / 2, y = j * bh;
      ctx.fillStyle = ['#b9845a', '#c99a6b', '#ae7a52'][(i + j * 3) & 1 ? 0 : (i + j) % 3];
      ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
    }
    // render flaking off in patches
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = 'rgba(214,176,132,0.85)';
      ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 20 + r() * 40, 14 + r() * 24, r() * 3, 0, Math.PI * 2); ctx.fill();
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
// Shared scenery pieces (the wider world lives in altiplano.js)
// ---------------------------------------------------------------------------

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

// Merge geometries (any mix of indexed / non-indexed) into one non-indexed geometry with
// position, normal and per-vertex colour. parts: [{ geo, color, matrix? }] (color may be a
// function (x, y, z) -> [r, g, b] for gradients, evaluated on the transformed vertex).
const _col = new THREE.Color();
export function mergeColored(parts, smooth = false) {
  const geos = parts.map(({ geo, color, matrix }) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    if (matrix) g.applyMatrix4(matrix);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const c = typeof color === 'function' ? color(p.getX(i), p.getY(i), p.getZ(i)) : _col.set(color).toArray();
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
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
  if (smooth) { const m = mergeVertices(out, 1e-3); m.computeVertexNormals(); return m; }
  out.computeVertexNormals(); // non-indexed, so normals are per face: a faceted, low-poly look
  return out;
}

const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
export { M4 };

// Ichu: the golden bunchgrass of the high puna, in spiky fountain-shaped tussocks, with
// the odd lupin spike or yellow daisy poking out. Points are [x, y, z] on flat ground.
export function ichuTussocks(group, points, scale = 1) {
  if (!points.length) return;
  const r = rng(5);
  const blade = new THREE.ConeGeometry(0.035, 0.62, 3, 1, true).translate(0, 0.31, 0);
  const parts = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + r() * 0.4, tilt = 0.12 + r() * 0.55, len = 0.75 + r() * 0.5;
    parts.push({
      geo: blade, matrix: M4(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt, 1, len, 1),
      // green at the base, straw-gold at the tips
      color: (x, y) => _col.set('#6f8a3a').lerp(_col2.set('#e3c56c'), Math.min(1, y / 0.55)).toArray(),
    });
  }
  const tussock = mergeColored(parts);
  const lupin = mergeColored([
    { geo: new THREE.CylinderGeometry(0.012, 0.014, 0.5, 4).translate(0, 0.25, 0), color: '#5f7d35' },
    { geo: new THREE.ConeGeometry(0.05, 0.22, 6).translate(0, 0.58, 0), color: '#7656c8' },
  ]);
  const daisy = mergeColored([
    { geo: new THREE.CylinderGeometry(0.01, 0.01, 0.3, 4).translate(0, 0.15, 0), color: '#5f7d35' },
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.015, 8).translate(0, 0.3, 0), color: '#ffd54a' },
    { geo: new THREE.SphereGeometry(0.025, 6, 4).translate(0, 0.31, 0), color: '#d9822b' },
  ]);
  const mat = std('#ffffff', { vertexColors: true, roughness: 1 });
  const tm = new THREE.InstancedMesh(tussock, mat, points.length);
  const flowers = points.filter((_, i) => i % 3 === 0);
  const lm = new THREE.InstancedMesh(lupin, mat, Math.ceil(flowers.length / 2));
  const dm = new THREE.InstancedMesh(daisy, mat, Math.floor(flowers.length / 2));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  points.forEach(([x, y, z], i) => {
    q.setFromAxisAngle(up, i * 1.7);
    const k = (0.7 + ((i * 7) % 5) * 0.12) * scale;
    m.compose(new THREE.Vector3(x, y, z), q, s.set(k * 1.1, k, k * 1.1));
    tm.setMatrixAt(i, m);
    tm.setColorAt(i, c.setHSL(0.13 + ((i * 3) % 5) * 0.012, 0.25, 0.8 + ((i * 5) % 4) * 0.06));
  });
  flowers.forEach(([x, y, z], i) => {
    const mesh = i % 2 ? dm : lm, j = i >> 1;
    q.setFromAxisAngle(up, i);
    m.compose(new THREE.Vector3(x + 0.18, y, z - 0.12), q, s.setScalar(scale * (0.9 + (i % 3) * 0.15)));
    mesh.setMatrixAt(j, m);
  });
  tm.receiveShadow = true;
  group.add(tm, lm, dm);
}
const _col2 = new THREE.Color();

// A stone-forest tower (like the eroded tuff pinnacles of Huayllay, where llamas graze
// between the rocks): a column that tapers into the lake, its sides stepped by soft ledges
// of harder rock, the layers tinted cream, rust and grey. Carries vertex colours, so its
// material needs vertexColors: true.
export function rockColumn(r, height, seed = 77) {
  const g = new THREE.CylinderGeometry(r * 0.92, r * 0.55, height, 12, Math.max(6, Math.round(height / 1.6)));
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const strata = ['#f4e8d4', '#ecc6aa', '#d8d4cc', '#f2dcb0', '#dcb89c'];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noise3(x * 0.4, y * 0.25, z * 0.4, seed);
    const top = y > height / 2 - 0.01;
    // hard layers stick out, soft ones are scooped back in
    const yy = y + noise3(x * 0.2, 0, z * 0.2, seed + 3) * 1.2;
    const ledge = Math.pow(Math.abs(Math.sin(yy * 0.55)), 6) * 0.13 - 0.03;
    const k = top ? 1 : 1 + n * 0.22 + ledge;
    p.setXYZ(i, x * k, y, z * k);
    _col.set(strata[Math.abs(Math.floor(yy / 2.4)) % strata.length]);
    // damp, darker toward the waterline
    const wet = Math.max(0, Math.min(1, (y + height / 2) / 6));
    _col.multiplyScalar(0.72 + 0.28 * wet);
    col.set([_col.r, _col.g, _col.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// A string of woven aguayo pennants between two points, with fat yarn pompoms between
// them, like the tassels herders tie into their llamas' ears at the flowering festival.
const PENNANT_MATS = [];
const POM_COLS = ['#d81b60', '#ff7a1a', '#ffc928', '#1e9e8a', '#7b2d8b', '#3b4cc0'];
function pennantMats() {
  if (PENNANT_MATS.length) return PENNANT_MATS;
  for (let k = 0; k < 4; k++) {
    const tex = canvasTexture(64, 128, (ctx, w, h) => {
      const r = rng(300 + k * 7);
      let y = 0, j = k;
      while (y < h) { const bh = 10 + r() * 22; drawAguayoBand(ctx, 0, y, w, bh, r, j++ % 3); y += bh; }
    });
    tex.userData.shared = true;
    PENNANT_MATS.push(std('#ffffff', { map: tex, side: THREE.DoubleSide }));
  }
  return PENNANT_MATS;
}
export function bunting(group, a, b, sag = 0.6, n = 12) {
  const tri = new THREE.BufferGeometry()
    .setAttribute('position', new THREE.Float32BufferAttribute([-0.19, 0, 0, 0.19, 0, 0, 0, -0.42, 0], 3))
    .setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
  tri.computeVertexNormals();
  const mats = pennantMats();
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -Math.sin(Math.PI * t) * sag, 0)));
  }
  const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.018, 4), std('#e9dcc0'));
  group.add(line);
  const flags = [];
  const pomGeo = woolPom();
  for (let i = 1; i < n; i++) {
    const f = new THREE.Mesh(tri, mats[i % mats.length]);
    f.position.copy(pts[i]);
    f.lookAt(f.position.clone().add(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3(0, 1, 0))));
    group.add(f);
    flags.push(f);
    // a pompom halfway to the next pennant
    const pom = new THREE.Mesh(pomGeo, pomMat(POM_COLS[i % POM_COLS.length]));
    pom.position.lerpVectors(pts[i], pts[i + 1], 0.5).y -= 0.12;
    pom.scale.setScalar(0.11);
    group.add(pom);
  }
  return flags;
}
let POM_GEO = null;
const POM_MATS = {};
function woolPom() {
  return POM_GEO || (POM_GEO = woolGeometry(55, 2, { lump: 0.15, curl: 0.25, curlFreq: 5 }));
}
export function pomMat(c) {
  return POM_MATS[c] || (POM_MATS[c] = std(c, { vertexColors: true, roughness: 1 }));
}
