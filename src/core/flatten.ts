// Unrolling: sample the photo through the fitted surface to get a flat, true-scale image.
import type { Intrinsics } from './camera';
import { type Surface, evalFor } from './surface';

/** A rectangle on the paper, possibly rotated: origin + p·ex + q·ey (mm). */
export interface PaperFrame {
  origin: [number, number];
  ex: [number, number];
  ey: [number, number];
  widthMm: number;
  heightMm: number;
}

export function axisFrame(u0: number, v0: number, u1: number, v1: number): PaperFrame {
  return { origin: [u0, v0], ex: [1, 0], ey: [0, 1], widthMm: u1 - u0, heightMm: v1 - v0 };
}

/**
 * Remap tables for rows [y0, y1) of an output image covering `frame` at `ppm` px/mm.
 * Evaluated on a coarse grid and bilinearly interpolated (the surface is smooth).
 */
export function remapRows(
  surf: Surface, K: Intrinsics, paperMm: [number, number], frame: PaperFrame, ppm: number,
  outW: number, y0: number, y1: number, grid = 8,
): { mapX: Float32Array; mapY: Float32Array } {
  const ev = evalFor(surf, paperMm, 200);
  const rows = y1 - y0;
  const gw = Math.ceil((outW - 1) / grid) + 2;
  const gy0 = Math.floor(y0 / grid), gy1 = Math.ceil((y1 - 1) / grid) + 1;
  const gh = gy1 - gy0 + 1;
  const G = new Float64Array(gw * gh * 2);
  const b = [0, 0];
  for (let j = 0; j < gh; j++) {
    const q = ((gy0 + j) * grid + 0.5) / ppm;
    for (let i = 0; i < gw; i++) {
      const p = (i * grid + 0.5) / ppm;
      const u = frame.origin[0] + p * frame.ex[0] + q * frame.ey[0];
      const v = frame.origin[1] + p * frame.ex[1] + q * frame.ey[1];
      ev.project(K, u, v, b);
      G[(j * gw + i) * 2] = b[0];
      G[(j * gw + i) * 2 + 1] = b[1];
    }
  }
  const mapX = new Float32Array(outW * rows), mapY = new Float32Array(outW * rows);
  for (let y = 0; y < rows; y++) {
    const gyf = (y0 + y) / grid - gy0;
    const gj = Math.min(gh - 2, Math.floor(gyf));
    const wy = gyf - gj;
    for (let x = 0; x < outW; x++) {
      const gxf = x / grid;
      const gi = Math.min(gw - 2, Math.floor(gxf));
      const wx = gxf - gi;
      const a = (gj * gw + gi) * 2, c = a + gw * 2;
      const o = y * outW + x;
      mapX[o] = (G[a] * (1 - wx) + G[a + 2] * wx) * (1 - wy) + (G[c] * (1 - wx) + G[c + 2] * wx) * wy;
      mapY[o] = (G[a + 1] * (1 - wx) + G[a + 3] * wx) * (1 - wy) + (G[c + 1] * (1 - wx) + G[c + 3] * wx) * wy;
    }
  }
  return { mapX, mapY };
}

/**
 * Native resolution of the photo on the page: median camera px per paper mm over the frame,
 * so the output neither invents detail nor throws it away.
 */
export function nativePpm(surf: Surface, K: Intrinsics, paperMm: [number, number], frame: PaperFrame): number {
  const ev = evalFor(surf, paperMm, 200);
  const vals: number[] = [];
  const a = [0, 0], bx = [0, 0], by = [0, 0];
  for (let j = 1; j < 8; j++) for (let i = 1; i < 8; i++) {
    const p = (frame.widthMm * i) / 8, q = (frame.heightMm * j) / 8;
    const u = frame.origin[0] + p * frame.ex[0] + q * frame.ey[0];
    const v = frame.origin[1] + p * frame.ex[1] + q * frame.ey[1];
    ev.project(K, u, v, a);
    ev.project(K, u + frame.ex[0], v + frame.ex[1], bx);
    ev.project(K, u + frame.ey[0], v + frame.ey[1], by);
    const sx = Math.hypot(bx[0] - a[0], bx[1] - a[1]), sy = Math.hypot(by[0] - a[0], by[1] - a[1]);
    if (Number.isFinite(sx) && Number.isFinite(sy)) vals.push(Math.sqrt(sx * sy));
  }
  vals.sort((x, y) => x - y);
  return vals[Math.floor(vals.length / 2)] ?? 8;
}

/** Remap an image through the surface into a flat output, in horizontal strips to bound memory. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function flattenImage(cv: any, src: any, surf: Surface, K: Intrinsics, paperMm: [number, number], frame: PaperFrame, ppm: number, onProgress?: (f: number) => void): any {
  const outW = Math.max(1, Math.round(frame.widthMm * ppm));
  const outH = Math.max(1, Math.round(frame.heightMm * ppm));
  const dst = new cv.Mat(outH, outW, src.type());
  const strip = 256;
  for (let y0 = 0; y0 < outH; y0 += strip) {
    const y1 = Math.min(outH, y0 + strip);
    const { mapX, mapY } = remapRows(surf, K, paperMm, frame, ppm, outW, y0, y1);
    const mx = cv.matFromArray(y1 - y0, outW, cv.CV_32FC1, mapX);
    const my = cv.matFromArray(y1 - y0, outW, cv.CV_32FC1, mapY);
    const part = new cv.Mat();
    cv.remap(src, part, mx, my, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 255));
    const roi = dst.roi(new cv.Rect(0, y0, outW, y1 - y0));
    part.copyTo(roi);
    roi.delete(); part.delete(); mx.delete(); my.delete();
    onProgress?.(y1 / outH);
  }
  return dst;
}
