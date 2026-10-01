// Page cleanup: even out lighting, then colour, grey or black-and-white output.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export type OutputMode = 'colour' | 'gray' | 'bw';

export interface CleanOptions {
  mode: OutputMode;
  /** 0–100: how much faint pencil to keep in black-and-white. */
  faint: number;
  /** 0–10: remove specks up to this size (in tenths of a mm, roughly). */
  despeckle: number;
  /** Output px per mm, used to size filters physically. */
  ppm: number;
  /** Divide out uneven lighting (on by default). */
  evenLight?: boolean;
}

export const DEFAULT_CLEAN: Omit<CleanOptions, 'ppm'> = { mode: 'bw', faint: 60, despeckle: 2, evenLight: true };

/** Clean an RGBA page image. Returns a new RGBA Mat; the input is not modified. */
export function cleanPage(cv: CV, rgba: CV, o: CleanOptions): CV {
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  let bg: CV | null = null;
  if (o.evenLight !== false) bg = estimateBackground(cv, gray, o.ppm);
  try {
    if (o.mode === 'colour') {
      const out = rgba.clone();
      if (bg) {
        const ch = new cv.MatVector();
        cv.split(rgba, ch);
        for (let i = 0; i < 3; i++) {
          const c = ch.get(i);
          cv.divide(c, bg, c, 242);
          ch.set(i, c);
          c.delete();
        }
        cv.merge(ch, out);
        ch.delete();
      }
      return out;
    }
    const norm = new cv.Mat();
    if (bg) cv.divide(gray, bg, norm, 242);
    else gray.copyTo(norm);
    if (o.mode === 'gray') {
      const out = new cv.Mat();
      cv.cvtColor(norm, out, cv.COLOR_GRAY2RGBA);
      norm.delete();
      return out;
    }
    const bin = sauvola(cv, norm, o.ppm, o.faint);
    norm.delete();
    if (o.despeckle > 0) despeckle(cv, bin, o.ppm, o.despeckle);
    const out = new cv.Mat();
    cv.cvtColor(bin, out, cv.COLOR_GRAY2RGBA);
    bin.delete();
    return out;
  } finally {
    gray.delete();
    bg?.delete();
  }
}

/** Paper brightness map: close away the ink at low resolution, smooth, scale back up. */
function estimateBackground(cv: CV, gray: CV, ppm: number): CV {
  const f = 4;
  const small = new cv.Mat();
  cv.resize(gray, small, new cv.Size(Math.max(1, Math.round(gray.cols / f)), Math.max(1, Math.round(gray.rows / f))), 0, 0, cv.INTER_AREA);
  // Strokes up to ~4 mm wide disappear under the closing.
  const k = Math.max(3, Math.round((4 * ppm) / f) | 1);
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k));
  cv.morphologyEx(small, small, cv.MORPH_CLOSE, kernel);
  kernel.delete();
  const b = Math.max(3, Math.round((6 * ppm) / f) | 1);
  cv.GaussianBlur(small, small, new cv.Size(b, b), 0);
  const bg = new cv.Mat();
  cv.resize(small, bg, new cv.Size(gray.cols, gray.rows), 0, 0, cv.INTER_LINEAR);
  small.delete();
  return bg;
}

/** Sauvola thresholding; returns CV_8UC1 with ink 0 and paper 255. */
function sauvola(cv: CV, norm: CV, ppm: number, faint: number): CV {
  const w = Math.max(15, Math.round(4 * ppm) | 1); // ~4 mm window
  const k = 0.34 - Math.max(0, Math.min(100, faint)) * 0.0029;
  const f = new cv.Mat();
  norm.convertTo(f, cv.CV_32F);
  const mean = new cv.Mat(), sq = new cv.Mat(), f2 = new cv.Mat();
  cv.multiply(f, f, f2);
  const ks = new cv.Size(w, w);
  cv.boxFilter(f, mean, -1, ks);
  cv.boxFilter(f2, sq, -1, ks);
  f2.delete();
  const n = f.rows * f.cols;
  const out = new cv.Mat(f.rows, f.cols, cv.CV_8UC1);
  const src = f.data32F, m = mean.data32F, s2 = sq.data32F, o = out.data;
  for (let i = 0; i < n; i++) {
    const mu = m[i];
    const sd = Math.sqrt(Math.max(0, s2[i] - mu * mu));
    const t = mu * (1 + k * (sd / 128 - 1));
    o[i] = src[i] <= t && src[i] < 225 ? 0 : 255;
  }
  f.delete(); mean.delete(); sq.delete();
  return out;
}

/** Remove isolated ink specks smaller than the given size. */
function despeckle(cv: CV, bin: CV, ppm: number, level: number) {
  const diam = level * 0.08 * ppm; // px
  const minArea = Math.max(1, Math.round(diam * diam));
  const inv = new cv.Mat();
  cv.bitwise_not(bin, inv);
  const labels = new cv.Mat(), stats = new cv.Mat(), cent = new cv.Mat();
  const nLab = cv.connectedComponentsWithStats(inv, labels, stats, cent, 8, cv.CV_32S);
  const kill = new Uint8Array(nLab);
  const st = stats.data32S;
  for (let l = 1; l < nLab; l++) if (st[l * 5 + 4] < minArea) kill[l] = 1;
  const lab = labels.data32S, o = bin.data;
  for (let i = 0; i < lab.length; i++) if (kill[lab[i]]) o[i] = 255;
  [inv, labels, stats, cent].forEach((m) => m.delete());
}
