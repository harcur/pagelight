import { describe, expect, it } from 'vitest';
import { loadCv } from './cv';
import { SHEET_PRESETS, presetSpec } from '../src/core/sheet';
import { boardFor } from '../src/core/detect';
import { sheetPdf, sheetRects } from '../src/core/pdf';

describe('calibration sheet', () => {
  it('builds a valid layout for every preset', () => {
    for (const name of Object.keys(SHEET_PRESETS)) for (const land of [false, true]) {
      const s = presetSpec(name, land);
      expect(s.originX).toBeGreaterThanOrEqual(5.9);
      expect(s.originY).toBeGreaterThanOrEqual(5.9);
      expect(s.cols * s.rows / 2).toBeLessThanOrEqual(1000);
    }
  });

  it('vector layout matches the OpenCV board exactly', async () => {
    const cv = await loadCv();
    const spec = presetSpec('A5');
    const { board, topLeftBlack } = boardFor(cv, spec);
    const dict = cv.getPredefinedDictionary(cv.DICT_5X5_1000);
    const bits = (id: number) => {
      const m = new cv.Mat();
      dict.generateImageMarker(id, 7, m, 1);
      const b = Uint8Array.from(m.data, (v: number) => (v ? 1 : 0));
      m.delete();
      return b;
    };
    const rects = sheetRects(spec, topLeftBlack, bits);
    // Rasterize both at 7 px/mm so every edge lands on a whole pixel (A5: 8 mm squares, 6 mm markers).
    const ppm = 7;
    const W = spec.cols * spec.squareMm * ppm, H = spec.rows * spec.squareMm * ppm;
    const ours = new Uint8Array(W * H).fill(255);
    for (const r of rects) {
      const x0 = Math.round((r.x - spec.originX) * ppm), y0 = Math.round((r.y - spec.originY) * ppm);
      const x1 = Math.round((r.x + r.w - spec.originX) * ppm), y1 = Math.round((r.y + r.h - spec.originY) * ppm);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ours[y * W + x] = 0;
    }
    const ref = new cv.Mat();
    board.generateImage(new cv.Size(W, H), ref, 0, 1);
    let diff = 0;
    for (let i = 0; i < W * H; i++) if ((ref.data[i] > 127 ? 255 : 0) !== ours[i]) diff++;
    ref.delete();
    expect(diff / (W * H)).toBeLessThan(0.002);
    const pdf = await sheetPdf(spec, rects, 'github.com/harcur/pagelight');
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
