import { describe, expect, it } from 'vitest';
import { loadCv } from './cv';
import { bookCurl, renderScene } from './synth';
import { presetSpec } from '../src/core/sheet';
import { findPageQuad, flattenQuad, quadPpm } from '../src/core/manual';
import type { Intrinsics } from '../src/core/camera';

describe('manual size mode', () => {
  it('finds a flat page on a dark table and flattens it to size', async () => {
    const cv = await loadCv();
    const K: Intrinsics = { width: 2000, height: 1500, fx: 1700, fy: 1700, cx: 1000, cy: 750, dist: [-0.05, 0.02, 0, 0, 0] };
    const spec = presetSpec('A3');
    const truth = bookCurl(spec, 0, 22, [0.15, -0.1, Math.PI / 2 + 0.05], 560);
    truth.tvec = [200, -150, 560];
    const page = { u0: 30, v0: 40, w: 230, h: 330 };
    const gray = renderScene(cv, { K, truth, spec, page, noSheet: true });
    const g = cv.matFromArray(K.height, K.width, cv.CV_8UC1, gray);
    const quad = findPageQuad(cv, g);
    expect(quad).not.toBeNull();
    const ppm = quadPpm(quad!, page.h, page.w);
    const rgba = new cv.Mat();
    cv.cvtColor(g, rgba, cv.COLOR_GRAY2RGBA);
    const out = flattenQuad(cv, rgba, K, quad!, page.h, page.w, ppm);
    console.log(`quad ppm ${ppm.toFixed(2)}, output ${out.cols}×${out.rows}`);
    expect(out.cols).toBe(Math.round(page.h * ppm));
    [g, rgba, out].forEach((m) => m.delete());
  });
});
