import { describe, expect, it } from 'vitest';
import { loadCv } from './cv';
import { bookCurl, renderScene } from './synth';
import { presetSpec } from '../src/core/sheet';
import { detectSheet } from '../src/core/detect';
import { solveCalibration, viewContribution } from '../src/core/calibrate';
import type { Intrinsics } from '../src/core/camera';

describe('lens calibration', () => {
  it('recovers focal length and distortion from flat views', async () => {
    const cv = await loadCv();
    const spec = presetSpec('A4');
    const K: Intrinsics = { width: 1600, height: 1200, fx: 1300, fy: 1300, cx: 810, cy: 590, dist: [-0.12, 0.08, 0, 0, 0] };
    const poses: [number, number, number, number, number, number][] = [
      [0, 0, Math.PI / 2, 150, -100, 520], [0.35, 0, Math.PI / 2, 150, -100, 560], [-0.35, 0, Math.PI / 2, 150, -100, 560],
      [0, 0.35, Math.PI / 2, 150, -100, 560], [0, -0.35, Math.PI / 2, 150, -100, 560], [0.2, 0.2, Math.PI / 2 + 0.2, 110, -140, 600],
      [-0.2, 0.25, Math.PI / 2 - 0.2, 190, -70, 600], [0.1, -0.3, Math.PI / 2, 60, -50, 650], [0.25, 0.1, Math.PI / 2, 230, -160, 650],
    ];
    const views = [];
    for (const p of poses) {
      const truth = bookCurl(spec, 0, 22, [p[0], p[1], p[2]], p[5]);
      truth.tvec = [p[3], p[4], p[5]];
      const gray = renderScene(cv, { K, truth, spec, page: { u0: -200, v0: -200, w: 1, h: 1 }, noise: 2 });
      const mat = cv.matFromArray(K.height, K.width, cv.CV_8UC1, gray);
      const det = detectSheet(cv, mat, spec);
      mat.delete();
      views.push({ ids: det.ids, points: det.points });
      const c = viewContribution({ ids: det.ids, points: det.points }, spec, K.width, K.height);
      console.log(`view corners ${det.ids.length} regions ${c.regions.join(',')} tilt ${c.tilt}`);
    }
    const cal = solveCalibration(cv, views, spec, K.width, K.height);
    const k = cal.intrinsics;
    console.log(`rms ${cal.rmsPx.toFixed(3)} fx ${k.fx.toFixed(1)} fy ${k.fy.toFixed(1)} cx ${k.cx.toFixed(1)} cy ${k.cy.toFixed(1)} dist ${k.dist.map((d) => d.toFixed(3)).join(' ')}`);
    expect(cal.rmsPx).toBeLessThan(0.5);
    expect(Math.abs(k.fx - K.fx) / K.fx).toBeLessThan(0.01);
    expect(Math.abs(k.dist[0] - K.dist[0])).toBeLessThan(0.02);
  });
});
