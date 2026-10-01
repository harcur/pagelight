// Pinhole camera with OpenCV's 5-term distortion model (k1, k2, p1, p2, k3).

export interface Intrinsics {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  /** k1, k2, p1, p2, k3 */
  dist: [number, number, number, number, number];
}

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Guess intrinsics when no lens calibration exists: ~66° horizontal field of view, no distortion. */
export function guessIntrinsics(width: number, height: number): Intrinsics {
  const f = Math.max(width, height) * 0.78;
  return { width, height, fx: f, fy: f, cx: width / 2, cy: height / 2, dist: [0, 0, 0, 0, 0] };
}

/** Rescale intrinsics calibrated at one resolution to another with the same aspect ratio. */
export function scaleIntrinsics(k: Intrinsics, width: number, height: number): Intrinsics {
  const sx = width / k.width;
  const sy = height / k.height;
  return { width, height, fx: k.fx * sx, fy: k.fy * sy, cx: k.cx * sx, cy: k.cy * sy, dist: [...k.dist] };
}

export function rodrigues(r: Vec3): Mat3 {
  const th = Math.hypot(r[0], r[1], r[2]);
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const x = r[0] / th, y = r[1] / th, z = r[2] / th;
  const c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  return [
    c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,
  ];
}

/** Project a camera-frame point to distorted pixel coordinates. Writes into out. Returns false behind camera. */
export function projectCam(k: Intrinsics, X: number, Y: number, Z: number, out: Float64Array | number[], o = 0): boolean {
  if (Z <= 1e-9) {
    out[o] = NaN;
    out[o + 1] = NaN;
    return false;
  }
  const x = X / Z, y = Y / Z;
  const [k1, k2, p1, p2, k3] = k.dist;
  const r2 = x * x + y * y;
  const radial = 1 + r2 * (k1 + r2 * (k2 + r2 * k3));
  const xd = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
  const yd = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
  out[o] = k.fx * xd + k.cx;
  out[o + 1] = k.fy * yd + k.cy;
  return true;
}

/** Remove lens distortion from a pixel, returning normalized image coordinates (iterative, like cv::undistortPoints). */
export function undistortToNormalized(k: Intrinsics, u: number, v: number): [number, number] {
  const xd = (u - k.cx) / k.fx, yd = (v - k.cy) / k.fy;
  const [k1, k2, p1, p2, k3] = k.dist;
  let x = xd, y = yd;
  for (let i = 0; i < 20; i++) {
    const r2 = x * x + y * y;
    const radial = 1 + r2 * (k1 + r2 * (k2 + r2 * k3));
    const dx = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
    const dy = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
    x = (xd - dx) / radial;
    y = (yd - dy) / radial;
  }
  return [x, y];
}
