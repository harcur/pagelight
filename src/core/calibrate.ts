// Lens calibration from several views of the flat calibration sheet.
import type { Intrinsics } from './camera';
import { fitHomography } from './geometry';
import { type SheetSpec, cornerMm } from './sheet';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export interface CalibView {
  ids: number[];
  points: Float32Array;
}

export interface Calibration {
  intrinsics: Intrinsics;
  rmsPx: number;
  views: number;
  date: string;
}

export const VIEWS_NEEDED = 15;

export function solveCalibration(cv: CV, views: CalibView[], spec: SheetSpec, width: number, height: number): Calibration {
  const usable = views.filter((v) => v.ids.length >= 12);
  if (usable.length < 4) throw new Error('Not enough views of the sheet');
  const obj = new cv.MatVector(), img = new cv.MatVector();
  for (const v of usable) {
    const o: number[] = [], p: number[] = [];
    v.ids.forEach((id, i) => {
      const [u, w] = cornerMm(spec, id);
      o.push(u, w, 0);
      p.push(v.points[2 * i], v.points[2 * i + 1]);
    });
    const om = cv.matFromArray(v.ids.length, 1, cv.CV_32FC3, o);
    const pm = cv.matFromArray(v.ids.length, 1, cv.CV_32FC2, p);
    obj.push_back(om);
    img.push_back(pm);
    om.delete();
    pm.delete();
  }
  const f0 = Math.max(width, height) * 0.8;
  const K = cv.matFromArray(3, 3, cv.CV_64F, [f0, 0, width / 2, 0, f0, height / 2, 0, 0, 1]);
  const D = cv.Mat.zeros(5, 1, cv.CV_64F);
  const rv = new cv.MatVector(), tv = new cv.MatVector();
  const sdI = new cv.Mat(), sdE = new cv.Mat(), pve = new cv.Mat();
  // Estimate k3 only with plenty of views; it overfits otherwise.
  const flags = cv.CALIB_USE_INTRINSIC_GUESS | (usable.length < 12 ? cv.CALIB_FIX_K3 : 0);
  const crit = new cv.TermCriteria(cv.TermCriteria_COUNT + cv.TermCriteria_EPS, 60, 1e-9);
  try {
    const rms = cv.calibrateCameraExtended(obj, img, new cv.Size(width, height), K, D, rv, tv, sdI, sdE, pve, flags, crit);
    const k = K.data64F, d = D.data64F;
    return {
      intrinsics: { width, height, fx: k[0], fy: k[4], cx: k[2], cy: k[5], dist: [d[0], d[1], d[2], d[3], d[4]] },
      rmsPx: rms,
      views: usable.length,
      date: new Date().toISOString(),
    };
  } finally {
    [obj, img, K, D, rv, tv, sdI, sdE, pve].forEach((m) => m.delete());
  }
}

/** Grade shown to the user. */
export function calibrationGrade(rmsPx: number): 'good' | 'ok' | 'redo' {
  return rmsPx < 0.6 ? 'good' : rmsPx < 1.2 ? 'ok' : 'redo';
}

/**
 * Coverage bookkeeping for the calibration wizard: which thirds of the frame the
 * sheet has been seen in, and which tilt directions.
 */
export interface Coverage {
  regions: boolean[]; // 3×3, row-major
  tilts: { left: boolean; right: boolean; up: boolean; down: boolean };
}

export function emptyCoverage(): Coverage {
  return { regions: new Array(9).fill(false), tilts: { left: false, right: false, up: false, down: false } };
}

/** What a new view adds; also used to decide whether an auto-capture is worth taking. */
export function viewContribution(view: CalibView, spec: SheetSpec, width: number, height: number): { regions: number[]; tilt: keyof Coverage['tilts'] | null } {
  const regions = new Set<number>();
  for (let i = 0; i < view.ids.length; i++) {
    const x = view.points[2 * i] / width, y = view.points[2 * i + 1] / height;
    regions.add(Math.min(2, Math.floor(y * 3)) * 3 + Math.min(2, Math.floor(x * 3)));
  }
  // Tilt: compare local magnification (px per mm², from the homography) at opposite sides of the view.
  let tilt: keyof Coverage['tilts'] | null = null;
  if (view.ids.length >= 8) {
    const src = view.ids.map((id) => cornerMm(spec, id));
    const dst = view.ids.map((_, i) => [view.points[2 * i], view.points[2 * i + 1]] as [number, number]);
    const H = fitHomography(src, dst);
    const mag = (u: number, v: number) => {
      const w = H[6] * u + H[7] * v + H[8];
      const x = (H[0] * u + H[1] * v + H[2]) / w, y = (H[3] * u + H[4] * v + H[5]) / w;
      const a = (H[0] - H[6] * x) / w, b = (H[1] - H[7] * x) / w, c = (H[3] - H[6] * y) / w, d = (H[4] - H[7] * y) / w;
      return Math.abs(a * d - b * c);
    };
    const byX = dst.map((p, i) => [p[0], i] as const).sort((p, q) => p[0] - q[0]);
    const byY = dst.map((p, i) => [p[1], i] as const).sort((p, q) => p[0] - q[0]);
    const mL = mag(...src[byX[0][1]]), mR = mag(...src[byX[byX.length - 1][1]]);
    const mT = mag(...src[byY[0][1]]), mB = mag(...src[byY[byY.length - 1][1]]);
    const rx = Math.log(mR / mL), ry = Math.log(mB / mT);
    const limit = 0.25; // ~28 % size change across the sheet
    if (Math.max(Math.abs(rx), Math.abs(ry)) > limit) {
      if (Math.abs(rx) > Math.abs(ry)) tilt = rx > 0 ? 'left' : 'right';
      else tilt = ry > 0 ? 'up' : 'down';
    }
  }
  return { regions: [...regions], tilt };
}

export function addCoverage(c: Coverage, contrib: ReturnType<typeof viewContribution>): Coverage {
  const regions = [...c.regions];
  for (const r of contrib.regions) regions[r] = true;
  const tilts = { ...c.tilts };
  if (contrib.tilt) tilts[contrib.tilt] = true;
  return { regions, tilts };
}

export function nextHint(c: Coverage): string {
  const names = ['top left', 'top', 'top right', 'left', 'middle', 'right', 'bottom left', 'bottom', 'bottom right'];
  const missing = c.regions.findIndex((r) => !r);
  if (missing >= 0) return `Move the sheet to the ${names[missing]} of the frame`;
  const t = (Object.keys(c.tilts) as (keyof Coverage['tilts'])[]).find((k) => !c.tilts[k]);
  if (t) return `Tilt the sheet so its ${t === 'left' ? 'left' : t === 'right' ? 'right' : t === 'up' ? 'top' : 'bottom'} edge is further away`;
  return 'Keep going — vary distance and angle';
}
