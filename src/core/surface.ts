// Developable page surface: the sheet bends along one direction like a book page
// near the spine, but never stretches. Distances along the paper are preserved,
// so unrolling the fitted surface gives true physical scale.
//
// Sheet coordinates (u, v) are mm on the paper. The bend direction d = (cos φ, sin φ)
// runs across the spine; a = (-sin φ, cos φ) runs along it. The bend profile is a
// curve parameterized by arc length s, with tangent angle θ(s) given by a
// piecewise-linear spline. A paper point maps to 3D as
//   P = O + X(s)·d + t·a + Z(s)·n,  X(s) = ∫cos θ, Z(s) = ∫sin θ
// and then into the camera with a rigid pose and the calibrated lens model.

import { type Intrinsics, type Vec3, projectCam, rodrigues, undistortToNormalized } from './camera';
import { fitHomography, poseFromHomography } from './geometry';
import { levenbergMarquardt } from './lm';

export interface Correspondence {
  /** Paper position, mm. */
  u: number;
  v: number;
  /** Detected image position, px. */
  x: number;
  y: number;
}

export interface Surface {
  rvec: Vec3;
  tvec: Vec3;
  phi: number;
  /** Paper point where s = 0 and t = 0. */
  origin: [number, number];
  knotS0: number;
  knotStep: number;
  theta: number[];
}

export interface FitResult {
  surface: Surface;
  rmsPx: number;
  used: number;
  rejected: number;
}

const TABLE_STEP = 0.5; // mm

/** Precomputed arc-length integrals for fast evaluation. */
export class SurfaceEval {
  readonly R: number[];
  private readonly c: number;
  private readonly s: number;
  private readonly sMin: number;
  private readonly X: Float64Array;
  private readonly Z: Float64Array;

  constructor(readonly surf: Surface, sMin: number, sMax: number) {
    this.R = rodrigues(surf.rvec);
    this.c = Math.cos(surf.phi);
    this.s = Math.sin(surf.phi);
    // snap to the table step so that s = 0 falls exactly on a table entry
    const lo = Math.floor((Math.min(sMin, 0) - 2) / TABLE_STEP) * TABLE_STEP, hi = Math.max(sMax, 0) + 2;
    this.sMin = lo;
    const n = Math.ceil((hi - lo) / TABLE_STEP) + 1;
    const X = new Float64Array(n), Z = new Float64Array(n);
    const i0 = Math.round(-lo / TABLE_STEP);
    // integrate outward from s = 0 (trapezoid rule)
    for (let i = i0 + 1; i < n; i++) {
      const sa = lo + (i - 1) * TABLE_STEP, sb = lo + i * TABLE_STEP;
      const ta = thetaAt(surf, sa), tb = thetaAt(surf, sb);
      X[i] = X[i - 1] + 0.5 * TABLE_STEP * (Math.cos(ta) + Math.cos(tb));
      Z[i] = Z[i - 1] + 0.5 * TABLE_STEP * (Math.sin(ta) + Math.sin(tb));
    }
    for (let i = i0 - 1; i >= 0; i--) {
      const sa = lo + (i + 1) * TABLE_STEP, sb = lo + i * TABLE_STEP;
      const ta = thetaAt(surf, sa), tb = thetaAt(surf, sb);
      X[i] = X[i + 1] - 0.5 * TABLE_STEP * (Math.cos(ta) + Math.cos(tb));
      Z[i] = Z[i + 1] - 0.5 * TABLE_STEP * (Math.sin(ta) + Math.sin(tb));
    }
    this.X = X;
    this.Z = Z;
  }

  /** Paper mm → camera-frame 3D point (mm). */
  toCamera(u: number, v: number, out: Float64Array | number[], o = 0) {
    const { surf, c, s, R } = this;
    const du = u - surf.origin[0], dv = v - surf.origin[1];
    const sa = du * c + dv * s;
    const t = -du * s + dv * c;
    const f = (sa - this.sMin) / TABLE_STEP;
    const i = Math.floor(f);
    const last = this.X.length - 2;
    let X: number, Z: number;
    if (i < 0 || i > last) {
      // beyond the table: continue straight along the end tangent
      const edge = i < 0 ? 0 : last + 1;
      const se = this.sMin + edge * TABLE_STEP;
      const th = thetaAt(surf, se);
      X = this.X[edge] + (sa - se) * Math.cos(th);
      Z = this.Z[edge] + (sa - se) * Math.sin(th);
    } else {
      const w = f - i;
      X = this.X[i] * (1 - w) + this.X[i + 1] * w;
      Z = this.Z[i] * (1 - w) + this.Z[i + 1] * w;
    }
    const px = surf.origin[0] + X * c - t * s;
    const py = surf.origin[1] + X * s + t * c;
    const pz = Z;
    out[o] = R[0] * px + R[1] * py + R[2] * pz + surf.tvec[0];
    out[o + 1] = R[3] * px + R[4] * py + R[5] * pz + surf.tvec[1];
    out[o + 2] = R[6] * px + R[7] * py + R[8] * pz + surf.tvec[2];
  }

