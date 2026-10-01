// ChArUco detection of the calibration sheet (OpenCV.js).
import { type SheetSpec, cornerMm } from './sheet';
import type { Correspondence } from './surface';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export interface SheetDetection {
  ids: number[];
  /** image px, flattened x,y pairs */
  points: Float32Array;
  markers: number;
  /** Corners dropped because a neighbouring marker was hidden (usually by the page edge). */
  dropped: number;
}

interface Cached {
  key: string;
  board: CV;
  detector: CV;
  /** For each chessboard corner id, the two marker ids of the white cells touching it. */
  cornerMarkers: Int32Array;
  /** Whether the top-left square of the board is black. */
  topLeftBlack: boolean;
}
let cache: Cached | null = null;

export function boardFor(cv: CV, spec: SheetSpec, idOffset = 0): Cached {
  const key = `${spec.cols}x${spec.rows}:${spec.squareMm}:${idOffset}`;
  if (cache?.key === key) return cache;
  if (cache) {
    cache.detector.delete();
    cache.board.delete();
  }
  const dict = cv.getPredefinedDictionary(cv.DICT_5X5_1000);
  const nMarkers = Math.floor((spec.cols * spec.rows) / 2);
  const ids = cv.matFromArray(nMarkers, 1, cv.CV_32S, Array.from({ length: nMarkers }, (_, i) => i + idOffset));
  const board = new cv.aruco_CharucoBoard(new cv.Size(spec.cols, spec.rows), spec.squareMm, spec.markerMm, dict, ids);
  ids.delete();
  const dp = new cv.aruco_DetectorParameters();
  dp.cornerRefinementMethod = cv.CORNER_REFINE_SUBPIX ?? 1;
  const cp = new cv.aruco_CharucoParameters();
  cp.minMarkers = 1;
  cp.tryRefineMarkers = true;
  const detector = new cv.aruco_CharucoDetector(board, cp, dp, new cv.aruco_RefineParameters(10, 3, true));
  const topLeftBlack = boardParity(cv, board, spec);
  cache = { key, board, detector, cornerMarkers: cornerMarkerTable(spec, idOffset, topLeftBlack), topLeftBlack };
  return cache;
}

function boardParity(cv: CV, board: CV, spec: SheetSpec): boolean {
  const px = 40; // markers need at least 7 px across to render
  const img = new cv.Mat();
  board.generateImage(new cv.Size(spec.cols * px, spec.rows * px), img, 0, 1);
  const black = img.data[Math.floor(px / 2) * img.cols + Math.floor(px / 2)] < 128;
  img.delete();
  return black;
}

/** Work out which cells hold markers (the board's colour parity) and map corners to their two markers. */
function cornerMarkerTable(spec: SheetSpec, idOffset: number, topLeftBlack: boolean): Int32Array {
  const isMarkerCell = (c: number, r: number) => ((c + r) % 2 === 0) !== topLeftBlack;
  const cellId = new Int32Array(spec.cols * spec.rows).fill(-1);
  let next = idOffset;
  for (let r = 0; r < spec.rows; r++) for (let c = 0; c < spec.cols; c++) if (isMarkerCell(c, r)) cellId[r * spec.cols + c] = next++;
  const per = spec.cols - 1;
  const n = per * (spec.rows - 1);
  const out = new Int32Array(n * 2);
  for (let id = 0; id < n; id++) {
    const c = id % per, r = Math.floor(id / per);
    const cells = [cellId[r * spec.cols + c], cellId[r * spec.cols + c + 1], cellId[(r + 1) * spec.cols + c], cellId[(r + 1) * spec.cols + c + 1]].filter((x) => x >= 0);
    out[id * 2] = cells[0];
    out[id * 2 + 1] = cells[1];
  }
  return out;
}

/** Detect ChArUco corners in a grayscale (CV_8UC1) or RGBA image Mat. */
export function detectSheet(cv: CV, img: CV, spec: SheetSpec, strict = true): SheetDetection {
  const { detector, cornerMarkers } = boardFor(cv, spec);
  let gray = img;
  let own = false;
  if (img.channels() !== 1) {
    gray = new cv.Mat();
    cv.cvtColor(img, gray, img.channels() === 4 ? cv.COLOR_RGBA2GRAY : cv.COLOR_RGB2GRAY);
    own = true;
  }
  const cc = new cv.Mat(), ci = new cv.Mat(), mc = new cv.MatVector(), mi = new cv.Mat();
  try {
    detector.detectBoard(gray, cc, ci, mc, mi);
    const n = ci.rows;
    const seen = new Set<number>(Array.from(mi.data32S.slice(0, mi.rows)) as number[]);
    const ids: number[] = [];
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const id = ci.data32S[i];
      // A corner next to the page edge is pulled off by the occlusion; both touching markers must be whole.
      if (strict && !(seen.has(cornerMarkers[id * 2]) && seen.has(cornerMarkers[id * 2 + 1]))) continue;
      ids.push(id);
      pts.push(cc.data32F[i * 2], cc.data32F[i * 2 + 1]);
    }
    return { ids, points: new Float32Array(pts), markers: mi.rows, dropped: n - ids.length };
  } finally {
    cc.delete(); ci.delete(); mc.delete(); mi.delete();
    if (own) gray.delete();
  }
}

export function toCorrespondences(det: SheetDetection, spec: SheetSpec, scale = 1): Correspondence[] {
  return det.ids.map((id, i) => {
    const [u, v] = cornerMm(spec, id);
    return { u, v, x: det.points[2 * i] * scale, y: det.points[2 * i + 1] * scale };
  });
}
