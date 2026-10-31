(() => {
  const g = window.__game, C = g.course, V3 = g.camera.position.constructor;
  g.advance(9.2);
  for (const l of g.llamas) l.bot && (l.bot.pause = 1e9);
  const name = (m) => {
    let o = m, path = [];
    while (o && o !== C.scene) { path.push(o.geometry ? o.geometry.type.replace('Geometry', '') : 'G'); o = o.parent; }
    const p = new V3(); m.getWorldPosition(p);
    return path.reverse().join('/') + `@(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`;
  };
  // which top-level node (platform mesh / obstacle group) a mesh belongs to
  const rootOf = (m) => { let o = m; while (o.parent && o.parent !== C.scene) o = o.parent; return o; };
  const moving = new Set();
  for (const p of C.platforms) if (p.mesh && (p.motion || p.dynamic || p.type === 'seesaw' || p.type === 'tilt')) moving.add(p.mesh);
  for (const o of C.obstacles) { if (o.group) moving.add(o.group); if (o.piv) moving.add(o.piv); }
  const meshes = [];
  C.scene.traverse((m) => { if (m.isMesh && !m.isInstancedMesh && m.geometry.attributes.position && m.visible) meshes.push(m); });
  const out = { coplanar: [], hits: [] };

  // ---- A: coplanar overlapping up-facing surfaces (z-fighting), sampled at several times
  const seen = new Set();
  const coplanar = () => {
    C.scene.updateMatrixWorld(true);
    const tris = [];
    const a = new V3(), b = new V3(), c = new V3(), n = new V3(), e1 = new V3(), e2 = new V3();
    for (const m of meshes) {
      const pos = m.geometry.attributes.position, idx = m.geometry.index;
      const cnt = idx ? idx.count : pos.count;
      if (m.geometry.boundingSphere === null) m.geometry.computeBoundingSphere();
      if (m.geometry.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis() > 300) continue; // lake/valley/mountains
      for (let i = 0; i < cnt; i += 3) {
        const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld);
        b.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld);
        c.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
        const area = n.length() / 2;
        if (area < 1e-4) continue;
        n.normalize();
        if (Math.abs(n.y) < 0.995) continue;
        tris.push({ m, y: (a.y + b.y + c.y) / 3, up: n.y > 0, x0: Math.min(a.x, b.x, c.x), x1: Math.max(a.x, b.x, c.x), z0: Math.min(a.z, b.z, c.z), z1: Math.max(a.z, b.z, c.z) });
      }
    }
    tris.sort((p, q) => p.y - q.y);
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      for (let j = i + 1; j < tris.length && tris[j].y - t.y < 0.012; j++) {
        const u = tris[j];
        if (u.m === t.m || u.up !== t.up || rootOf(u.m) === rootOf(t.m) && u.m.parent === t.m.parent && false) continue;
        const ox = Math.min(t.x1, u.x1) - Math.max(t.x0, u.x0), oz = Math.min(t.z1, u.z1) - Math.max(t.z0, u.z0);
        if (ox > 0.03 && oz > 0.03) {
          const key = [name(t.m), name(u.m)].sort().join(' | ');
          if (!seen.has(key)) { seen.add(key); out.coplanar.push(`${key}  dy=${(u.y - t.y).toFixed(4)} at t=${C.time.toFixed(1)}`); }
        }
      }
    }
  };

  // ---- B: moving things passing through static scenery, sampled through time
  const statics = meshes.filter((m) => !m.userData.attached && !moving.has(rootOf(m)) && !(m.geometry.boundingSphere && m.geometry.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis() > 300));
  const inv = new Map();
  const inside = (m, wp, margin) => {
    let mi = inv.get(m); if (!mi) { mi = m.matrixWorld.clone().invert(); inv.set(m, mi); }
    const lp = wp.clone().applyMatrix4(mi);
    const gp = m.geometry.parameters || {}, type = m.geometry.type, s = m.matrixWorld.getMaxScaleOnAxis();
    const mg = margin / s;
    if (type === 'CylinderGeometry') {
      const r = Math.max(gp.radiusTop, gp.radiusBottom);
      return Math.abs(lp.y) < gp.height / 2 - mg && Math.hypot(lp.x, lp.z) < r - mg;
    }
    if (type === 'SphereGeometry' || type === 'IcosahedronGeometry') return lp.length() < (gp.radius || 1) - mg;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    return lp.x > bb.min.x + mg && lp.x < bb.max.x - mg && lp.y > bb.min.y + mg && lp.y < bb.max.y - mg && lp.z > bb.min.z + mg && lp.z < bb.max.z - mg;
  };
  const movers = meshes.filter((m) => moving.has(rootOf(m)) && !m.userData.attached);
  const samples = movers.map((m) => {
    const pos = m.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 400));
    const pts = []; for (let i = 0; i < pos.count; i += step) pts.push(new V3().fromBufferAttribute(pos, i));
    return { m, pts };
  });
  const hitSeen = new Set();
  for (let k = 0; k < 160; k++) {
    if (k % 40 === 0) coplanar();
    C.update(C.time + 0.25, 0.25, []);
    // push the tipping platforms to their limits as well
    const ext = [1, -1, 0.5, -0.5][k % 4];
    for (const sw of C.seesaws) { sw.theta = sw.maxTilt * ext; sw.mesh.rotation.x = sw.theta; }
    for (const td of C.tilts) { td.tx = td.maxTiltX * ext; td.tz = td.maxTiltZ * [1, 1, -1, -1][k % 4]; td.mesh.rotation.set(td.tx, 0, td.tz); }
    for (const sk of C.sinkers) sk.sink = (k % 10) / 10;
    C.scene.updateMatrixWorld(true);
    for (const { m, pts } of samples) {
      for (const lp of pts) {
        const wp = lp.clone().applyMatrix4(m.matrixWorld);
        for (const s of statics) {
          if (!s.geometry.boundingSphere) s.geometry.computeBoundingSphere();
          const c = s.geometry.boundingSphere.center.clone().applyMatrix4(s.matrixWorld);
          if (c.distanceTo(wp) > s.geometry.boundingSphere.radius * s.matrixWorld.getMaxScaleOnAxis() + 0.1) continue;
          if (inside(s, wp, 0.06)) {
            const key = (m.geometry.type + ' of ' + (rootOf(m).geometry ? rootOf(m).geometry.type : 'group') + '@z' + new V3().setFromMatrixPosition(rootOf(m).matrixWorld).z.toFixed(0)) + ' -> ' + name(s);
            hitSeen.add(key);
          }
        }
      }
    }
  }
  return C.info.id + ` (${meshes.length} meshes)\nCOPLANAR:\n` + out.coplanar.join('\n') + '\nMOVING HITS:\n' + [...hitSeen].join('\n');
})()
