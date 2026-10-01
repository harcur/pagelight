// Find the page on the flattened sheet.
//
// After unrolling, the checkerboard sits at known positions. Black squares that
// read bright are covered by the page. Each visible page edge crosses a row of
// black squares; inside those squares the dark→bright step is the edge itself,
// which gives sub-millimetre edge lines. The spine side has no sheet showing, so
// there we look for the gutter shadow instead.

import type { SheetSpec } from './sheet';
import type { PaperFrame } from './flatten';

export interface GrayImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** A flattened view of the paper: pixel (x, y) ↔ paper mm (u0 + x/ppm, v0 + y/ppm). */
export interface FlatView extends GrayImage {
  u0: number;
  v0: number;
  ppm: number;
}

export type SideSource = 'sheet' | 'gutter' | 'fallback';

export interface Line {
  /** Point on the line and unit direction, paper mm. */
  p: [number, number];
  d: [number, number];
}

export interface PageFind {
  /** Corners in paper mm: top-left, top-right, bottom-right, bottom-left (paper orientation). */
  corners: [number, number][];
  /** How each side was found: top, right, bottom, left (paper orientation). */
  sources: [SideSource, SideSource, SideSource, SideSource];
  /** Which paper side the spine is on, if one side had no sheet showing. */
  spine: 'top' | 'right' | 'bottom' | 'left' | null;
  coveredCells: number;
}

