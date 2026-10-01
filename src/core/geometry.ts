// Planar homography, pose from homography, and rotation helpers.
import type { Mat3, Vec3 } from './camera';

/** Fit a homography mapping src → dst (least squares, normalized DLT with h33 = 1). */
export function fitHomography(src: [number, number][], dst: [number, number][]): Mat3 {
  const n = src.length;
  if (n < 4) throw new Error('Need at least 4 points');
  const ns = normalizer(src);
  const nd = normalizer(dst);
  const A = new Float64Array(64);
  const b = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    const x = (src[i][0] - ns.cx) * ns.s, y = (src[i][1] - ns.cy) * ns.s;
    const u = (dst[i][0] - nd.cx) * nd.s, v = (dst[i][1] - nd.cy) * nd.s;
    const r1 = [x, y, 1, 0, 0, 0, -u * x, -u * y];
    const r2 = [0, 0, 0, x, y, 1, -v * x, -v * y];
    accumulate(A, b, r1, u);
    accumulate(A, b, r2, v);
  }
  const h = solveDense(A, b, 8);
  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  // Denormalize: H = Nd^-1 * Hn * Ns
  const Ns: Mat3 = [ns.s, 0, -ns.s * ns.cx, 0, ns.s, -ns.s * ns.cy, 0, 0, 1];
  const NdInv: Mat3 = [1 / nd.s, 0, nd.cx, 0, 1 / nd.s, nd.cy, 0, 0, 1];
  const H = mul3(NdInv, mul3(Hn, Ns));
  const k = H[8];
  return H.map((v) => v / k) as Mat3;
}

export function applyH(H: Mat3, x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Pose of a plane (z = 0) from a homography that maps plane mm → normalized camera coords. */
export function poseFromHomography(H: Mat3): { rvec: Vec3; tvec: Vec3 } {
  const h1: Vec3 = [H[0], H[3], H[6]];
  const h2: Vec3 = [H[1], H[4], H[7]];
  const h3: Vec3 = [H[2], H[5], H[8]];
  let lam = 1 / Math.hypot(...h1);
  if (h3[2] * lam < 0) lam = -lam; // plane must be in front of the camera
  const r1 = scale(h1, lam), r2 = scale(h2, lam);
  const t = scale(h3, lam);
  // Orthonormalize r1, r2
  const n1 = normalize(r1);
  const r2o = normalize(sub(r2, scale(n1, dot(n1, r2))));
  const r3 = cross(n1, r2o);
  const R: Mat3 = [n1[0], r2o[0], r3[0], n1[1], r2o[1], r3[1], n1[2], r2o[2], r3[2]];
  return { rvec: rotationToRvec(R), tvec: t };
}

export function rotationToRvec(R: Mat3): Vec3 {
  const tr = R[0] + R[4] + R[8];
  const c = Math.min(1, Math.max(-1, (tr - 1) / 2));
  const th = Math.acos(c);
  if (th < 1e-9) return [0, 0, 0];
  if (Math.PI - th < 1e-6) {
    // 180°: axis from the diagonal
    const x = Math.sqrt(Math.max(0, (R[0] + 1) / 2));
    const y = Math.sqrt(Math.max(0, (R[4] + 1) / 2)) * Math.sign(R[1] || 1);
    const z = Math.sqrt(Math.max(0, (R[8] + 1) / 2)) * Math.sign(R[2] || 1);
    return [x * th, y * th, z * th];
  }
  const k = th / (2 * Math.sin(th));
  return [(R[7] - R[5]) * k, (R[2] - R[6]) * k, (R[3] - R[1]) * k];
}

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

function normalizer(p: [number, number][]) {
  let cx = 0, cy = 0;
  for (const [x, y] of p) { cx += x; cy += y; }
  cx /= p.length; cy /= p.length;
  let d = 0;
  for (const [x, y] of p) d += Math.hypot(x - cx, y - cy);
  d /= p.length;
  return { cx, cy, s: d > 0 ? Math.SQRT2 / d : 1 };
}

function accumulate(A: Float64Array, b: Float64Array, row: number[], rhs: number) {
  for (let i = 0; i < 8; i++) {
    b[i] += row[i] * rhs;
    for (let j = 0; j < 8; j++) A[i * 8 + j] += row[i] * row[j];
  }
}

/** Gaussian elimination with partial pivoting. */
export function solveDense(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const M = Float64Array.from(A);
  const x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[piv * n + c])) piv = r;
    if (piv !== c) {
      for (let k = 0; k < n; k++) [M[c * n + k], M[piv * n + k]] = [M[piv * n + k], M[c * n + k]];
      [x[c], x[piv]] = [x[piv], x[c]];
    }
    const d = M[c * n + c] || 1e-300;
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c] / d;
      if (f === 0) continue;
      for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k];
      x[r] -= f * x[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < n; k++) s -= M[r * n + k] * x[k];
    x[r] = s / (M[r * n + r] || 1e-300);
  }
  return x;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));
