// Scenery checks, run headlessly against a local server (python3 -m http.server 8941 --bind 127.0.0.1):
//   node tools/check-scenery.mjs            all three courses
//   PLAYWRIGHT=/path/to/playwright/index.mjs node tools/check-scenery.mjs
// For each course it runs
//   clip-sweep.js: coplanar overlapping surfaces (z-fighting), and every moving piece swept
//                  through 40 simulated seconds (seesaws and the tilt table forced to their
//                  limits) checking it never passes through static scenery;
//   flicker.js:    renders camera positions along the course twice, nudged by 2mm (and the
//                  shadow camera by 7cm), and counts pixels that flip: z-fighting lights up
//                  as hundreds or thousands of pixels; a few hundred scattered edge pixels is normal.
// The worst flicker frames are written to tools/out/ with flipping pixels in magenta.
import fs from 'fs';
import path from 'path';
const here = path.dirname(new URL(import.meta.url).pathname);
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const url = process.env.URL || 'http://127.0.0.1:8941/index.html';
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (let n = 0; n < 3; n++) {
  for (const probe of ['clip-sweep.js', 'flicker.js']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await page.goto(url);
    await page.waitForTimeout(3000);
    await page.evaluate(() => localStorage.clear());
    for (let i = 0; i < n; i++) await page.click('#course-next');
    await page.click('#play');
    const res = await page.evaluate(fs.readFileSync(path.join(here, probe), 'utf8'));
    if (probe === 'flicker.js') {
      const r = JSON.parse(res);
      console.log(`${r.course} flicker  camera: ${r.cam}\n${r.course} flicker  shadow: ${r.sun}`);
      r.imgs.forEach((d, i) => fs.writeFileSync(path.join(here, 'out', `flicker_${r.course}_${i}.png`), Buffer.from(d.split(',')[1], 'base64')));
    } else console.log(res);
    await page.close();
  }
}
await browser.close();
