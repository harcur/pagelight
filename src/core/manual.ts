// Pages larger than the calibration sheet: find the page outline in the photo and
// flatten it as a plane of known size. The lens model still removes distortion.
import type { Intrinsics } from './camera';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

/** Four page corners in image px, clockwise from top-left, or null. */
export function findPageQuad(cv: CV, gray: CV): [number, number][] | null {
  const scale = Math.min(1, 1000 / Math.max(gray.cols, gray.rows));
  const small = new cv.Mat();
  cv.resize(gray, small, new cv.Size(Math.round(gray.cols * scale), Math.round(gray.rows * scale)), 0, 0, cv.INTER_AREA);
  cv.GaussianBlur(small, small, new cv.Size(5, 5), 0);
  const bin = new cv.Mat();
  cv.threshold(small, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k);
  k.delete();
  const contours = new cv.MatVector(), hier = new cv.Mat();
  cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let best: [number, number][] | null = null;
  let bestArea = small.cols * small.rows * 0.08;
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    if (area > bestArea) {
      const peri = cv.arcLength(c, true);
      const approx = new cv.Mat();
      for (const eps of [0.02, 0.03, 0.05]) {
        cv.approxPolyDP(c, approx, eps * peri, true);
        if (approx.rows === 4) break;
      }
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const pts: [number, number][] = [];
        for (let j = 0; j < 4; j++) pts.push([approx.data32S[j * 2] / scale, approx.data32S[j * 2 + 1] / scale]);
        best = orderQuad(pts);
        bestArea = area;
      }
      approx.delete();
    }
    c.delete();
  }
  contours.delete(); hier.delete(); small.delete(); bin.delete();
  return best;
}

export function orderQuad(p: [number, number][]): [number, number][] {
  const cx = p.reduce((a, q) => a + q[0], 0) / 4, cy = p.reduce((a, q) => a + q[1], 0) / 4;
  const s = [...p].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // start at the corner nearest the top-left
  let start = 0, best = Infinity;
  s.forEach((q, i) => { const d = q[0] + q[1]; if (d < best) { best = d; start = i; } });
  return [0, 1, 2, 3].map((i) => s[(start + i) % 4]);
}

/** Undistort then warp the quad to a flat page of the given size. `src` RGBA; returns RGBA. */
export function flattenQuad(cv: CV, src: CV, K: Intrinsics, quad: [number, number][], widthMm: number, heightMm: number, ppm: number): CV {
  const Km = cv.matFromArray(3, 3, cv.CV_64F, [K.fx, 0, K.cx, 0, K.fy, K.cy, 0, 0, 1]);
  const D = cv.matFromArray(5, 1, cv.CV_64F, K.dist);
  const und = new cv.Mat();
  const hasDist = K.dist.some((d) => Math.abs(d) > 1e-9);
  let q = quad;
  if (hasDist) {
    cv.undistort(src, und, Km, D, Km);
    q = quad.map(([x, y]) => undistortPixel(K, x, y));
  } else src.copyTo(und);
  const W = Math.round(widthMm * ppm), H = Math.round(heightMm * ppm);
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, q.flat());
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
  const M = cv.getPerspectiveTransform(from, to);
  const out = new cv.Mat();
  cv.warpPerspective(und, out, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  [Km, D, und, from, to, M].forEach((m) => m.delete());
  return out;
}

function undistortPixel(K: Intrinsics, u: number, v: number): [number, number] {
  const xd = (u - K.cx) / K.fx, yd = (v - K.cy) / K.fy;
  const [k1, k2, p1, p2, k3] = K.dist;
  let x = xd, y = yd;
  for (let i = 0; i < 20; i++) {
    const r2 = x * x + y * y;
    const rad = 1 + r2 * (k1 + r2 * (k2 + r2 * k3));
    x = (xd - (2 * p1 * x * y + p2 * (r2 + 2 * x * x))) / rad;
    y = (yd - (p1 * (r2 + 2 * y * y) + 2 * p2 * x * y)) / rad;
  }
  return [x * K.fx + K.cx, y * K.fy + K.cy];
}

/** Native px/mm for a quad of known size. */
export function quadPpm(quad: [number, number][], widthMm: number, heightMm: number): number {
  const d = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const w = (d(quad[0], quad[1]) + d(quad[3], quad[2])) / 2, h = (d(quad[0], quad[3]) + d(quad[1], quad[2])) / 2;
  return Math.sqrt((w / widthMm) * (h / heightMm));
}
