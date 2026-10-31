(async () => {
  const g = window.__game, C = g.course, R = g.renderer, S = g.scene, V3 = g.camera.position.constructor;
  g.advance(9.2);
  g.game.paused = true;
  const W = 480, H = 270;
  const RT = new R.constructor === undefined ? null : null;
  const THREE = await import('three');
  const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
  const cam = new THREE.PerspectiveCamera(55, W / H, 0.1, 900);
  const sun = S.children.find((o) => o.isDirectionalLight);
  const px = () => { const b = new Uint8Array(W * H * 4); R.setRenderTarget(rt); R.render(S, cam); R.readRenderTargetPixels(rt, 0, 0, W, H, b); R.setRenderTarget(null); return b; };
  const diff = (a, b, mask) => { let n = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); if (d > 70) { n++; if (mask) mask[i / 4] = 1; } } return n; };
  const results = [];
  const zEnd = C.finishZ + 10;
  let k = 0;
  for (let z = -6; z < zEnd; z += 5, k++) {
    const far = k % 3 === 2;
    const y = C.heightAt(Math.max(z, -5));
    const side = k % 2 ? 1 : -1;
    const pos = far ? new V3(side * 28, y + 14, z - 18) : new V3(side * 5, y + 4.2, z - 8);
    const tgt = new V3(0, C.heightAt(Math.min(z + 6, zEnd)) + 0.5, z + 6);
    // put the player (and so the sun's shadow camera) near this spot, like in play
    const p = g.player(); p.pos.set(0, y, z); p.root.position.copy(p.pos);
    sun.position.copy(p.pos).add(new V3(-14, 30, -10)); sun.target.position.copy(p.pos); sun.target.updateMatrixWorld();
    cam.position.copy(pos); cam.lookAt(tgt); cam.updateMatrixWorld();
    const a = px();
    // 1: nudge the camera a couple of millimetres
    const right = new V3().setFromMatrixColumn(cam.matrixWorld, 0);
    cam.position.addScaledVector(right, 0.002).y += 0.0015; cam.lookAt(tgt.clone().addScaledVector(right, 0.002)); cam.updateMatrixWorld();
    const mask = new Uint8Array(W * H);
    const b = px();
    const nCam = diff(a, b, mask);
    // 2: nudge the sun's shadow camera, as walking would
    cam.position.copy(pos); cam.lookAt(tgt); cam.updateMatrixWorld();
    sun.position.x += 0.07; sun.target.position.x += 0.07; sun.target.updateMatrixWorld();
    const c = px();
    const nSun = diff(a, c, null);
    results.push({ z, far, nCam, nSun, a, mask });
    // let moving things move on
    C.update(C.time + 0.4, 0.4, []);
  }
  results.sort((p, q) => q.nCam - p.nCam);
  const vis = (r) => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const si = ((H - 1 - y) * W + x), di = (y * W + x) * 4;
      if (r.mask[si]) { img.data[di] = 255; img.data[di + 1] = 0; img.data[di + 2] = 255; }
      else { img.data[di] = r.a[si * 4]; img.data[di + 1] = r.a[si * 4 + 1]; img.data[di + 2] = r.a[si * 4 + 2]; }
      img.data[di + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); return cv.toDataURL('image/png');
  };
  const sunSorted = [...results].sort((p, q) => q.nSun - p.nSun);
  return JSON.stringify({
    course: C.info.id,
    cam: results.slice(0, 8).map((r) => `z${r.z}${r.far ? 'F' : ''}:${r.nCam}`).join(' '),
    sun: sunSorted.slice(0, 8).map((r) => `z${r.z}${r.far ? 'F' : ''}:${r.nSun}`).join(' '),
    imgs: results.slice(0, 3).map(vis),
  });
})()
