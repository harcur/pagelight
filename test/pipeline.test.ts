import { describe, expect, it } from 'vitest';
import { loadCv } from './cv';
import { bookCurl, renderScene } from './synth';
import { presetSpec } from '../src/core/sheet';
import { analyse } from '../src/core/pipeline';
import type { Intrinsics } from '../src/core/camera';

const K: Intrinsics = { width: 3000, height: 2250, fx: 2500, fy: 2500, cx: 1500, cy: 1125, dist: [-0.08, 0.05, 0, 0, 0] };

describe('capture pipeline', () => {
  it('finds and measures the page', async () => {
    const cv = await loadCv();
    const spec = presetSpec('A4');
    const truth = bookCurl(spec);
    truth.rvec = [0.08, -0.12, Math.PI / 2 + 0.03];
    truth.tvec = [148, -105, 470];
    const page = { u0: 0, v0: 30, w: 165, h: 237 };
    const gray = renderScene(cv, { K, truth, spec, page });
    const mat = cv.matFromArray(K.height, K.width, cv.CV_8UC1, gray);
    const t0 = performance.now();
    const a = analyse(cv, mat, spec, K);
    mat.delete();
    console.log(`analyse ${(performance.now() - t0).toFixed(0)} ms`, JSON.stringify({ corners: a.page?.corners.map((c) => c.map((v) => +v.toFixed(2))), sources: a.page?.sources, spine: a.page?.spine, size: [a.frame.widthMm.toFixed(2), a.frame.heightMm.toFixed(2)], ppm: a.ppm.toFixed(2), warnings: a.warnings }));
    expect(a.page).not.toBeNull();
    expect(a.page!.spine).toBe('left');
    const truthCorners = [[0, 30], [165, 30], [165, 267], [0, 267]];
    a.page!.corners.forEach((c, i) => {
      const e = Math.hypot(c[0] - truthCorners[i][0], c[1] - truthCorners[i][1]);
      expect(e, `corner ${i}`).toBeLessThan(i === 1 || i === 2 ? 0.5 : 2.5);
    });
  });
});
