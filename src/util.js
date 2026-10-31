import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// Frame-rate independent exponential approach.
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(i, j, k, seed) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683) ^ Math.imul(seed + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// Smooth value noise in [-1, 1].
export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
}

export function fbm3(x, y, z, seed = 0, oct = 3) {
  let amp = 0.5, f = 1, sum = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * noise3(x * f, y * f, z * f, seed + o * 17);
    f *= 2.03; amp *= 0.5;
  }
  return sum;
}

// A lumpy, curly fleece blob: a subdivided sphere displaced by large soft lumps
// plus "billow" curls, with darker vertex colours in the crevices for fake AO.
export function woolGeometry(seed = 1, detail = 8, opts = {}) {
  const { lump = 0.14, curl = 0.09, curlFreq = 6.5, sx = 1, sy = 1, sz = 1 } = opts;
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const big = fbm3(v.x * 1.5, v.y * 1.5, v.z * 1.5, seed, 2);
    const c = Math.abs(noise3(v.x * curlFreq * sx, v.y * curlFreq * sy, v.z * curlFreq * sz, seed + 99));
    const c2 = Math.abs(noise3(v.x * curlFreq * 2.3 * sx, v.y * curlFreq * 2.3 * sy, v.z * curlFreq * 2.3 * sz, seed + 7));
    const curls = c * 0.75 + c2 * 0.25;
    const d = 1 + big * lump + (curls - 0.3) * curl;
    p.setXYZ(i, v.x * d * sx, v.y * d * sy, v.z * d * sz);
    const shade = 0.68 + 0.32 * clamp(curls * 1.3 + big * 0.5, 0, 1);
    col[i * 3] = shade; col[i * 3 + 1] = shade; col[i * 3 + 2] = shade * 0.97;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Closest point on segment ab to p, written into out. Returns t.
export function closestOnSegment(p, a, b, out) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz || 1e-9;
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2, 0, 1);
  out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
  return t;
}

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
