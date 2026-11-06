import * as THREE from 'three';
import { rng, noise3, fbm3, woolGeometry, clamp, smoothstep, lerp } from './util.js';
import {
  mergeColored, M4, stoneTex, ashlarTex, reedTex, thatchTex, adobeTex, aguayoTex, grassTex, ichuTussocks, rockColumn,
} from './meadow.js';

// ---------------------------------------------------------------------------
// The altiplano: the high Andean plateau, 4000m up, where llamas actually live.
//
// The course runs over a deep-blue Titicaca-style lake ringed with totora reeds, between
// towers of eroded tuff (a stone forest, like Huayllay's). Around the shore the puna
// grassland rises in gold toward Inca terraces striped with quinoa, a little adobe village
// with eucalyptus windbreaks, stone corrals and grazing herds, a striped "rainbow mountain"
// and, behind everything, the snowy cordillera and its volcanoes. Condors ride the
// thermals overhead, reed boats bob on the water and llamas watch the race from the rocks.
// ---------------------------------------------------------------------------

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
const lin = (hex) => new THREE.Color(hex);
const LAKE_RX = 150, LAKE_ZS = 1.45; // shoreline radius across the course, and how stretched it is along it
const UP = new THREE.Vector3(0, 1, 0);

function shadowed(m, cast = true, receive = true) { m.castShadow = cast; m.receiveShadow = receive; return m; }

// Per-use copy of a shared texture with its own repeat.
function rep(t, rx = 1, ry = 1) {
  const c = t.clone();
  c.userData = {};
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

// Instance a geometry at a list of { x, y, z, s, ry, sy?, tint? }.
function instances(group, geo, mat, spots, { cast = true, receive = false } = {}) {
  if (!spots.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  spots.forEach((o, i) => {
    q.setFromAxisAngle(UP, o.ry || 0);
    if (o.tilt) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(o.tilt[0], 0, o.tilt[1])));
    m.compose(p.set(o.x, o.y, o.z), q, s.set(o.s * (o.sx || 1), o.s * (o.sy || 1), o.s * (o.sz || 1)));
    im.setMatrixAt(i, m);
    if (o.tint) im.setColorAt(i, c.set(o.tint));
  });
  im.castShadow = cast; im.receiveShadow = receive;
  group.add(im);
  return im;
}

// ---------------------------------------------------------------------------
// Plant and prop geometry (built once, shared by every course)
// ---------------------------------------------------------------------------

const GEO = {};
const geo = (k, make) => GEO[k] || (GEO[k] = make());

// Queñua (Polylepis): the gnarled little tree that grows higher than any other on Earth.
// Twisting multi-stemmed trunks with papery red-orange bark and clumps of grey-green leaves.
function quenuaGeo() {
  return geo('quenua', () => {
    const r = rng(17), parts = [];
    const bark = (x, y) => lin('#b35a32').lerp(lin('#7c3a22'), clamp(1 - y / 2.5, 0, 1) * 0.6).toArray();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + r() * 0.5, lean = 0.5 + r() * 0.5;
      const pts = [new THREE.Vector3(0, 0, 0)];
      let x = 0, y = 0, z = 0;
      for (let j = 1; j <= 4; j++) {
        x += Math.cos(a + j * 0.7) * lean * 0.35; z += Math.sin(a + j * 0.7) * lean * 0.35; y += 0.65 + r() * 0.2;
        pts.push(new THREE.Vector3(x, y, z));
      }
      parts.push({ geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 5, 0.11 - k * 0.015, 4), color: bark });
      // a leafy crown on each stem, plus one partway up
      for (const [pt, s] of [[pts[4], 0.85], [pts[2], 0.55]]) {
        for (let c = 0; c < 3; c++) {
          parts.push({
            geo: new THREE.IcosahedronGeometry(1, 0),
            matrix: M4(pt.x + (r() - 0.5) * 0.7, pt.y + 0.2 + r() * 0.3, pt.z + (r() - 0.5) * 0.7, r(), r(), r(), s * (0.55 + r() * 0.3), s * 0.42, s * (0.55 + r() * 0.3)),
            color: ['#5d7550', '#6e8a5c', '#52694a'][c],
          });
        }
      }
    }
    return mergeColored(parts);
  });
}

// Eucalyptus: planted as windbreaks around every Andean village. Tall, pale and blue-grey.
function eucalyptusGeo() {
  return geo('eucalyptus', () => {
    const r = rng(19), parts = [];
    parts.push({ geo: new THREE.CylinderGeometry(0.16, 0.34, 10, 6).translate(0, 5, 0), color: (x, y) => lin('#d9cfbd').lerp(lin('#9b8a74'), clamp(1 - y / 4, 0, 1)).toArray() });
    for (let k = 0; k < 7; k++) {
      const y = 5.5 + k * 1.0, s = 1.5 - Math.abs(k - 3) * 0.22;
      parts.push({
        geo: new THREE.IcosahedronGeometry(1, 0),
        matrix: M4((r() - 0.5) * 1.6, y, (r() - 0.5) * 1.6, r(), r(), r(), s, s * 1.5, s),
        color: ['#6f8f84', '#7c9a8c', '#5e7d72'][k % 3],
      });
    }
    return mergeColored(parts);
  });
}

// Puya raimondii, the "queen of the Andes": a spiky rosette that, once in a century,
// shoots up a flower spike taller than a house.
function puyaGeo() {
  return geo('puya', () => {
    const r = rng(23), parts = [];
    parts.push({ geo: new THREE.CylinderGeometry(0.42, 0.5, 1.2, 7).translate(0, 0.6, 0), color: '#8a7a5c' });
    const blade = new THREE.ConeGeometry(0.11, 1.6, 3, 1, true).translate(0, 0.8, 0);
    for (let i = 0; i < 70; i++) {
      const a = i * 2.4, el = -0.2 + (i / 70) * 1.5; // from drooping skirt to upright centre
      const tilt = Math.PI / 2 - el;
      parts.push({ geo: blade, matrix: M4(0, 1.3, 0, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt), color: i < 20 ? '#9a9466' : i < 45 ? '#86a06c' : '#9ab07a' });
    }
    // the flower spike: a fat bumpy column of cream-green flowers
    const spike = new THREE.CylinderGeometry(0.3, 0.55, 5.6, 10, 14, false).translate(0, 4.6, 0);
    const p = spike.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + Math.abs(noise3(x * 4, y * 3, z * 4, 5)) * 0.35;
      p.setXYZ(i, x * k, y, z * k);
    }
    parts.push({ geo: spike, color: (x, y) => lin('#bfc27c').lerp(lin('#e4dfa4'), clamp((y - 2) / 5, 0, 1)).toArray() });
    parts.push({ geo: new THREE.ConeGeometry(0.3, 0.8, 10).translate(0, 7.8, 0), color: '#d9d69a' });
    void r;
    return mergeColored(parts);
  });
}

// Yareta: a bright green cushion plant as hard as rock (and centuries old).
function yaretaGeo() {
  return geo('yareta', () => {
    const g = woolGeometry(31, 2, { lump: 0.35, curl: 0.22, curlFreq: 9, sy: 0.5 });
    return g.translate(0, 0.15, 0);
  });
}

// "Old man of the Andes" cactus (Oreocereus): woolly white columns, a bit like a llama.
function cactusGeo() {
  return geo('cactus', () => {
    const r = rng(29), parts = [];
    for (let k = 0; k < 4; k++) {
      const h = 0.8 + r() * 0.9, a = k * 1.9, d = k ? 0.32 : 0;
      const col = woolGeometry(40 + k, 2, { lump: 0.08, curl: 0.3, curlFreq: 7, sx: 0.2, sy: h / 2, sz: 0.2 });
      parts.push({ geo: col, matrix: M4(Math.cos(a) * d, h / 2, Math.sin(a) * d), color: (x, y, z) => (y > h * 0.25 ? lin('#efe9dc') : lin('#9aa577')).toArray() });
      if (k % 2 === 0) parts.push({ geo: new THREE.SphereGeometry(0.07, 6, 4), matrix: M4(Math.cos(a) * d + 0.15, h * 0.85, Math.sin(a) * d), color: '#e0344a' });
    }
    return mergeColored(parts);
  });
}