  /** Paper mm → image px. */
  project(K: Intrinsics, u: number, v: number, out: Float64Array | number[], o = 0): boolean {
    const p = [0, 0, 0];
    this.toCamera(u, v, p);
    return projectCam(K, p[0], p[1], p[2], out, o);
  }
}

export function thetaAt(surf: Surface, s: number): number {
  const th = surf.theta;
  const f = (s - surf.knotS0) / surf.knotStep;
  if (f <= 0) return th[0];
  if (f >= th.length - 1) return th[th.length - 1];
  const i = Math.floor(f);
  const w = f - i;
  return th[i] * (1 - w) + th[i + 1] * w;
}

export interface FitOptions {
  /** Debug/advanced: start from this surface instead of the automatic starts. */
  init?: Surface;
  /** Paper extent used to size the bend profile. */
  paperMm: [number, number];
  knotStepMm?: number;
  /** Weight on smoothness of the bend (px per radian of second difference). */
  smoothness?: number;
  /** Allow a bend at all (false = rigid plane). */
  allowBend?: boolean;
}

/** Fit pose and bend to detected sheet corners. */
export function fitSurface(corr: Correspondence[], K: Intrinsics, opts: FitOptions): FitResult {
  if (corr.length < 8) throw new Error('Not enough sheet corners visible');
  const [W, H] = opts.paperMm;
  const origin: [number, number] = [W / 2, H / 2];

  // Planar initialization from a homography in normalized camera coordinates.
  const norm = corr.map((c) => undistortToNormalized(K, c.x, c.y));
  const Hm = fitHomography(corr.map((c) => [c.u, c.v] as [number, number]), norm);
  const pose = poseFromHomography(Hm);

  let best: FitResult | null = null;
  const phis = opts.allowBend === false ? [0] : [0, Math.PI / 2];
  // Curling up and curling down can look alike in perspective, so start from a few shapes:
  // flat, and a bend toward or away from the camera at either end of the profile.
  const starts = opts.allowBend === false ? [null] : [null, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
  for (const phi0 of opts.init ? [opts.init.phi] : phis) {
    for (const st of opts.init ? [null] : starts) {
      const warm = opts.init ?? (st ? seedSurface(phi0, origin, W, H, opts, st[0], st[1], pose.rvec, pose.tvec) : undefined);
      let pts = corr;
      let res = fitOnce(pts, K, origin, W, H, phi0, warm?.rvec ?? pose.rvec, warm?.tvec ?? pose.tvec, opts, warm);
      // Reject outliers once and refit.
      const errs = residualErrors(res.surface, pts, K, W, H);
      const med = median(errs);
      const thr = Math.max(2.5, med * 4);
      const kept = pts.filter((_, i) => errs[i] <= thr);
      if (kept.length >= 8 && kept.length < pts.length) {
        res = fitOnce(kept, K, origin, W, H, phi0, res.surface.rvec, res.surface.tvec, opts, res.surface);
        res.rejected = pts.length - kept.length;
        pts = kept;
      }
      if (!best || res.rmsPx < best.rmsPx) best = res;
    }
  }
  return best!;
}

function profileLayout(phi0: number, W: number, H: number, opts: FitOptions) {
  const step = opts.knotStepMm ?? 10;
  const ext = Math.abs(Math.cos(phi0)) * W / 2 + Math.abs(Math.sin(phi0)) * H / 2 + 5;
  const nK = Math.max(3, Math.ceil((2 * ext) / step) + 1);
  return { ext, nK, knotS0: -ext, knotStep: (2 * ext) / (nK - 1) };
}

/** A starting bend concentrated at one end of the profile (end = ±1), curling one way (dir = ±1). */
function seedSurface(phi0: number, origin: [number, number], W: number, H: number, opts: FitOptions, end: number, dir: number, rvec: Vec3, tvec: Vec3): Surface {
  const L = profileLayout(phi0, W, H, opts);
  const theta = Array.from({ length: L.nK }, (_, i) => {
    const s = L.knotS0 + i * L.knotStep;
    const d = end > 0 ? L.ext - s : s + L.ext; // distance from the chosen end
    return dir * 0.4 * Math.exp(-d / 25);
  });
  return { rvec, tvec, phi: phi0, origin, knotS0: L.knotS0, knotStep: L.knotStep, theta };
}

function fitOnce(
  corr: Correspondence[], K: Intrinsics, origin: [number, number], W: number, H: number,
  phi0: number, rvec: Vec3, tvec: Vec3, opts: FitOptions, warm?: Surface,
): FitResult {
  const allowBend = opts.allowBend !== false;
  // Bend profile spans the paper along d (both extents from origin).
  const L = profileLayout(phi0, W, H, opts);
  const ext = L.ext;
  const nK = allowBend ? L.nK : 1;
  const knotS0 = L.knotS0;
  const knotStep = nK > 1 ? L.knotStep : 1;
  const theta0 = warm && warm.theta.length === nK ? warm.theta : new Array(nK).fill(0);
  const init = [...rvec, ...tvec, warm?.phi ?? phi0, ...theta0];
  const smooth = opts.smoothness ?? 30;
  const nRes = corr.length * 2 + (allowBend ? Math.max(0, nK - 2) + 2 : 0);

  const toSurface = (p: Float64Array): Surface => ({
    rvec: [p[0], p[1], p[2]], tvec: [p[3], p[4], p[5]], phi: p[6], origin,
    knotS0, knotStep, theta: Array.from(p.subarray(7)),
  });
  const buf = new Float64Array(2);
  const residuals = (p: Float64Array, out: Float64Array) => {
    const surf = toSurface(p);
    const ev = new SurfaceEval(surf, -ext - 5, ext + 5);
    let k = 0;
    for (const c of corr) {
      ev.project(K, c.u, c.v, buf);
      out[k++] = buf[0] - c.x;
      out[k++] = buf[1] - c.y;
    }
    if (allowBend) {
      const th = surf.theta;
      for (let i = 1; i < th.length - 1; i++) out[k++] = smooth * (th[i - 1] - 2 * th[i] + th[i + 1]);
      let mean = 0;
      for (const t of th) mean += t;
      out[k++] = 50 * (mean / th.length); // fixes the rotation/θ-offset gauge
      // The bend axis is only observable once there is a bend; keep it near the sheet edge it started on.
      out[k++] = 30 * (p[6] - phi0);
    }
  };
  const steps = init.map((_, i) => (i < 3 ? 1e-5 : i < 6 ? 1e-3 : 1e-5));
  const fixed = allowBend ? [] : [6];
  const r = levenbergMarquardt(residuals, init, nRes, { maxIter: 400, steps, fixed });
  const surface = toSurface(r.params);
  const errs = residualErrors(surface, corr, K, W, H);
  const rms = Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length);
  return { surface, rmsPx: rms, used: corr.length, rejected: 0 };
}