export function findPage(view: FlatView, spec: SheetSpec, topLeftBlack: boolean): PageFind | null {
  const s = spec.printScale;
  const sq = spec.squareMm * s;
  const ox = spec.originX * s, oy = spec.originY * s;
  const at = (u: number, v: number): number => {
    const x = Math.round((u - view.u0) * view.ppm), y = Math.round((v - view.v0) * view.ppm);
    if (x < 0 || y < 0 || x >= view.width || y >= view.height) return -1;
    return view.data[y * view.width + x];
  };
  const cellMean = (c: number, r: number): number => {
    let sum = 0, n = 0;
    const step = 1 / view.ppm;
    for (let v = oy + (r + 0.2) * sq; v <= oy + (r + 0.8) * sq; v += step)
      for (let u = ox + (c + 0.2) * sq; u <= ox + (c + 0.8) * sq; u += step) {
        const val = at(u, v);
        if (val >= 0) { sum += val; n++; }
      }
    return n ? sum / n : -1;
  };
  const isBlack = (c: number, r: number) => ((c + r) % 2 === 0) === topLeftBlack;

  // 1. Classify black cells.
  const means = new Float32Array(spec.cols * spec.rows).fill(-1);
  const blackVals: number[] = [];
  for (let r = 0; r < spec.rows; r++) for (let c = 0; c < spec.cols; c++) {
    if (!isBlack(c, r)) continue;
    const m = cellMean(c, r);
    means[r * spec.cols + c] = m;
    if (m >= 0) blackVals.push(m);
  }
  if (blackVals.length < 8) return null;
  blackVals.sort((a, b) => a - b);
  const dark = blackVals[Math.floor(blackVals.length * 0.1)];
  const all = Array.from(view.data).filter((_, i) => i % 7 === 0).sort((a, b) => a - b);
  const bright = all[Math.floor(all.length * 0.95)];
  const thr = (dark + bright) / 2;
  const covered = new Uint8Array(spec.cols * spec.rows);
  let nCovered = 0;
  for (let i = 0; i < means.length; i++) if (means[i] > thr) { covered[i] = 1; nCovered++; }
  if (nCovered < 2) return null;

  // 2. Largest diagonal-connected group of covered black cells.
  const label = new Int32Array(covered.length).fill(-1);
  let bestLabel = -1, bestSize = 0, next = 0;
  for (let i = 0; i < covered.length; i++) {
    if (!covered[i] || label[i] >= 0) continue;
    const stack = [i];
    label[i] = next;
    let size = 0;
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      const c = k % spec.cols, r = Math.floor(k / spec.cols);
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        if (Math.abs(dr) + Math.abs(dc) !== 2 && !(Math.abs(dr) === 2 && dc === 0) && !(Math.abs(dc) === 2 && dr === 0)) continue;
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= spec.cols || rr >= spec.rows) continue;
        const kk = rr * spec.cols + cc;
        if (covered[kk] && label[kk] < 0) { label[kk] = next; stack.push(kk); }
      }
    }
    if (size > bestSize) { bestSize = size; bestLabel = next; }
    next++;
  }
  let cMin = Infinity, cMax = -Infinity, rMin = Infinity, rMax = -Infinity;
  for (let i = 0; i < label.length; i++) if (label[i] === bestLabel) {
    const c = i % spec.cols, r = Math.floor(i / spec.cols);
    cMin = Math.min(cMin, c); cMax = Math.max(cMax, c); rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
  }
  // Coarse page box in mm (a covered black cell means the page reaches at least across it).
  const box = { u0: ox + cMin * sq, u1: ox + (cMax + 1) * sq, v0: oy + rMin * sq, v1: oy + (rMax + 1) * sq };
  // A side is open (no sheet beyond it) if the covered area runs to the board's edge.
  const open = { top: rMin <= 1, bottom: rMax >= spec.rows - 2, left: cMin <= 1, right: cMax >= spec.cols - 2 };

  // 3. Edge points from partially covered black cells.
  // Typical page paper brightness: median over the middle of the coarse page box.
  const inner: number[] = [];
  for (let v = box.v0 + (box.v1 - box.v0) * 0.2; v < box.v1 - (box.v1 - box.v0) * 0.2; v += 2)
    for (let u = box.u0 + (box.u1 - box.u0) * 0.2; u < box.u1 - (box.u1 - box.u0) * 0.2; u += 2) {
      const val = at(u, v);
      if (val >= 0) inner.push(val);
    }
  inner.sort((a, b) => a - b);
  const pageLevel = inner.length ? inner[Math.floor(inner.length / 2)] : bright;
  const tEdge = (dark + pageLevel) / 2;
  const edgeOnScan = (fixed: number, from: number, to: number, horizontal: boolean): number | null => {
    // Walk from outside (from) toward the page (to). The page edge is the dark→bright step inside a
    // black square with checker darkness before it and page brightness after it, within that square.
    // (Lines in the drawing also make dark→bright steps, but not with a dark square in front of them.)
    const dir = Math.sign(to - from);
    const step = dir / view.ppm;
    const sample = (t: number) => (horizontal ? at(t, fixed) : at(fixed, t));
    let prev = -1;
    for (let t = from; dir > 0 ? t <= to : t >= to; t += step) {
      const val = sample(t);
      if (val < 0) { prev = -1; continue; }
      if (prev >= 0 && prev < tEdge && val >= tEdge) {
        const tc = t - step * ((val - tEdge) / Math.max(1, val - prev));
        const u = horizontal ? tc : fixed, v = horizontal ? fixed : tc;
        const c = Math.floor((u - ox) / sq), r = Math.floor((v - oy) / sq);
        if (c >= 0 && r >= 0 && c < spec.cols && r < spec.rows && isBlack(c, r)) {
          const cellStart = horizontal ? ox + c * sq : oy + r * sq;
          const a = dir > 0 ? cellStart : cellStart + sq; // where the square begins on this walk
          const b = dir > 0 ? cellStart + sq : cellStart;
          const before = fracBelow(sample, a, tc, dir, tEdge);
          const after = 1 - fracBelow(sample, tc, b, dir, tEdge);
          const along = Math.abs(tc - a) / sq;
          if (along > 0.05 && along < 0.95 && before > 0.75 && after > 0.75) return tc;
        }
      }
      prev = val;
    }
    return null;
  };
  const fracBelow = (sample: (t: number) => number, a: number, b: number, dir: number, thr: number): number => {
    let n = 0, below = 0;
    const step = dir / view.ppm;
    for (let t = a + step / 2; dir > 0 ? t < b : t > b; t += step) {
      const val = sample(t);
      if (val < 0) continue;
      n++;
      if (val < thr) below++;
    }
    return n ? below / n : 0;
  };
  const fitSide = (side: 'top' | 'bottom' | 'left' | 'right'): Line | null => {
    const pts: [number, number][] = [];
    const horizontalEdge = side === 'top' || side === 'bottom';
    const lo = horizontalEdge ? box.u0 + sq : box.v0 + sq;
    const hi = horizontalEdge ? box.u1 - sq : box.v1 - sq;
    for (let f = lo; f <= hi; f += 0.5) {
      let e: number | null = null;
      if (side === 'top') e = edgeOnScan(f, box.v0 - 2 * sq, box.v0 + 1.5 * sq, false);
      if (side === 'bottom') e = edgeOnScan(f, box.v1 + 2 * sq, box.v1 - 1.5 * sq, false);
      if (side === 'left') e = edgeOnScan(f, box.u0 - 2 * sq, box.u0 + 1.5 * sq, true);
      if (side === 'right') e = edgeOnScan(f, box.u1 + 2 * sq, box.u1 - 1.5 * sq, true);
      if (e !== null) pts.push(horizontalEdge ? [f, e] : [e, f]);
    }
    return fitLineRobust(pts, horizontalEdge);
  };
  const gutterSide = (side: 'top' | 'bottom' | 'left' | 'right'): Line | null => {
    // Median over scan lines of where brightness falls into the gutter shadow.
    const horizontalEdge = side === 'top' || side === 'bottom';
    const hits: number[] = [];
    const a0 = horizontalEdge ? box.u0 + (box.u1 - box.u0) * 0.25 : box.v0 + (box.v1 - box.v0) * 0.25;
    const a1 = horizontalEdge ? box.u1 - (box.u1 - box.u0) * 0.25 : box.v1 - (box.v1 - box.v0) * 0.25;
    for (let f = a0; f <= a1; f += 1) {
      const start = side === 'top' ? box.v0 + sq : side === 'bottom' ? box.v1 - sq : side === 'left' ? box.u0 + sq : box.u1 - sq;
      const dir = side === 'top' || side === 'left' ? -1 : 1;
      let hit: number | null = null;
      // A 3 mm running mean ignores thin drawn lines; the gutter shadow is a sustained drop.
      const win: number[] = [];
      const winLen = Math.max(3, Math.round(3 * view.ppm));
      let sum = 0;
      for (let t = start; Math.abs(t - start) < 70; t += dir / view.ppm) {
        const val = horizontalEdge ? at(f, t) : at(t, f);
        if (val < 0) break;
        win.push(val);
        sum += val;
        if (win.length > winLen) sum -= win.shift()!;
        if (win.length === winLen && sum / winLen < pageLevel * 0.85) { hit = t - (dir * winLen) / (2 * view.ppm); break; }
      }
      if (hit !== null) hits.push(hit);
    }
    if (hits.length < 5) return null;
    hits.sort((x, y) => x - y);
    const m = hits[Math.floor(hits.length / 2)];
    return horizontalEdge ? { p: [0, m], d: [1, 0] } : { p: [m, 0], d: [0, 1] };
  };

  const sides = ['top', 'right', 'bottom', 'left'] as const;
  const lines: Line[] = [];
  const sources: SideSource[] = [];
  let spine: PageFind['spine'] = null;
  for (const side of sides) {
    let line: Line | null = null;
    let src: SideSource = 'sheet';
    if (!open[side]) line = fitSide(side);
    if (!line && open[side]) {
      line = gutterSide(side);
      src = 'gutter';
      spine = side;
    }
    if (!line) {
      src = 'fallback';
      const paperEdge = side === 'top' ? 0 : side === 'bottom' ? spec.heightMm * s : side === 'left' ? 0 : spec.widthMm * s;
      const bx = side === 'top' ? box.v0 : side === 'bottom' ? box.v1 : side === 'left' ? box.u0 : box.u1;
      const m = open[side] ? paperEdge : bx;
      line = side === 'top' || side === 'bottom' ? { p: [0, m], d: [1, 0] } : { p: [m, 0], d: [0, 1] };
    }
    lines.push(line);
    sources.push(src);
  }
  const [top, right, bottom, left] = lines;
  const corners = [intersect(top, left), intersect(top, right), intersect(bottom, right), intersect(bottom, left)];
  if (corners.some((c) => !c)) return null;
  return { corners: corners as [number, number][], sources: sources as PageFind['sources'], spine, coveredCells: bestSize };
}