// Apacheta: a cairn travellers build up stone by stone at passes and lookouts.
function cairnGeo() {
  return geo('cairn', () => {
    const r = rng(37), parts = [];
    let y = 0;
    for (let k = 0; k < 7; k++) {
      const s = 0.55 - k * 0.06;
      parts.push({ geo: new THREE.IcosahedronGeometry(1, 0), matrix: M4((r() - 0.5) * 0.12, y + s * 0.4, (r() - 0.5) * 0.12, r(), r(), r(), s, s * 0.55, s * 0.9), color: ['#8f8577', '#a39888', '#7d7468'][k % 3] });
      y += s * 0.75;
    }
    return mergeColored(parts);
  });
}

// A dry-stone wall boulder (pirca).
function boulderGeo() { return geo('boulder', () => mergeColored([{ geo: new THREE.IcosahedronGeometry(1, 0), color: '#9c9184' }])); }

// Totora reeds: a clump of tall bright stems, green at the waterline and straw at the tips.
function reedClumpGeo() {
  return geo('reeds', () => {
    const r = rng(41), parts = [];
    const stem = new THREE.ConeGeometry(0.05, 2.6, 3, 1, true).translate(0, 1.3, 0);
    for (let i = 0; i < 16; i++) {
      const a = r() * Math.PI * 2, d = r() * 0.7, t = (r() - 0.5) * 0.35;
      parts.push({
        geo: stem, matrix: M4(Math.cos(a) * d, 0, Math.sin(a) * d, t, 0, (r() - 0.5) * 0.35, 1, 0.7 + r() * 0.6, 1),
        color: (x, y) => lin('#5f8f3a').lerp(lin('#cdbb6a'), clamp(y / 2.6, 0, 1)).toArray(),
      });
    }
    return mergeColored(parts);
  });
}

// A low-poly llama for far-off herds and the crowd on the rocks. pose 0: head up, 1: grazing.
const COATS = ['#f3ece0', '#8a5a3b', '#2f2420', '#c99a6b', '#ffffff', '#5b3a28', '#d9c3a5'];
const TASSELS = ['#d81b60', '#ff7a1a', '#1e9e8a', '#ffc928', '#7b2d8b'];
function llamaBodyParts(coat, seed, out, base = new THREE.Matrix4()) {
  const add = (g, m, c) => out.push({ geo: g, matrix: base.clone().multiply(m), color: c });
  // a fat woolly barrel on fairly short legs, with a fluffy rump and a perky tail
  add(woolGeometry(seed % 5 + 1, 2, { lump: 0.16, curl: 0.14, curlFreq: 5 }), M4(0, 1.0, 0, 0, 0, 0, 0.42, 0.4, 0.68), coat);
  add(woolGeometry(seed % 5 + 2, 1, { lump: 0.15, curl: 0.15 }), M4(0, 1.12, 0.42, 0, 0, 0, 0.3, 0.32, 0.28), coat);
  for (const [x, z] of [[0.19, 0.4], [-0.19, 0.4], [0.19, -0.42], [-0.19, -0.42]]) {
    add(new THREE.CylinderGeometry(0.075, 0.05, 0.75, 6), M4(x, 0.4, z), coat);
    add(new THREE.CylinderGeometry(0.06, 0.065, 0.07, 6), M4(x, 0.035, z), '#3a2a20');
  }
  add(woolGeometry(seed % 5 + 3, 1, { lump: 0.2, curl: 0.2 }), M4(0, 1.18, -0.66, -0.5, 0, 0, 0.11, 0.16, 0.11), coat);
}
function llamaHeadParts(coat, seed, out, base = new THREE.Matrix4()) {
  const add = (g, m, c) => out.push({ geo: g, matrix: base.clone().multiply(m), color: c });
  // long woolly neck, a rounded head with a dark muzzle, banana ears with tassels
  add(woolGeometry(seed % 5 + 4, 1, { lump: 0.1, curl: 0.18, sx: 1, sy: 1, sz: 1 }), M4(0, 0.45, 0, 0, 0, 0, 0.15, 0.55, 0.16), coat);
  add(new THREE.SphereGeometry(0.15, 10, 8), M4(0, 0.98, 0.05, 0, 0, 0, 1, 0.95, 1.2), coat);
  add(new THREE.SphereGeometry(0.1, 8, 6), M4(0, 0.94, 0.22, 0, 0, 0, 0.85, 0.8, 1.1), '#4a3428');
  for (const s of [1, -1]) {
    add(new THREE.ConeGeometry(0.045, 0.26, 5), M4(s * 0.08, 1.18, -0.02, -0.2, 0, -s * 0.25), coat);
    // ear tassels, the way herders decorate their animals
    add(new THREE.IcosahedronGeometry(0.065, 1), M4(s * 0.12, 1.3, -0.04), TASSELS[(seed + (s > 0 ? 0 : 2)) % TASSELS.length]);
    add(new THREE.SphereGeometry(0.03, 6, 4), M4(s * 0.1, 1.02, 0.14), '#151010');
  }
}
// A merged static llama (used in herds). x, y, z in world, yaw, scale.
function staticLlama(out, x, y, z, yaw, seed, coat, graze) {
  const base = M4(x, y, z, 0, yaw, 0);
  llamaBodyParts(coat, seed, out, base);
  const neck = base.clone().multiply(M4(0, 1.1, 0.45, graze ? 1.9 : 0.22, 0, 0));
  llamaHeadParts(coat, seed, out, neck);
}
// Vicuña: the wild, slender, cinnamon-and-white ancestor of the alpaca.
function staticVicuna(out, x, y, z, yaw, seed, graze) {
  const base = M4(x, y, z, 0, yaw, 0, 0.82);
  out.push({ geo: new THREE.SphereGeometry(1, 8, 6), matrix: base.clone().multiply(M4(0, 1.05, 0, 0, 0, 0, 0.27, 0.27, 0.55)), color: (xx, yy) => (yy < y + 0.98 * 0.82 ? lin('#f4efe6') : lin('#c48a52')).toArray() });
  for (const [lx, lz] of [[0.14, 0.35], [-0.14, 0.35], [0.14, -0.35], [-0.14, -0.35]]) {
    out.push({ geo: new THREE.CylinderGeometry(0.04, 0.035, 0.85, 5), matrix: base.clone().multiply(M4(lx, 0.43, lz)), color: '#c48a52' });
  }
  const neck = base.clone().multiply(M4(0, 1.12, 0.42, graze ? 1.9 : 0.3, 0, 0));
  out.push({ geo: new THREE.CylinderGeometry(0.07, 0.11, 0.8, 6), matrix: neck.clone().multiply(M4(0, 0.38, 0)), color: (xx, yy, zz) => lin('#c48a52').toArray() });
  out.push({ geo: new THREE.BoxGeometry(0.15, 0.15, 0.3), matrix: neck.clone().multiply(M4(0, 0.82, 0.08)), color: '#b98048' });
  for (const s of [1, -1]) out.push({ geo: new THREE.ConeGeometry(0.035, 0.18, 4), matrix: neck.clone().multiply(M4(s * 0.05, 0.98, 0, 0, 0, -s * 0.2)), color: '#b98048' });
  void seed;
}