function residualErrors(surf: Surface, corr: Correspondence[], K: Intrinsics, W: number, H: number): number[] {
  const ev = new SurfaceEval(surf, -Math.hypot(W, H), Math.hypot(W, H));
  const b = [0, 0];
  return corr.map((c) => {
    ev.project(K, c.u, c.v, b);
    return Math.hypot(b[0] - c.x, b[1] - c.y);
  });
}

export function evalFor(surf: Surface, paperMm: [number, number], marginMm = 60): SurfaceEval {
  const r = Math.hypot(paperMm[0], paperMm[1]) / 2 + marginMm;
  return new SurfaceEval(surf, -r, r);
}

/** Maximum lift of the bent profile off the chord between its ends, mm (a rough "curl" figure for the UI). */
export function curlMm(surf: Surface, paperMm: [number, number]): number {
  const [W, H] = paperMm;
  const c = Math.cos(surf.phi), s = Math.sin(surf.phi);
  const ext = Math.abs(c) * W / 2 + Math.abs(s) * H / 2;
  const n = 200, ds = (2 * ext) / n;
  const pts: [number, number][] = [[0, 0]];
  let X = 0, Z = 0;
  for (let i = 1; i <= n; i++) {
    const th = thetaAt(surf, -ext + (i - 0.5) * ds);
    X += ds * Math.cos(th);
    Z += ds * Math.sin(th);
    pts.push([X, Z]);
  }
  const a = pts[0], b = pts[n];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let max = 0;
  for (const q of pts) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - q[1]) - (a[0] - q[0]) * (b[1] - a[1])) / len;
    if (d > max) max = d;
  }
  return max;
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
}
