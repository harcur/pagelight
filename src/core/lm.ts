// Small dense Levenberg–Marquardt solver with a numeric Jacobian.
// Problems here have tens of parameters and a few thousand residuals, so dense is fine.

export interface LmOptions {
  maxIter?: number;
  /** Relative cost decrease below which we stop. */
  tol?: number;
  /** Per-parameter finite-difference step. */
  steps?: number[];
  /** Parameters held fixed (by index). */
  fixed?: number[];
}

export interface LmResult {
  params: Float64Array;
  cost: number;
  iterations: number;
}

export function levenbergMarquardt(
  residuals: (p: Float64Array, out: Float64Array) => void,
  initial: ArrayLike<number>,
  nRes: number,
  opts: LmOptions = {},
): LmResult {
  const n = initial.length;
  const maxIter = opts.maxIter ?? 60;
  const tol = opts.tol ?? 1e-9;
  const fixed = new Set(opts.fixed ?? []);
  const free: number[] = [];
  for (let i = 0; i < n; i++) if (!fixed.has(i)) free.push(i);
  const m = free.length;

  let p = Float64Array.from(initial);
  const r = new Float64Array(nRes);
  const rTry = new Float64Array(nRes);
  const J = new Float64Array(nRes * m);
  const JtJ = new Float64Array(m * m);
  const Jtr = new Float64Array(m);
  const trial = new Float64Array(n);

  residuals(p, r);
  let cost = sumSq(r);
  let lambda = 1e-3;
  let it = 0;

  for (; it < maxIter; it++) {
    // Numeric Jacobian (forward differences).
    for (let c = 0; c < m; c++) {
      const j = free[c];
      const h = opts.steps?.[j] ?? Math.max(1e-6, Math.abs(p[j]) * 1e-6);
      const saved = p[j];
      p[j] = saved + h;
      residuals(p, rTry);
      p[j] = saved;
      for (let i = 0; i < nRes; i++) J[i * m + c] = (rTry[i] - r[i]) / h;
    }
    JtJ.fill(0);
    Jtr.fill(0);
    for (let i = 0; i < nRes; i++) {
      const ri = r[i];
      if (!Number.isFinite(ri)) continue;
      const row = i * m;
      for (let a = 0; a < m; a++) {
        const ja = J[row + a];
        if (ja === 0) continue;
        Jtr[a] += ja * ri;
        for (let b = a; b < m; b++) JtJ[a * m + b] += ja * J[row + b];
      }
    }
    for (let a = 0; a < m; a++) for (let b = 0; b < a; b++) JtJ[a * m + b] = JtJ[b * m + a];

    let improved = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const A = Float64Array.from(JtJ);
      for (let a = 0; a < m; a++) A[a * m + a] += lambda * (JtJ[a * m + a] + 1e-12);
      const delta = solveSym(A, Jtr.map((v) => -v), m);
      if (!delta) {
        lambda *= 10;
        continue;
      }
      trial.set(p);
      for (let c = 0; c < m; c++) trial[free[c]] += delta[c];
      residuals(trial, rTry);
      const tc = sumSq(rTry);
      if (tc < cost) {
        const rel = (cost - tc) / Math.max(cost, 1e-30);
        p = Float64Array.from(trial);
        r.set(rTry);
        cost = tc;
        lambda = Math.max(lambda / 3, 1e-9);
        improved = true;
        if (rel < tol) return { params: p, cost, iterations: it + 1 };
        break;
      }
      lambda *= 8;
    }
    if (!improved) break;
  }
  return { params: p, cost, iterations: it };
}

function sumSq(r: Float64Array): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const v = r[i];
    s += Number.isFinite(v) ? v * v : 1e12;
  }
  return s;
}

/** Solve symmetric positive definite system via Cholesky; returns null if not SPD. */
function solveSym(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (s <= 0) return null;
        L[i * n + i] = Math.sqrt(s);
      } else {
        L[i * n + j] = s / L[j * n + j];
      }
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}