// Gable roof prism: ridge along x, eaves at y=0.
function gableGeo(w, d, h, o = 0.35) {
  const W = w / 2 + o, D = d / 2 + o;
  const v = [
    // two roof slopes
    -W, 0, D, W, 0, D, W, h, 0, -W, 0, D, W, h, 0, -W, h, 0,
    W, 0, -D, -W, 0, -D, -W, h, 0, W, 0, -D, -W, h, 0, W, h, 0,
    // gable ends
    W, 0, D, W, 0, -D, W, h, 0,
    -W, 0, -D, -W, 0, D, -W, h, 0,
  ];
  const sl = Math.hypot(D, h) / 2.5, wl = (2 * W) / 2.5;
  const uv = [0, 0, wl, 0, wl, sl, 0, 0, wl, sl, 0, sl, 0, 0, wl, 0, wl, sl, 0, 0, wl, sl, 0, sl, 0, 0, 1, 0, 0.5, 0.6, 0, 0, 1, 0, 0.5, 0.6];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Totora reed boat: two fat bundles curling up into a high prow and stern.
function reedBoatGeo() {
  return geo('boat', () => {
    const curve = (dx, dy, k) => new THREE.CatmullRomCurve3([
      [0, 1.25, -3.5], [0, 0.55, -2.9], [0, 0.12, -1.7], [0, 0, 0], [0, 0.12, 1.7], [0, 0.6, 2.9], [0, 1.55, 3.55], [0, 2.0, 3.15],
    ].map(([x, y, z]) => new THREE.Vector3(x + dx, y * k + dy, z * (k > 0.9 ? 1 : 0.86))));
    const parts = [
      new THREE.TubeGeometry(curve(0.33, 0, 1), 40, 0.4, 8),
      new THREE.TubeGeometry(curve(-0.33, 0, 1), 40, 0.4, 8),
      new THREE.TubeGeometry(curve(0, 0.36, 0.85), 40, 0.28, 8),
    ];
    const g = mergeUV(parts);
    return g;
  });
}
function mergeUV(geos) {
  let n = 0;
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// Andean condor: 3m of black wing with white collar and wing patches, built to soar.
function condorMesh() {
  const g = new THREE.Group();
  const black = std('#1d1b1c', { roughness: 0.8 }), white = std('#f2efe6'), skin = std('#b85a4a');
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), black);
  body.scale.set(0.32, 0.3, 0.75);
  g.add(body);
  const ruff = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.1, 6, 12), white);
  ruff.position.set(0, 0.06, 0.62);
  g.add(ruff);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), skin);
  head.scale.set(1, 1, 1.3);
  head.position.set(0, 0.1, 0.84);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), std('#e8dcc0'));
  beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.08, 1.02);
  g.add(beak);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 4), black);
  tail.rotation.x = -Math.PI / 2; tail.scale.set(1, 1, 0.15); tail.position.set(0, 0, -0.95);
  g.add(tail);
  // wing: a long plank that ends in spread "finger" primaries, white patch on top
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.42); wingShape.lineTo(1.4, 0.38); wingShape.lineTo(2.3, 0.25);
  for (let f = 0; f < 5; f++) { const z = 0.25 - f * 0.14; wingShape.lineTo(2.85 - f * 0.08, z - 0.02); wingShape.lineTo(2.3 - f * 0.03, z - 0.09); }
  wingShape.lineTo(1.4, -0.42); wingShape.lineTo(0, -0.3); wingShape.lineTo(0, 0.42);
  const wingGeo = new THREE.ShapeGeometry(wingShape).rotateX(Math.PI / 2);
  const patch = new THREE.Shape();
  patch.moveTo(0.3, -0.05); patch.lineTo(2.0, -0.08); patch.lineTo(2.0, -0.3); patch.lineTo(0.3, -0.25);
  const patchGeo = new THREE.ShapeGeometry(patch).rotateX(Math.PI / 2).translate(0, 0.03, 0);
  const wings = [];
  for (const s of [1, -1]) {
    const piv = new THREE.Group();
    piv.position.set(s * 0.22, 0.08, 0.1);
    const w = new THREE.Mesh(wingGeo, std('#1d1b1c', { side: THREE.DoubleSide, roughness: 0.8 }));
    const p = new THREE.Mesh(patchGeo, std('#f2efe6', { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    w.scale.x = p.scale.x = s;
    piv.add(w, p);
    g.add(piv);
    wings.push(piv);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { g, wings };
}

// ---------------------------------------------------------------------------

export class Altiplano {
  // S: the course scene group. o: { lakeY, startZ, finishZ, rand, avoid: [{x, z, r}] }
  constructor(S, o) {
    this.S = S;
    this.lakeY = o.lakeY;
    this.mid = o.finishZ / 2;
    this.rand = o.rand;
    this.finishZ = o.finishZ;
    this.boats = [];
    this.condors = [];
    this.watchers = [];
    this.smoke = [];
    this.avoid = [...(o.avoid || [])]; // things already in the lake (x, z, r)
    this.trees = []; this.euc = []; this.puyas = []; this.yaretas = []; this.cacti = []; this.cairns = []; this.tussocks = []; this.reeds = []; this.boulders = [];
    this.herd = [];

    this.buildSky();
    this.buildValley();
    this.buildLake();
    this.buildRanges();
    this.buildIslands();
    this.buildStoneForest();
    this.buildShore();
    this.buildTerraces();
    this.buildVillage();
    this.buildHerds();
    this.buildBoats();
    this.buildCondors();
    this.flushInstances();
  }

  // ---- ground --------------------------------------------------------------

  // Height of the valley floor at world (x, z): just under water at the shore, rising
  // gently over the puna and then up into the foothills.
  groundY(x, z) {
    const lz = (z - this.mid) / LAKE_ZS, r = Math.hypot(x, lz);
    const shore = smoothstep((r - LAKE_RX + 2) / 6);
    const rise = smoothstep((r - 185) / 140);
    const roll = fbm3(x * 0.012, 0, lz * 0.012, 5, 3);
    return this.lakeY - 0.6 + shore * 1.1 + smoothstep((r - 160) / 40) * (2 + roll * 3) + rise * (9 + roll * 9);
  }
  shoreR(x, z) { return Math.hypot(x, (z - this.mid) / LAKE_ZS); }

  buildSky() {
    // fleecy clouds, the same wool as the llamas, sailing high in the thin air
    const cloudGeo = woolGeometry(77, 6, { lump: 0.2, curl: 0.08, curlFreq: 3 });
    const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, vertexColors: true, emissive: '#eef6ff', emissiveIntensity: 0.4 });
    const puffs = [];
    for (let i = 0; i < 34; i++) {
      const side = this.rand() < 0.5 ? -1 : 1;
      const cx = side * (40 + this.rand() * 110), cy = 30 + this.rand() * 45, cz = -80 + this.rand() * 420;
      const rot = this.rand() * Math.PI, c = Math.cos(rot), sn = Math.sin(rot);
      const n = 3 + Math.floor(this.rand() * 5);
      for (let k = 0; k < n; k++) {
        const sc = 2.5 + this.rand() * 3.5;
        const lx = k * 3.4 - n * 1.7 + this.rand(), ly = this.rand() * 2, lz = this.rand() * 2.5;
        puffs.push(new THREE.Matrix4().compose(
          new THREE.Vector3(cx + lx * c + lz * sn, cy + ly, cz - lx * sn + lz * c),
          new THREE.Quaternion().setFromAxisAngle(UP, rot),
          new THREE.Vector3(sc * 1.3, sc * 0.65, sc)));
      }
    }
    const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, puffs.length);
    puffs.forEach((m, i) => clouds.setMatrixAt(i, m));
    this.S.add(clouds);
  }

  buildValley() {
    // a polar grid: fine near the shore, coarse out in the hills
    const NT = 160, NR = 46, R0 = LAKE_RX - 12, R1 = 900;
    const pos = [], col = [], idx = [];
    const c = new THREE.Color();
    const sand = lin('#9b8763'), bog = lin('#4f8f3e'), bog2 = lin('#73ad4f'), puna = lin('#c7a95e'), puna2 = lin('#a99050'), puna3 = lin('#b8b06c'), scree = lin('#8f7a62');
    for (let j = 0; j <= NR; j++) {
      const u = j / NR, r = R0 + (R1 - R0) * u * u;
      for (let i = 0; i < NT; i++) {
        const a = (i / NT) * Math.PI * 2;
        const lx = Math.cos(a) * r, lz = Math.sin(a) * r, x = lx, z = this.mid + lz * LAKE_ZS;
        const y = this.groundY(x, z);
        pos.push(x, y, z);
        // colour: wet sand at the waterline, emerald bofedal bog behind it, then gold puna, then scree
        const n = noise3(x * 0.03, 0, z * 0.03, 3), n2 = noise3(x * 0.011, 1, z * 0.011, 8);
        if (r < LAKE_RX + 3) c.copy(sand);
        else if (r < 185 + n2 * 15) c.copy(bog).lerp(bog2, n * 0.5 + 0.5).lerp(puna, smoothstep((r - 165 - n2 * 12) / 25) * 0.7);
        else c.copy(puna).lerp(puna2, n * 0.5 + 0.5).lerp(puna3, Math.max(0, n2) * 0.8);
        c.lerp(scree, smoothstep((r - 300) / 200) * 0.6);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < NR; j++) for (let i = 0; i < NT; i++) {
      const a = j * NT + i, b = j * NT + ((i + 1) % NT), cc = a + NT, d = b + NT;
      idx.push(a, b, cc, b, d, cc);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, std('#ffffff', { vertexColors: true, roughness: 1 }));
    m.receiveShadow = true;
    this.S.add(m);
  }

  buildLake() {
    // deep cobalt in the middle, shading to turquoise over the shallows
    const g = new THREE.CircleGeometry(LAKE_RX + 10, 72, 0, Math.PI * 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    const deep = lin('#1a4f92'), shallow = lin('#3aa3b4');
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i)) / (LAKE_RX + 10);
      const c = deep.clone().lerp(shallow, smoothstep((r - 0.55) / 0.45));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const nm = waterNormalMap();
    nm.repeat.set(30, 30);
    const sea = new THREE.Mesh(g, std('#ffffff', {
      vertexColors: true, roughness: 0.1, metalness: 0.15, emissive: '#0a2c55', emissiveIntensity: 0.3,
      normalMap: nm, normalScale: new THREE.Vector2(0.35, 0.35),
    }));
    sea.rotation.x = -Math.PI / 2;
    sea.scale.set(1, LAKE_ZS, 1);
    sea.position.set(0, this.lakeY, this.mid);
    sea.receiveShadow = true;
    this.S.add(sea);
    this.sea = sea;
  }

  // ---- far away -----------------------------------------------------------

  buildRanges() {
    const r = rng(3), mid = this.mid;
    const geos = [];
    const snowC = lin('#f6f9ff'), rockA = lin('#86767c'), rockB = lin('#9c7f6c'), rust = lin('#a8644a'), punaC = lin('#caa552'), green = lin('#8fa451');
    // a jagged peak, coloured by height: puna, warm rock streaked with iron oxide, snow
    const peak = (x, z, rad, hgt, snowLine, seg = 9) => {
      const g = new THREE.ConeGeometry(rad, hgt, seg, seg > 9 ? 6 : 7).toNonIndexed();
      const p = g.attributes.position, col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        let px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
        const u = (py + hgt / 2) / hgt;
        if (u < 0.99) {
          const n = noise3(px * 0.02 + x, py * 0.03, pz * 0.02 + z, 3);
          const ridge = 1 - Math.abs(noise3(px * 0.05 + x, py * 0.05, pz * 0.05, 4));
          px *= 1 + n * 0.27 + ridge * 0.08; pz *= 1 + n * 0.27 + ridge * 0.08; py += n * hgt * 0.05;
        }
        p.setXYZ(i, px + x, py + hgt / 2 - 30, pz + z);
        const sn = u > snowLine + noise3(px * 0.05, pz * 0.05, 1, 3) * 0.1;
        const c = sn ? snowC : u < 0.22 ? punaC.clone().lerp(green, 0.3) : u < 0.42 ? punaC.clone().lerp(rockB, (u - 0.22) * 4) : (noise3(px * 0.04, py * 0.04, pz * 0.04, 7) > 0.2 ? rust : u > 0.6 ? rockA : rockB);
        col.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geos.push(g);
    };
    // the cordillera, far off and blued by distance
    for (let i = 0; i < 38; i++) {
      const a = (i / 38) * Math.PI * 2 + r() * 0.15;
      const k = 1 + r() * 0.4, big = r();
      peak(Math.cos(a) * 400 * k, mid + Math.sin(a) * 520 * k, 80 + big * 80, 130 + big * 170, 0.5 + r() * 0.12);
    }
    // low, rounded golden foothills closer in
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + r() * 0.2;
      const k = 1 + r() * 0.25;
      peak(Math.cos(a) * 290 * k, mid + Math.sin(a) * 370 * k, 55 + r() * 30, 34 + r() * 26, 2, 14);
    }
    const merged = mergeGeos(geos);
    merged.computeVertexNormals();
    this.S.add(new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })));

    // two great snow-capped volcanoes, smooth and symmetric, one beyond the finish
    this.volcano(-170, mid + 540, 260, 360);
    this.volcano(380, mid - 120, 200, 270);
    // and the rainbow mountain: mineral stripes of maroon, ochre, mustard, teal and lavender
    this.rainbowMountain(250, mid + 200, 1);
    this.rainbowMountain(-265, mid - 190, 2);
  }

  volcano(x, z, R, H) {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24, y = u * H;
      // concave flanks and a little crater rim
      const rr = u < 0.96 ? R * Math.pow(1 - u, 1.6) + R * 0.05 : R * 0.05 + (1 - u) * 6;
      pts.push(new THREE.Vector2(rr, y));
    }
    pts.push(new THREE.Vector2(R * 0.03, H - 4));
    const g = new THREE.LatheGeometry(pts, 64);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    const snowC = lin('#f7faff'), ash = lin('#6f5f58'), dark = lin('#56463f'), puna = lin('#b39c5c');
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), u = py / H;
      const ang = Math.atan2(pz, px);
      // snow reaches down in long gullies
      const gully = Math.pow(Math.abs(Math.sin(ang * 9 + noise3(px * 0.02, 0, pz * 0.02, 2) * 2)), 3) * 0.12;
      const k = 1 + noise3(px * 0.03, py * 0.03, pz * 0.03, 9) * 0.04 * (1 - u);
      p.setXYZ(i, px * k + x, py - 30, pz * k + z);
      const c = u > 0.6 - gully + noise3(ang * 3, 0, 0, 4) * 0.04 ? snowC : u < 0.18 ? puna.clone().lerp(ash, u / 0.18) : (Math.sin(ang * 23) > 0.6 ? dark : ash);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.S.add(new THREE.Mesh(g, std('#ffffff', { vertexColors: true, roughness: 1 })));
  }

  rainbowMountain(x, z, seed) {
    const bands = ['#7d3530', '#b8553a', '#d9a441', '#ecd185', '#6aa391', '#a3849a', '#c86b4a', '#8e4a3a', '#e3c25c', '#5f9a86'].map(lin);
    const g = new THREE.ConeGeometry(70, 95, 26, 14).toNonIndexed();
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let f = 0; f < p.count; f += 3) {
      // colour by face so the stripes stay crisp on a faceted hill
      let cy = 0;
      for (let k = 0; k < 3; k++) cy += p.getY(f + k) / 3;
      for (let k = 0; k < 3; k++) {
        const i = f + k;
        let px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
        const u = (py + 47.5) / 95;
        if (u < 0.99) {
          const n = noise3(px * 0.03, py * 0.03, pz * 0.03, seed + 20);
          // ridged: knife-edge spurs running down from the summit
          const ridge = Math.abs(Math.sin(Math.atan2(pz, px) * 5 + n));
          px *= 1 + n * 0.2 + ridge * 0.22; pz *= 1 + n * 0.2 + ridge * 0.22;
        }
        // stretch it into a long ridge and turn it, about its own spot
        const rx = px * 0.75, rz = pz * 1.5, ca = Math.cos(seed * 0.6), sa = Math.sin(seed * 0.6);
        p.setXYZ(i, rx * ca + rz * sa + x, py + 47.5 - 30, -rx * sa + rz * ca + z);
      }
      const warp = noise3(p.getX(f) * 0.02, 0, p.getZ(f) * 0.02, seed) * 6;
      const b = bands[Math.abs(Math.floor((cy + warp + 60) / 7.5)) % bands.length];
      for (let k = 0; k < 3; k++) col.set([b.r, b.g, b.b], (f + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.S.add(new THREE.Mesh(g, std('#ffffff', { vertexColors: true, roughness: 1, flatShading: true })));
  }

  // ---- the lake ------------------------------------------------------------

  free(x, z, r) {
    return this.avoid.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + r);
  }

  // Floating reed islands, Uros style: thick mats of totora with reed huts on top.
  buildIslands() {
    const reedM = std('#ffffff', { map: rep(reedTex(), 2, 1), roughness: 1 });
    const reedTop = std('#ffffff', { map: rep(reedTex(), 5, 5), roughness: 1 });
    const thatchM = std('#ffffff', { map: rep(thatchTex(), 1, 1), roughness: 1 });
    const spots = [[-78, this.mid + 40], [86, this.mid + 115], [70, this.mid - 70], [-92, this.mid - 110]];
    for (const [x, z] of spots) {
      const R = 8 + this.rand() * 3;
      if (!this.free(x, z, R + 2)) continue;
      this.avoid.push({ x, z, r: R + 2 });
      const g = new THREE.Group();
      g.position.set(x, this.lakeY, z);
      const mat = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.06, 1.2, 28), [reedM, reedTop, reedM]));
      mat.position.y = 0.25;
      g.add(mat);
      const nh = 2 + Math.floor(this.rand() * 3);
      for (let k = 0; k < nh; k++) {
        const a = (k / nh) * Math.PI * 2 + this.rand(), d = R * 0.5;
        const hut = new THREE.Group();
        hut.position.set(Math.cos(a) * d, 0.85, Math.sin(a) * d);
        hut.rotation.y = -a + Math.PI / 2;
        const w = 2.4 + this.rand() * 0.8, dd = 2, hh = 1.7;
        const walls = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, hh, dd), reedM));
        walls.position.y = hh / 2;
        hut.add(walls);
        const roof = shadowed(new THREE.Mesh(gableGeo(w, dd, 1.3, 0.3), thatchM));
        roof.position.y = hh;
        hut.add(roof);
        const door = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.2), std('#2a1e14'));
        door.position.set(0, 0.6, dd / 2 + 0.01);
        hut.add(door);
        // a woven blanket drying on the wall
        if (k === 0) {
          const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9), std('#ffffff', { map: aguayoTex(1 + (k % 3)), side: THREE.DoubleSide }));
          cloth.position.set(w * 0.25, 0.9, dd / 2 + 0.02);
          hut.add(cloth);
        }
        g.add(hut);
      }
      // a reed lookout tower
      const tower = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const leg = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 4.5, 6), reedM));
        leg.position.set(Math.cos(a) * 0.75, 2.25, Math.sin(a) * 0.75);
        leg.rotation.set(Math.sin(a) * 0.1, 0, -Math.cos(a) * 0.1);
        tower.add(leg);
      }
      const deck = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.25, 10), reedM));
      deck.position.y = 4.4;
      tower.add(deck);
      const cap = shadowed(new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.2, 10), thatchM));
      cap.position.y = 5.6;
      tower.add(cap);
      tower.position.set(R * 0.15, 0.85, -R * 0.2);
      g.add(tower);
      // reeds fringing the mat
      for (let k = 0; k < 14; k++) {
        const a = this.rand() * Math.PI * 2;
        this.reeds.push({ x: x + Math.cos(a) * (R + 0.6), y: this.lakeY - 0.3, z: z + Math.sin(a) * (R + 0.6), s: 0.7 + this.rand() * 0.4, ry: this.rand() * 6 });
      }
      this.S.add(g);
      this.boats.push(this.makeBoat(x + R + 2.5, z + 2, 0.4, true));
    }
  }

  // Towers of the stone forest standing in the lake, topped with turf, gnarled queñua
  // trees, a puya or two, and llamas who have climbed up for a better view of the race.
  buildStoneForest() {
    const stackMat = std('#ffffff', { map: rep(stoneTex(), 3, 5), roughness: 1, vertexColors: true });
    const turfMat = std('#ffffff', { map: rep(grassTex(), 3, 3), roughness: 1 });
    const lipMat = std('#7e9a45', { roughness: 1 });
    const capRock = std('#e8dccb', { map: rep(stoneTex(), 2, 2), roughness: 1 });
    const stacks = [];
    for (let i = 0, tries = 0; i < 18 && tries < 300; tries++) {
      const side = i % 2 ? -1 : 1;
      const r = 5 + this.rand() * 9, top = -12 + this.rand() * 22;
      const x = side * (16 + r + this.rand() * 70), z = -50 + this.rand() * (this.finishZ + 110);
      if (this.shoreR(x, z) > LAKE_RX - r - 6) continue;
      if (!this.free(x, z, r + 4)) continue;
      this.avoid.push({ x, z, r });
      stacks.push({ x, z, r, top });
      i++;
      const col = shadowed(new THREE.Mesh(rockColumn(r, top - this.lakeY + 2, 77 + i), stackMat));
      col.position.set(x, (top + this.lakeY) / 2 - 1, z);
      this.S.add(col);
      // reeds crowd around the foot of each tower
      for (let k = 0; k < 6 + r; k++) {
        const a = this.rand() * Math.PI * 2;
        this.reeds.push({ x: x + Math.cos(a) * (r * 0.62 + 0.8), y: this.lakeY - 0.4, z: z + Math.sin(a) * (r * 0.62 + 0.8), s: 0.6 + this.rand() * 0.5, ry: this.rand() * 6 });
      }
      const bare = i % 4 === 3;
      if (bare) {
        // a weathered mushroom-shaped cap of harder rock, with a cairn on it
        const cap = shadowed(new THREE.Mesh(boulderCapGeo(), capRock));
        cap.scale.set(r * 1.02, r * 0.5, r * 0.96);
        cap.position.set(x, top + r * 0.1, z);
        this.S.add(cap);
        this.cairns.push({ x, y: top + r * 0.55, z, s: 1.4, ry: this.rand() * 6 });
        if (this.rand() < 0.6) this.perch = this.perch || { x: x + r * 0.35, y: top + r * 0.5, z };
        continue;
      }
      const cap = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.9, 0.6, 24), [lipMat, turfMat, lipMat]));
      cap.position.set(x, top, z);
      this.S.add(cap);
      const ty = top + 0.3;
      const scatter = (n, rmax, fn) => {
        for (let k = 0; k < n; k++) {
          const a = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * r * rmax;
          fn(x + Math.cos(a) * d, z + Math.sin(a) * d, a);
        }
      };
      scatter(Math.floor(r * 0.5), 0.72, (px, pz) => this.trees.push({ x: px, y: ty, z: pz, s: 0.9 + this.rand() * 0.7, ry: this.rand() * 6, tint: hsl(0.08 + this.rand() * 0.04, 0.2, 0.85 + this.rand() * 0.15) }));
      scatter(Math.floor(r * 2.2), 0.85, (px, pz) => this.tussocks.push([px, ty, pz]));
      scatter(2, 0.8, (px, pz) => this.yaretas.push({ x: px, y: ty - 0.1, z: pz, s: 0.6 + this.rand() * 0.6, ry: this.rand() * 6 }));
      if (this.rand() < 0.45) scatter(1, 0.5, (px, pz) => this.puyas.push({ x: px, y: ty, z: pz, s: 0.55 + this.rand() * 0.35, ry: this.rand() * 6 }));
      if (this.rand() < 0.4) scatter(1, 0.7, (px, pz) => this.cacti.push({ x: px, y: ty, z: pz, s: 0.9 + this.rand() * 0.5, ry: this.rand() * 6 }));
      if (this.rand() < 0.35) scatter(1, 0.75, (px, pz) => this.cairns.push({ x: px, y: ty, z: pz, s: 0.8, ry: this.rand() * 6 }));
      // spectators: llamas on the bigger towers, facing the course
      if (r > 7) {
        const n = 1 + Math.floor(this.rand() * 3);
        for (let k = 0; k < n; k++) {
          const dx = -Math.sign(x) * r * (0.35 + this.rand() * 0.3), dz = (this.rand() - 0.5) * r * 0.8;
          this.addWatcher(x + dx, ty, z + dz);
        }
      }
    }
    // little pinnacles in between, for a forest of stone rather than a few lone towers
    for (let i = 0, tries = 0; i < 26 && tries < 300; tries++) {
      const side = this.rand() < 0.5 ? -1 : 1;
      const r = 1.2 + this.rand() * 2.5, top = this.lakeY + 4 + this.rand() * 20;
      const x = side * (13 + this.rand() * 95), z = -60 + this.rand() * (this.finishZ + 130);
      if (this.shoreR(x, z) > LAKE_RX - 8) continue;
      if (!this.free(x, z, r + 2)) continue;
      this.avoid.push({ x, z, r });
      i++;
      const col = shadowed(new THREE.Mesh(rockColumn(r, top - this.lakeY + 2, 300 + i), stackMat));
      col.position.set(x, (top + this.lakeY) / 2 - 1, z);
      this.S.add(col);
      // crowned with a rounded, weathered boulder, sometimes balanced at a jaunty angle
      const tip = shadowed(new THREE.Mesh(boulderCapGeo(), capRock));
      const big = this.rand() < 0.35;
      tip.scale.set(r * (big ? 1.25 : 1.0), r * (big ? 0.9 : 0.55), r * (big ? 1.1 : 0.95));
      tip.position.set(x, top + r * (big ? 0.75 : 0.25), z);
      tip.rotation.set((this.rand() - 0.5) * (big ? 0.5 : 0.15), this.rand() * 6, (this.rand() - 0.5) * (big ? 0.5 : 0.15));
      this.S.add(tip);
      for (let k = 0; k < 4; k++) {
        const a = this.rand() * Math.PI * 2;
        this.reeds.push({ x: x + Math.cos(a) * (r * 0.62 + 0.6), y: this.lakeY - 0.4, z: z + Math.sin(a) * (r * 0.62 + 0.6), s: 0.5 + this.rand() * 0.4, ry: this.rand() * 6 });
      }
    }
    this.stacks = stacks;
  }

  // Reed beds and a fringe of life along the shore.
  buildShore() {
    for (let i = 0; i < 520; i++) {
      const a = this.rand() * Math.PI * 2, d = LAKE_RX - 9 + this.rand() * 9;
      if (noise3(Math.cos(a) * 3, Math.sin(a) * 3, 0, 12) < -0.15) continue; // gaps between the beds
      const x = Math.cos(a) * d, z = this.mid + Math.sin(a) * d * LAKE_ZS;
      if (!this.free(x, z, 0.5)) continue;
      this.reeds.push({ x, y: this.lakeY - 0.3, z, s: 0.8 + this.rand() * 0.6, ry: this.rand() * 6 });
    }
    // tussocks, yareta and cairns on the puna near the water
    for (let i = 0; i < 520; i++) {
      const a = this.rand() * Math.PI * 2, d = LAKE_RX + 6 + this.rand() * 70;
      const x = Math.cos(a) * d, z = this.mid + Math.sin(a) * d * LAKE_ZS;
      this.tussocks.push([x, this.groundY(x, z) - 0.05, z]);
    }
    for (let i = 0; i < 30; i++) {
      const a = this.rand() * Math.PI * 2, d = LAKE_RX + 8 + this.rand() * 60;
      const x = Math.cos(a) * d, z = this.mid + Math.sin(a) * d * LAKE_ZS;
      this.yaretas.push({ x, y: this.groundY(x, z) - 0.2, z, s: 1 + this.rand() * 1.5, ry: this.rand() * 6 });
    }
    for (let i = 0; i < 8; i++) {
      const a = this.rand() * Math.PI * 2, d = LAKE_RX + 15 + this.rand() * 60;
      const x = Math.cos(a) * d, z = this.mid + Math.sin(a) * d * LAKE_ZS;
      this.puyas.push({ x, y: this.groundY(x, z) - 0.2, z, s: 1 + this.rand() * 0.4, ry: this.rand() * 6 });
    }
    // queñua woods climbing the rocky slopes
    for (let i = 0; i < 160; i++) {
      const a = this.rand() * Math.PI * 2, d = 215 + this.rand() * 70;
      if (noise3(Math.cos(a) * 2.5, Math.sin(a) * 2.5, 0, 31) < 0.05) continue;
      const x = Math.cos(a) * d, z = this.mid + Math.sin(a) * d * LAKE_ZS;
      this.trees.push({ x, y: this.groundY(x, z) - 0.3, z, s: 1.6 + this.rand() * 1.4, ry: this.rand() * 6, tint: hsl(0.08, 0.2, 0.8 + this.rand() * 0.2) });
    }
    // pirca: dry-stone walls wandering over the puna between the fields
    for (let w = 0; w < 7; w++) {
      const a0 = this.rand() * Math.PI * 2, d0 = LAKE_RX + 14 + this.rand() * 40;
      let a = a0, d = d0;
      const len = 30 + this.rand() * 40;
      for (let k = 0; k < len; k++) {
        a += (0.8 / d) * (w % 2 ? 1 : -1); d += (this.rand() - 0.45) * 0.6;
        const x = Math.cos(a) * d, z = this.mid + Math.sin(a) * d * LAKE_ZS;
        this.boulders.push({ x, y: this.groundY(x, z) + 0.15, z, s: 0.45 + this.rand() * 0.2, sy: 0.7, ry: this.rand() * 6 });
        if (k % 2) this.boulders.push({ x: x + (this.rand() - 0.5) * 0.3, y: this.groundY(x, z) + 0.65, z: z + (this.rand() - 0.5) * 0.3, s: 0.35, sy: 0.7, ry: this.rand() * 6 });
      }
    }
  }

  // Inca agricultural terraces stepping up two hillsides, striped with quinoa (red, orange
  // and gold), potatoes and fallow, with a little ruin on top.
  buildTerraces() {
    const crops = ['#b8432f', '#5f8f3a', '#e08a2c', '#d9b44a', '#8e5a3c', '#a33a52', '#6f9a3e'];
    const rows = cropRowsTex();
    const hills = [[-210, this.mid + 55, 44, 12], [215, this.mid - 40, 38, 11], [-60, this.mid + 365, 50, 13]];
    for (const [x, z, R0, n] of hills) {
      // the steps climb away from the lake: each tier is nudged uphill, so the lakeward face
      // is a long staircase of stone-walled fields and the back blends into the slope
      const ox = x, oz = (z - this.mid) / LAKE_ZS, ol = Math.hypot(ox, oz);
      const ux = ox / ol, uz = (oz / ol) * LAKE_ZS;
      const base = this.groundY(x, z) - 2.5;
      const rise = 2.1;
      for (let i = 0; i < n; i++) {
        const R = R0 * (1 - (i / n) * 0.78);
        const cx = x + ux * i * R0 * 0.045, cz = z + uz * i * R0 * 0.045;
        const top = base + (i + 1) * rise;
        const h = top - (base - 6 - i * 0.37); // bottoms staggered so no two caps share a plane
        const cropMat = std(crops[(i * 5 + Math.abs(Math.floor(x))) % crops.length], { map: rows, roughness: 1 });
        const wall = std('#d9cbb6', { map: rep(stoneTex(), Math.round(R * 0.5), 0.6), roughness: 1 });
        const tier = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.5, h, 40), [wall, cropMat, wall]), false, true);
        tier.position.set(cx, top - h / 2, cz);
        tier.scale.set(1, 1, 1.25);
        tier.rotation.y = Math.atan2(ux, uz);
        this.S.add(tier);
      }
      // a little ruined lookout on the top terrace, and a cairn
      const summit = base + n * rise;
      const sx = x + ux * n * R0 * 0.045, sz = z + uz * n * R0 * 0.045;
      const ruinM = std('#ffffff', { map: rep(ashlarTex(), 1, 1) });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const w = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4 + k * 0.6, 0.5), ruinM));
        w.position.set(sx + Math.cos(a) * 2, summit + 0.6 + k * 0.3, sz + Math.sin(a) * 2);
        w.rotation.y = -a + Math.PI / 2;
        this.S.add(w);
      }
      this.cairns.push({ x: sx + 3.5, y: summit, z: sz, s: 1.6, ry: 0 });
    }
  }

  // A herders' hamlet of adobe houses with thatched roofs, by the shore among eucalyptus.
  buildVillage() {
    const adobeM = std('#ffffff', { map: rep(adobeTex(), 1, 1), roughness: 1 });
    const thatchM = std('#ffffff', { map: rep(thatchTex(), 1, 1), roughness: 1 });
    const tileM = std('#b5533a', { roughness: 0.9 });
    const doors = ['#2f6db5', '#2a1e14', '#1e9e8a', '#2a1e14'];
    const villages = [[-170, this.mid + 150], [172, this.mid + 60]];
    const houses = [];
    for (const [vx, vz] of villages) {
      const n = 9;
      let smoked = false;
      for (let k = 0; k < n; k++) {
        const x = vx + (this.rand() - 0.5) * 34, z = vz + (this.rand() - 0.5) * 30;
        if (this.shoreR(x, z) < LAKE_RX + 6) continue;
        if (houses.some((h) => Math.hypot(h.x - x, h.z - z) < 8)) continue; // room to walk between them
        houses.push({ x, z });
        const y = this.groundY(x, z);
        const g = new THREE.Group();
        g.position.set(x, y - 0.2, z);
        // face the lake
        g.rotation.y = Math.atan2(-x, -(z - this.mid)) + (this.rand() - 0.5) * 0.6;
        const w = 4 + this.rand() * 2.5, d = 3.2 + this.rand() * 1.2, h = 2.4;
        const walls = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h + 0.6, d), adobeM));
        walls.position.y = (h + 0.6) / 2 - 0.4;
        g.add(walls);
        const roof = shadowed(new THREE.Mesh(gableGeo(w, d, 1.6, 0.4), k % 3 === 2 ? tileM : thatchM));
        roof.position.y = h;
        roof.rotation.y = Math.PI / 2 * (k % 2);
        if (k % 2) roof.scale.set(d / w, 1, w / d); // ridge along the long side either way
        g.add(roof);
        const door = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.6), std(doors[k % doors.length]));
        door.position.set(-w * 0.2, 0.8 - 0.2, d / 2 + 0.01);
        g.add(door);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.5), std('#2a1e14'));
        win.position.set(w * 0.22, 1.4, d / 2 + 0.01);
        g.add(win);
        this.S.add(g);
        // one house in each hamlet has a fire going
        if (!smoked) { this.smokeAt(x + 0.5, y + h + 1.2, z); smoked = true; }
      }
      // eucalyptus windbreak behind the houses
      for (let k = 0; k < 14; k++) {
        const a = Math.atan2((vz - this.mid) / LAKE_ZS, vx) + (this.rand() - 0.5) * 0.3;
        const d = Math.hypot(vx, (vz - this.mid) / LAKE_ZS) + 22 + this.rand() * 10;
        const x = Math.cos(a) * d, z = this.mid + Math.sin(a) * d * LAKE_ZS;
        this.euc.push({ x, y: this.groundY(x, z) - 0.3, z, s: 1 + this.rand() * 0.5, ry: this.rand() * 6 });
      }
    }
    // round stone corrals beside the hamlets, with the herds inside
    this.corral(-158, this.mid + 112);
    this.corral(190, this.mid + 95);
  }

  corral(cx, cz) {
    const R = 9;
    for (let k = 0; k < 70; k++) {
      const a = (k / 70) * Math.PI * 2;
      if (a > 0.2 && a < 0.55) continue; // the gate
      const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R;
      const y = this.groundY(x, z);
      this.boulders.push({ x, y: y + 0.25, z, s: 0.55 + this.rand() * 0.15, sy: 0.75, ry: this.rand() * 6 });
      this.boulders.push({ x, y: y + 0.9, z, s: 0.45, sy: 0.7, ry: this.rand() * 6 });
    }
    for (let k = 0; k < 7; k++) {
      const a = this.rand() * Math.PI * 2, d = this.rand() * R * 0.7;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      staticLlama(this.herd, x, this.groundY(x, z) - 0.05, z, this.rand() * 6, k + 3, COATS[k % COATS.length], this.rand() < 0.4);
    }
  }

  // Llamas and alpacas grazing out on the puna, and a band of wild vicuñas.
  buildHerds() {
    const herds = [[-172, this.mid - 40, 'llama'], [165, this.mid + 150, 'llama'], [180, this.mid - 150, 'vicuna'], [-175, this.mid - 160, 'vicuna'], [40, this.mid + 330, 'llama']];
    for (const [hx, hz, kind] of herds) {
      for (let k = 0; k < 9; k++) {
        const x = hx + (this.rand() - 0.5) * 22, z = hz + (this.rand() - 0.5) * 22;
        if (this.shoreR(x, z) < LAKE_RX + 3) continue;
        const y = this.groundY(x, z) - 0.05, yaw = this.rand() * 6, graze = this.rand() < 0.6;
        if (kind === 'vicuna') staticVicuna(this.herd, x, y, z, yaw, k, graze);
        else staticLlama(this.herd, x, y, z, yaw, k + 11, COATS[(k * 3) % COATS.length], graze);
      }
    }
  }

  // ---- animated life ------------------------------------------------------

  addWatcher(x, y, z) {
    if (this.watchers.some((w) => Math.hypot(w.g.position.x - x, w.g.position.z - z) < 2)) return; // no stacking llamas
    const seed = this.watchers.length * 7 + 5;
    const coat = COATS[seed % COATS.length];
    const mat = std('#ffffff', { vertexColors: true, roughness: 1 });
    const bodyParts = [], headParts = [];
    llamaBodyParts(coat, seed, bodyParts);
    llamaHeadParts(coat, seed, headParts);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = Math.atan2(-x, 0) + (this.rand() - 0.5) * 0.8;
    const body = shadowed(new THREE.Mesh(mergeColored(bodyParts, true), mat), true, false);
    const neck = new THREE.Group();
    neck.position.set(0, 1.12, 0.42);
    neck.rotation.order = 'YXZ';
    neck.add(shadowed(new THREE.Mesh(mergeColored(headParts, true), mat), true, false));
    g.add(body, neck);
    this.S.add(g);
    this.watchers.push({ g, neck, pitch: 0.2, yaw: 0, t: this.rand() * 4, graze: this.rand() < 0.5, ph: this.rand() * 6 });
  }

  smokeAt(x, y, z) {
    const geo = woolGeometry(9, 2, { lump: 0.25, curl: 0.1 });
    const mat = new THREE.MeshStandardMaterial({ color: '#e8e4dc', vertexColors: true, roughness: 1, transparent: true, opacity: 0.7, depthWrite: false });
    for (let k = 0; k < 6; k++) {
      const m = new THREE.Mesh(geo, mat);
      this.S.add(m);
      this.smoke.push({ m, x, y, z, ph: k / 6 });
    }
  }

  makeBoat(x, z, yaw, moored = false) {
    const g = new THREE.Group();
    const hull = shadowed(new THREE.Mesh(reedBoatGeo(), std('#ffffff', { map: rep(reedTex(), 3, 2), roughness: 1 })));
    g.add(hull);
    // lashings around the bundles
    for (const bz of [-2.6, -1.2, 0, 1.2, 2.6]) {
      const lash = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 4, 12), std('#6b4a2e'));
      lash.position.set(0, 0.2 + Math.abs(bz) * 0.06, bz);
      lash.scale.set(1.2, 0.9, 1);
      g.add(lash);
    }
    if (!moored) {
      // a reed-mat sail on a bipod mast
      const mastM = std('#8a6141');
      for (const s of [1, -1]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.2, 5), mastM);
        m.position.set(s * 0.35, 2.4, 0.3);
        m.rotation.z = s * 0.1;
        g.add(m);
      }
      const sail = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.6, 1, 4), std('#ffffff', { map: rep(reedTex(), 1, 2), side: THREE.DoubleSide })));
      sail.position.set(0, 2.9, 0.2);
      sail.rotation.z = Math.PI / 2;
      sail.rotation.set(0, 0, 0);
      const sp = sail.geometry.attributes.position;
      for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.cos(sp.getY(i) * 1.1) * 0.25); // billowing
      sail.geometry.computeVertexNormals();
      g.add(sail);
    }
    g.position.set(x, this.lakeY, z);
    g.rotation.y = yaw;
    this.S.add(g);
    return { g, x, z, yaw, ph: this.rand() * 6, moored, drift: (this.rand() - 0.5) * 0.02 };
  }

  buildBoats() {
    for (let i = 0, tries = 0; i < 6 && tries < 80; tries++) {
      const side = this.rand() < 0.5 ? -1 : 1;
      const x = side * (22 + this.rand() * 50), z = 10 + this.rand() * (this.finishZ - 20);
      if (!this.free(x, z, 6)) continue;
      this.avoid.push({ x, z, r: 4 });
      this.boats.push(this.makeBoat(x, z, this.rand() * 6));
      i++;
    }
  }

  buildCondors() {
    for (let i = 0; i < 5; i++) {
      const { g, wings } = condorMesh();
      const s = 1.5;
      g.scale.setScalar(s);
      this.S.add(g);
      const low = i < 3;
      this.condors.push({
        g, wings,
        cx: (i % 2 ? -1 : 1) * (low ? 26 + this.rand() * 20 : this.rand() * 30),
        cz: 30 + (i / 5) * this.finishZ + this.rand() * 20,
        cy: low ? 16 + this.rand() * 8 : 34 + this.rand() * 16,
        R: 16 + this.rand() * 22, w: (0.12 + this.rand() * 0.08) * (this.rand() < 0.5 ? 1 : -1), ph: this.rand() * 6,
        flap: 0,
      });
    }
    // and one perched on a bare rock, surveying
    if (this.perch) {
      const { g, wings } = condorMesh();
      g.scale.setScalar(1.4);
      g.position.set(this.perch.x, this.perch.y + 0.3, this.perch.z);
      g.rotation.y = Math.atan2(-this.perch.x, 0);
      wings.forEach((w, k) => { w.rotation.z = (k ? 1 : -1) * 1.3; w.rotation.y = (k ? -1 : 1) * 1.2; w.scale.setScalar(0.55); });
      g.children[0].scale.set(0.32, 0.36, 0.6);
      g.rotation.x = -0.5;
      this.S.add(g);
    }
  }

  flushInstances() {
    const S = this.S;
    const vc = std('#ffffff', { vertexColors: true, roughness: 1, flatShading: true });
    // Instanced meshes can't be culled one instance at a time, so anything in the shadow pass
    // is drawn in full every frame: only the plants near the course cast shadows.
    const near = (o) => Math.abs(o.x) < 45 && o.z > -40 && o.z < this.finishZ + 40;
    const split = (geoF, mat, list, opts = {}) => {
      instances(S, geoF, mat, list.filter(near), { cast: opts.cast ?? true, receive: opts.receive });
      instances(S, geoF, mat, list.filter((o) => !near(o)), { cast: false, receive: opts.receive });
    };
    split(quenuaGeo(), vc, this.trees);
    split(puyaGeo(), vc, this.puyas);
    split(cactusGeo(), std('#ffffff', { vertexColors: true, roughness: 1 }), this.cacti);
    split(cairnGeo(), vc, this.cairns);
    instances(S, eucalyptusGeo(), vc, this.euc, { cast: false });
    instances(S, yaretaGeo(), std('#86b83e', { vertexColors: true, roughness: 1 }), this.yaretas, { cast: false, receive: true });
    instances(S, boulderGeo(), vc, this.boulders, { cast: false, receive: true });
    instances(S, reedClumpGeo(), vc, this.reeds, { cast: false });
    ichuTussocks(S, this.tussocks, 1.3);
    if (this.herd.length) S.add(new THREE.Mesh(mergeColored(this.herd), vc));
  }

  // ---- per frame ----------------------------------------------------------

  update(t, dt, player) {
    this.sea.material.normalMap.offset.set(t * 0.012, t * 0.007);
    for (const b of this.boats) {
      b.g.position.y = this.lakeY + 0.05 + Math.sin(t * 1.1 + b.ph) * 0.08;
      b.g.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.04;
      b.g.rotation.x = Math.sin(t * 0.7 + b.ph * 2) * 0.025;
      if (!b.moored) b.g.rotation.y = b.yaw + Math.sin(t * 0.05 + b.ph) * 0.3;
    }
    for (const c of this.condors) {
      // circle on a thermal, banking into the turn, with an occasional lazy flap
      const a = c.ph + t * c.w;
      c.g.position.set(c.cx + Math.cos(a) * c.R, c.cy + Math.sin(t * 0.21 + c.ph) * 2.5, c.cz + Math.sin(a) * c.R);
      // heading along the circle, rolled into the turn
      c.g.rotation.set(0, -a + (c.w < 0 ? Math.PI : 0), Math.sign(c.w) * 0.35, 'YXZ');
      const f = (t * 0.13 + c.ph) % 1;
      const flap = f < 0.12 ? Math.sin((f / 0.12) * Math.PI * 2) * 0.5 : 0;
      c.wings[0].rotation.z = -(0.1 + flap);
      c.wings[1].rotation.z = 0.1 + flap;
    }
    for (const s of this.smoke) {
      const u = (t * 0.12 + s.ph) % 1;
      s.m.position.set(s.x + u * 3 + Math.sin(u * 6 + s.ph * 9) * 0.4, s.y + u * 9, s.z + u * 1.5);
      s.m.scale.setScalar(0.3 + u * 1.4);
      s.m.material.opacity = 0.55 * (1 - u);
    }
    // watchers: graze, look up, and follow the player with their eyes when close
    const px = player?.pos.x ?? 0, pz = player?.pos.z ?? 0, py = player?.pos.y ?? 0;
    for (const w of this.watchers) {
      w.t -= dt;
      const d = Math.hypot(px - w.g.position.x, pz - w.g.position.z);
      if (w.t < 0) { w.t = 2 + Math.random() * 5; w.graze = d > 30 && Math.random() < 0.5; }
      let yawT = 0, pitchT = w.graze ? 1.9 : 0.2 + Math.sin(t * 0.8 + w.ph) * 0.06;
      if (!w.graze && d < 45) {
        const a = Math.atan2(px - w.g.position.x, pz - w.g.position.z) - w.g.rotation.y;
        yawT = clamp(Math.atan2(Math.sin(a), Math.cos(a)), -1.4, 1.4);
        pitchT = clamp(0.2 - Math.atan2(py - w.g.position.y, d) * 0.6, -0.3, 0.9);
      }
      w.yaw = lerp(w.yaw, yawT, 1 - Math.exp(-3 * dt));
      w.pitch = lerp(w.pitch, pitchT, 1 - Math.exp(-2.5 * dt));
      w.neck.rotation.set(w.pitch + (w.graze ? Math.sin(t * 5 + w.ph) * 0.05 : 0), w.yaw, 0);
    }
  }
}

