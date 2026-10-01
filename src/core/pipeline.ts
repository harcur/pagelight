// Capture processing: photo → sheet corners → surface → page → flat page image.
import type { Intrinsics } from './camera';
import { boardFor, detectSheet, toCorrespondences } from './detect';
import { type PaperFrame, axisFrame, flattenImage, nativePpm } from './flatten';
import { type PageFind, findPage, pageFrame } from './pagefind';
import { type SheetSpec, paperSizeMm } from './sheet';
import { type FitResult, type Surface, curlMm, evalFor, fitSurface } from './surface';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export interface Analysis {
  fit: FitResult;
  corners: number;
  page: PageFind | null;
  frame: PaperFrame;
  /** Output resolution, px per mm. */
  ppm: number;
  curlMm: number;
  warnings: string[];
}

export const MAX_PPM = 20; // ~500 ppi; beyond this phone cameras resolve nothing extra
const VIEW_PPM = 4;

/** Detect the sheet, fit the surface and find the page. `gray` is a CV_8UC1 Mat of the photo. */
export function analyse(cv: CV, gray: CV, spec: SheetSpec, K: Intrinsics): Analysis {
  const det = detectSheet(cv, gray, spec);
  const corr = toCorrespondences(det, spec);
  if (corr.length < 12) throw new Error('Calibration sheet not found. Make sure it sticks out around the page.');
  const paper = paperSizeMm(spec);
  const fit = fitSurface(corr, K, { paperMm: paper });
  const warnings: string[] = [];
  if (fit.rmsPx > 2) warnings.push('The sheet fit is loose. Check that the sheet lies flat under the page.');

  // Low-resolution flat view of the whole paper plus a margin, to find the page.
  const m = 45;
  const viewFrame = axisFrame(-m, -m, paper[0] + m, paper[1] + m);
  const view = flattenImage(cv, gray, fit.surface, K, paper, viewFrame, VIEW_PPM);
  const page = findPage({ data: view.data, width: view.cols, height: view.rows, u0: -m, v0: -m, ppm: VIEW_PPM }, spec, boardFor(cv, spec).topLeftBlack);
  view.delete();

  let frame: PaperFrame;
  if (page) {
    frame = pageFrame(page.corners, upSideInPhoto(fit.surface, K, paper, page.corners));
    if (page.sources.includes('fallback')) warnings.push('One page edge could not be found. Check the edges before keeping this page.');
    if (page.spine) {
      const spineReach = spineCoverage(corr, spec, page.spine);
      if (spineReach > 25) warnings.push('The sheet does not reach the spine. Push it in further for a better gutter.');
    }
  } else {
    warnings.push('Page not found on the sheet. Adjust the edges by hand.');
    frame = pageFrame([[20, 20], [paper[0] - 20, 20], [paper[0] - 20, paper[1] - 20], [20, paper[1] - 20]]);
  }
  const ppm = Math.min(MAX_PPM, Math.max(3, nativePpm(fit.surface, K, paper, frame)));
  return { fit, corners: corr.length, page, frame, ppm, curlMm: curlMm(fit.surface, paper), warnings };
}

/** Render the flat page. `src` may be RGBA or gray. */
export function renderPage(cv: CV, src: CV, spec: SheetSpec, K: Intrinsics, surface: Surface, frame: PaperFrame, ppm: number, onProgress?: (f: number) => void): CV {
  return flattenImage(cv, src, surface, K, paperSizeMm(spec), frame, ppm, onProgress);
}

/** Which paper side (0 top, 1 right, 2 bottom, 3 left) appears highest in the photo. */
function upSideInPhoto(surf: Surface, K: Intrinsics, paper: [number, number], c: [number, number][]): number {
  const ev = evalFor(surf, paper, 200);
  const b = [0, 0];
  let best = 0, bestY = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = c[i], d = c[(i + 1) % 4];
    ev.project(K, (a[0] + d[0]) / 2, (a[1] + d[1]) / 2, b);
    if (b[1] < bestY) { bestY = b[1]; best = i; }
  }
  return best;
}

/** Distance (mm) from the spine-side paper edge to the nearest detected corner. */
function spineCoverage(corr: { u: number; v: number }[], spec: SheetSpec, side: 'top' | 'right' | 'bottom' | 'left'): number {
  const W = spec.widthMm * spec.printScale, H = spec.heightMm * spec.printScale;
  const d = corr.map((c) => (side === 'left' ? c.u : side === 'right' ? W - c.u : side === 'top' ? c.v : H - c.v));
  return Math.min(...d);
}
