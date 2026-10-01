// Synthetic "photo" of a calibration sheet under a curled book page, with known ground truth.
import { type Intrinsics, projectCam } from '../src/core/camera';
import { type SheetSpec, paperSizeMm } from '../src/core/sheet';
import { type Surface, SurfaceEval } from '../src/core/surface';
import { boardFor } from '../src/core/detect';

export interface Scene {
  K: Intrinsics;
  truth: Surface;
  spec: SheetSpec;
  /** Page rectangle in paper mm: spine side at u0. */
  page: { u0: number; v0: number; w: number; h: number };
  /** Texture resolution, px per mm. */
  ppm?: number;
  noise?: number;
  /** Leave the calibration sheet out (manual-size mode). */
  noSheet?: boolean;
}

export function bookCurl(spec: SheetSpec, amount = 0.7, width = 22, tilt: [number, number, number] = [0.08, -0.12, 0.03], dist = 450): Surface {
  const [W, H] = paperSizeMm(spec);
  const knotStep = 4;
  const lo = -W / 2 - 60, hi = W / 2 + 20;
  const n = Math.ceil((hi - lo) / knotStep) + 1;
  const theta = Array.from({ length: n }, (_, i) => {
    const u = lo + i * knotStep + W / 2; // paper u
    return -amount * Math.exp(-Math.max(u, -30) / width);
  });
  // remove mean so the gauge matches the fitter's convention (not required for correctness)
  return { rvec: tilt, tvec: [-W / 2, -H / 2, dist], phi: 0, origin: [W / 2, H / 2], knotS0: lo, knotStep, theta };
}

/** Render a grayscale image (Uint8Array, row-major) of the scene. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function renderScene(cv: any, sc: Scene): Uint8Array {
  const { K, spec, page } = sc;
  const ppm = sc.ppm ?? 8;
  const [W, H] = paperSizeMm(spec);
  const tw = Math.round(W * ppm), th = Math.round(H * ppm);
  const tex = new Uint8Array(tw * th).fill(245);
  // board texture
  const { board } = boardFor(cv, spec);
  const bw = Math.round(spec.cols * spec.squareMm * ppm * spec.printScale);
  const bh = Math.round(spec.rows * spec.squareMm * ppm * spec.printScale);
  const img = new cv.Mat();
  board.generateImage(new cv.Size(bw, bh), img, 0, 1);
  const ox = Math.round(spec.originX * spec.printScale * ppm), oy = Math.round(spec.originY * spec.printScale * ppm);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const tx = ox + x, ty = oy + y;
    if (tx < tw && ty < th) tex[ty * tw + tx] = img.data[y * bw + x] ? 245 : 25;
  }
  img.delete();

  const sample = (u: number, v: number): number => {
    const inPage = u >= page.u0 - 40 && u <= page.u0 + page.w && v >= page.v0 && v <= page.v0 + page.h;
    if (inPage) {
      if (u < page.u0) return sc.noSheet ? 70 : 180; // gutter / facing side
      const gu = (u - page.u0) % 10, gv = (v - page.v0) % 10;
      if (gu < 0.35 || gv < 0.35) return 40;
      return 232;
    }
    if (sc.noSheet || u < 0 || v < 0 || u >= W || v >= H) return 70;
    const x = u * ppm - 0.5, y = v * ppm - 0.5; // texel centres
    const x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 >= tw - 1 || y0 >= th - 1) return 245;
    const fx = x - x0, fy = y - y0;
    const i = y0 * tw + x0;
    return (tex[i] * (1 - fx) + tex[i + 1] * fx) * (1 - fy) + (tex[i + tw] * (1 - fx) + tex[i + tw + 1] * fx) * fy;
  };

  const out = new Uint8Array(K.width * K.height).fill(60);
  const ev = new SurfaceEval(sc.truth, -W, W);
  const step = 2;
  const u0 = -50, u1 = W + 15, v0 = -15, v1 = H + 15;
  const nu = Math.ceil((u1 - u0) / step) + 1, nv = Math.ceil((v1 - v0) / step) + 1;
  const P = new Float64Array(nu * nv * 2);
  const Zc = new Float64Array(nu * nv);
  const depth = new Float32Array(K.width * K.height).fill(Infinity);
  const p3 = [0, 0, 0];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    ev.toCamera(u0 + i * step, v0 + j * step, p3);
    projectCam(K, p3[0], p3[1], p3[2], P, (j * nu + i) * 2);
    Zc[j * nu + i] = p3[2];
  }
  const tri = (a: number, b: number, c: number, ua: number[], ub: number[], uc: number[]) => {
    const ax = P[a * 2], ay = P[a * 2 + 1], bx = P[b * 2], by = P[b * 2 + 1], cx = P[c * 2], cy = P[c * 2 + 1];
    if (![ax, ay, bx, by, cx, cy].every(Number.isFinite)) return;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(K.width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(K.height - 1, Math.ceil(Math.max(ay, by, cy)));
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-9) return;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
      const w2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
      const w3 = 1 - w1 - w2;
      if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
      const u = w1 * ua[0] + w2 * ub[0] + w3 * uc[0];
      const v = w1 * ua[1] + w2 * ub[1] + w3 * uc[1];
      const z = w1 * Zc[a] + w2 * Zc[b] + w3 * Zc[c];
      const o = y * K.width + x;
      if (z >= depth[o]) continue;
      depth[o] = z;
      out[o] = sample(u, v);
    }
  };
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
    const a = j * nu + i, b = a + 1, c = a + nu, e = c + 1;
    const ua = [u0 + i * step, v0 + j * step], ub = [ua[0] + step, ua[1]], uc = [ua[0], ua[1] + step], ue = [ua[0] + step, ua[1] + step];
    tri(a, b, e, ua, ub, ue);
    tri(a, e, c, ua, ue, uc);
  }
  const noise = sc.noise ?? 3;
  let seed = 12345;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 16807) % 2147483647;
    out[i] = Math.max(0, Math.min(255, out[i] + ((seed / 2147483647) - 0.5) * 2 * noise));
  }
  return out;
}