// A lumpy, weathered boulder (shared by every cap rock).
function boulderCapGeo() {
  return geo('capRock', () => {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const n = 1 + noise3(x * 1.6, y * 1.6, z * 1.6, 13) * 0.22 + noise3(x * 4, y * 4, z * 4, 14) * 0.05;
      p.setXYZ(k, x * n, y * n, z * n);
    }
    g.computeVertexNormals();
    return g;
  });
}

function hsl(h, s, l) { return new THREE.Color().setHSL(h, s, l); }

function mergeGeos(geos) {
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

// Furrowed field rows (tinted per terrace by the material colour).
let ROWS = null;
function cropRowsTex() {
  if (ROWS) return ROWS;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) { ctx.fillStyle = 'rgba(80,60,40,0.35)'; ctx.fillRect(0, y, 128, 3); }
  const r = rng(71);
  for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(255,255,255,${r() * 0.3})`; ctx.fillRect(r() * 128, r() * 128, 2, 2); }
  ROWS = new THREE.CanvasTexture(c);
  ROWS.colorSpace = THREE.SRGBColorSpace;
  ROWS.wrapS = ROWS.wrapT = THREE.RepeatWrapping;
  ROWS.repeat.set(6, 6);
  ROWS.userData.shared = true;
  return ROWS;
}

// Tileable rippling normal map for the lake (sum of periodic sines).
function waterNormalMap() {
  const N = 128;
  const h = (x, y) => {
    const u = (x / N) * Math.PI * 2, v = (y / N) * Math.PI * 2;
    return Math.sin(u * 2 + Math.sin(v * 3) * 0.8) + Math.sin(v * 3 + Math.sin(u * 2) * 1.1) * 0.8 + Math.sin((u + v) * 5) * 0.25;
  };
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
