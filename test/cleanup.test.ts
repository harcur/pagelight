import { describe, expect, it } from 'vitest';
import { loadCv } from './cv';
import { cleanPage } from '../src/core/cleanup';

describe('cleanup', () => {
  it('evens out lighting and keeps faint lines only when asked', async () => {
    const cv = await loadCv();
    const W = 800, H = 1000, ppm = 8;
    const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const light = 150 + 90 * (x / W); // strong side-to-side falloff
      let v = light;
      if (y > 300 && y < 304) v = light * 0.25; // dark ink line
      if (y > 600 && y < 603) v = light * 0.8; // faint pencil line
      const i = (y * W + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
    const src = cv.matFromImageData({ data: px, width: W, height: H });
    const at = (m: { data: Uint8Array }, x: number, y: number) => m.data[(y * W + x) * 4];
    const keep = cleanPage(cv, src, { mode: 'bw', faint: 100, despeckle: 2, ppm });
    const drop = cleanPage(cv, src, { mode: 'bw', faint: 0, despeckle: 2, ppm });
    const gray = cleanPage(cv, src, { mode: 'gray', faint: 60, despeckle: 0, ppm });
    // paper is white on both the dark and the bright side
    expect(at(keep, 20, 100)).toBe(255);
    expect(at(keep, W - 20, 100)).toBe(255);
    expect(Math.abs(at(gray, 20, 100) - at(gray, W - 20, 100))).toBeLessThan(12);
    // ink line is black everywhere
    expect(at(keep, 20, 302)).toBe(0);
    expect(at(drop, W - 20, 302)).toBe(0);
    // faint line kept at high setting, dropped at low
    expect(at(keep, 400, 601)).toBe(0);
    expect(at(drop, 400, 601)).toBe(255);
    [src, keep, drop, gray].forEach((m) => m.delete());
  });
});