function fitLineRobust(pts: [number, number][], horizontal: boolean): Line | null {
  let use = pts;
  for (let iter = 0; iter < 4; iter++) {
    if (use.length < 6) return null;
    // Fit v = a + b u (horizontal) or u = a + b v (vertical) by least squares.
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [u, v] of use) {
      const x = horizontal ? u : v, y = horizontal ? v : u;
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const n = use.length;
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
    const a = (sy - b * sx) / n;
    const res = use.map(([u, v]) => Math.abs((horizontal ? v : u) - (a + b * (horizontal ? u : v))));
    const sorted = [...res].sort((x, y) => x - y);
    const lim = Math.max(0.3, sorted[Math.floor(sorted.length * 0.5)] * 3);
    const kept = use.filter((_, i) => res[i] <= lim);
    if (kept.length === use.length || iter === 3) {
      const len = Math.hypot(1, b);
      return horizontal ? { p: [0, a], d: [1 / len, b / len] } : { p: [a, 0], d: [b / len, 1 / len] };
    }
    use = kept;
  }
  return null;
}

function intersect(a: Line, b: Line): [number, number] | null {
  const den = a.d[0] * b.d[1] - a.d[1] * b.d[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / den;
  return [a.p[0] + t * a.d[0], a.p[1] + t * a.d[1]];
}

/**
 * Frame for the output image from the page corners, with `upSide` (0 = paper top,
 * 1 = right, 2 = bottom, 3 = left) at the top of the output.
 */
export function pageFrame(corners: [number, number][], upSide = 0): PaperFrame {
  // Rotate corner order so that corners[0..1] is the top edge in output orientation.
  const c = [0, 1, 2, 3].map((i) => corners[(i + upSide) % 4]);
  const [tl, tr, br, bl] = c;
  const topLen = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
  const botLen = Math.hypot(br[0] - bl[0], br[1] - bl[1]);
  const leftLen = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
  const rightLen = Math.hypot(br[0] - tr[0], br[1] - tr[1]);
  const ex: [number, number] = [(tr[0] - tl[0] + br[0] - bl[0]) / 2, (tr[1] - tl[1] + br[1] - bl[1]) / 2];
  const el = Math.hypot(ex[0], ex[1]);
  ex[0] /= el; ex[1] /= el;
  const ey: [number, number] = [-ex[1], ex[0]];
  return { origin: tl, ex, ey, widthMm: (topLen + botLen) / 2, heightMm: (leftLen + rightLen) / 2 };
}
