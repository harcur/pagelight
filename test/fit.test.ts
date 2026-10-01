import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadCv } from './cv';
import { bookCurl, renderScene } from './synth';
import { presetSpec } from '../src/core/sheet';
import { detectSheet, toCorrespondences } from '../src/core/detect';
import { fitSurface, SurfaceEval, curlMm } from '../src/core/surface';
import type { Intrinsics } from '../src/core/camera';

const K: Intrinsics = { width: 3000, height: 2250, fx: 2500, fy: 2500, cx: 1500, cy: 1125, dist: [-0.08, 0.05, 0, 0, 0] };

describe('under-sheet surface fit', () => {
  it('recovers a curled page from the visible sheet margins', async () => {
    const cv = await loadCv();
    const spec = presetSpec('A4');
    const truth = bookCurl(spec);
    // camera image is landscape; rotate the sheet a quarter turn so it fits
    truth.rvec = [0.08, -0.12, Math.PI / 2 + 0.03];
    truth.tvec = [148, -105, 470];
    const page = { u0: 0, v0: 30, w: 165, h: 237 };
    const t0 = performance.now();
    const gray = renderScene(cv, { K, truth, spec, page });
    const t1 = performance.now();
    mkdirSync('test/out', { recursive: true });
    writeFileSync('test/out/scene.pgm', Buffer.concat([Buffer.from(`P5 ${K.width} ${K.height} 255\n`), Buffer.from(gray)]));
    const mat = cv.matFromArray(K.height, K.width, cv.CV_8UC1, gray);
    const det = detectSheet(cv, mat, spec);
    const t2 = performance.now();
    mat.delete();
    const corr = toCorrespondences(det, spec);
    console.log(`render ${(t1 - t0).toFixed(0)} ms, detect ${(t2 - t1).toFixed(0)} ms, corners ${corr.length}, markers ${det.markers}`);
    expect(corr.length).toBeGreaterThan(40);

    const fit = fitSurface(corr, K, { paperMm: [spec.widthMm, spec.heightMm] });
    const t3 = performance.now();
    console.log(`fit ${(t3 - t2).toFixed(0)} ms, rms ${fit.rmsPx.toFixed(3)} px, rejected ${fit.rejected}, phi ${fit.surface.phi.toFixed(3)}, curl ${curlMm(fit.surface, [spec.widthMm, spec.heightMm]).toFixed(1)} mm (truth ${curlMm(truth, [spec.widthMm, spec.heightMm]).toFixed(1)})`);
    expect(fit.rmsPx).toBeLessThan(1);

    // The page is hidden from the detector; check the fitted surface predicts it anyway.
    const evT = new SurfaceEval(truth, -300, 300), evF = new SurfaceEval(fit.surface, -300, 300);
    const a = [0, 0], b = [0, 0];
    let worstBody = 0, worstGutter = 0, sum = 0, n = 0;
    for (let v = page.v0; v <= page.v0 + page.h; v += 10) for (let u = page.u0; u <= page.u0 + page.w; u += 5) {
      evT.project(K, u, v, a);
      evF.project(K, u, v, b);
      const e = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (u < 20) worstGutter = Math.max(worstGutter, e);
      else worstBody = Math.max(worstBody, e);
      sum += e;
      n++;
    }
    const pxPerMm = 2500 / 470;
    console.log(`page prediction: mean ${(sum / n / pxPerMm).toFixed(2)} mm, worst ${(worstBody / pxPerMm).toFixed(2)} mm (beyond 20 mm from spine), ${(worstGutter / pxPerMm).toFixed(2)} mm in the gutter`);
    expect(sum / n / pxPerMm).toBeLessThan(0.3);
    expect(worstBody / pxPerMm).toBeLessThan(0.5);
  });
});
