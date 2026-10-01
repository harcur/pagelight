/// <reference lib="webworker" />
// OpenCV worker. All image work happens here so the page stays responsive.
import cvModule from '@techstark/opencv-js';
import { type Intrinsics, guessIntrinsics, scaleIntrinsics } from '../core/camera';
import { solveCalibration } from '../core/calibrate';
import { cleanPage } from '../core/cleanup';
import { boardFor, detectSheet } from '../core/detect';
import { axisFrame, flattenImage } from '../core/flatten';
import { findPageQuad, flattenQuad, quadPpm } from '../core/manual';
import { pageFrame } from '../core/pagefind';
import { pagesPdf, sheetPdf, sheetRects } from '../core/pdf';
import { MAX_PPM, analyse } from '../core/pipeline';
import { paperSizeMm } from '../core/sheet';
import type { PageGeometry, Request, WorkerMessage } from './protocol';

declare const self: DedicatedWorkerGlobalScope;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cv: any = null;

async function loadCv() {
  if (cv) return cv;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let m: any = cvModule;
  if (m instanceof Promise) m = await m;
  else if (!m.Mat) await new Promise<void>((r) => (m.onRuntimeInitialized = () => r()));
  if (typeof m.then === 'function') delete m.then;
  cv = m;
  return cv;
}

// Small caches: decoded photos and unrolled (pre-cleanup) pages, keyed by page.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const photos = new Map<string, any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const flats = new Map<string, { key: string; mat: any }>();
const LIMIT = 2;

function remember<T extends { delete?: () => void } | { mat: { delete: () => void } }>(map: Map<string, T>, key: string, val: T) {
  map.delete(key);
  map.set(key, val);
  while (map.size > LIMIT) {
    const [k, v] = map.entries().next().value as [string, T];
    if ('mat' in v) v.mat.delete();
    else (v as { delete: () => void }).delete();
    map.delete(k);
  }
}

async function bitmapToMat(bmp: ImageBitmap) {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const data = g.getImageData(0, 0, bmp.width, bmp.height);
  return cv.matFromImageData(data);
}

async function photoMat(pageId: string, photo: Blob | ImageBitmap) {
  const cached = photos.get(pageId);
  if (cached) return cached;
  const bmp = photo instanceof Blob ? await createImageBitmap(photo) : photo;
  const mat = await bitmapToMat(bmp);
  if (photo instanceof Blob) bmp.close();
  remember(photos, pageId, mat);
  return mat;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matToImageData(mat: any): ImageData {
  let rgba = mat;
  if (mat.channels() === 1) {
    rgba = new cv.Mat();
    cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
  }
  const out = new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);
  if (rgba !== mat) rgba.delete();
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function encode(mat: any, type: 'image/png' | 'image/jpeg', quality = 0.92): Promise<Blob> {
  const id = matToImageData(mat);
  const c = new OffscreenCanvas(id.width, id.height);
  c.getContext('2d')!.putImageData(id, 0, 0);
  return c.convertToBlob({ type, quality });
}

function kFor(K: Intrinsics, w: number, h: number): Intrinsics {
  if (K.width === w && K.height === h) return K;
  if (Math.abs(K.width / K.height - w / h) < 0.01) return scaleIntrinsics(K, w, h);
  if (Math.abs(K.width / K.height - h / w) < 0.01) return guessIntrinsics(w, h); // rotated photo: calibration doesn't apply
  return guessIntrinsics(w, h);
}

/** Unrolled page (before cleanup, before rotation) at the given ppm. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function flatPage(pageId: string, photo: Blob, g: PageGeometry, ppm: number, progress?: (f: number) => void): Promise<any> {
  const key = JSON.stringify([g.kind, g.corners, g.quad, g.widthMm, g.heightMm, g.upSide, ppm.toFixed(3)]);
  const hit = flats.get(pageId);
  if (hit && hit.key === key) return hit.mat;
  const src = await photoMat(pageId, photo);
  const K = kFor(g.K, src.cols, src.rows);
  let mat;
  if (g.kind === 'sheet') {
    mat = flattenImage(cv, src, g.surface!, K, paperSizeMm(g.spec!), g.frame!, ppm, progress);
  } else {
    mat = flattenQuad(cv, src, K, g.quad!, g.widthMm, g.heightMm, ppm);
  }
  remember(flats, pageId, { key, mat });
  return mat;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rotated(mat: any, q: number) {
  const t = ((q % 4) + 4) % 4;
  if (t === 0) return mat.clone();
  const out = new cv.Mat();
  cv.rotate(mat, out, t === 1 ? cv.ROTATE_90_CLOCKWISE : t === 2 ? cv.ROTATE_180 : cv.ROTATE_90_COUNTERCLOCKWISE);
  return out;
}

async function handle(req: Request, progress: (f: number, note?: string) => void): Promise<[unknown, Transferable[]]> {
  await loadCv();
  switch (req.op) {
    case 'init':
      return [{ version: cv.getBuildInformation().match(/Version control:\s+(\S+)/)?.[1] ?? '?' }, []];

    case 'detectLive': {
      const mat = await bitmapToMat(req.bitmap);
      const w = req.bitmap.width, h = req.bitmap.height;
      req.bitmap.close();
      const gray = new cv.Mat();
      cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
      mat.delete();
      const det = detectSheet(cv, gray, req.spec, false);
      const quad = req.findQuad ? findPageQuad(cv, gray) : null;
      gray.delete();
      return [{ ids: det.ids, points: det.points, width: w, height: h, quad }, [det.points.buffer]];
    }

    case 'analyse': {
      const src = await photoMat(req.pageId, req.photo);
      let jpeg: Blob | undefined;
      if (!(req.photo instanceof Blob)) {
        jpeg = await encode(src, 'image/jpeg', 0.95);
        req.photo.close();
      }
      progress(0.2, 'Finding the sheet');
      const K = kFor(req.K, src.cols, src.rows);
      const gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      try {
        if (req.manual) {
          const quad = findPageQuad(cv, gray);
          if (!quad) throw new Error('Page edges not found. Use a darker background around the page.');
          const ppm = Math.min(MAX_PPM, Math.max(3, quadPpm(quad, req.manual.widthMm, req.manual.heightMm)));
          const geometry: PageGeometry = { kind: 'manual', K, ppm, widthMm: req.manual.widthMm, heightMm: req.manual.heightMm, rotate: 0, quad, warnings: ['Measured from the page outline only: curl near the spine is not corrected.'] };
          return [{ geometry, photo: jpeg }, []];
        }
        const a = analyse(cv, gray, req.spec, K);
        progress(0.7, 'Measuring the page');
        const upSide = guessUpSide(a.frame, a.page?.corners);
        const geometry: PageGeometry = {
          kind: 'sheet', K, ppm: a.ppm, widthMm: a.frame.widthMm, heightMm: a.frame.heightMm, rotate: 0,
          warnings: a.warnings, spec: req.spec, surface: a.fit.surface, frame: a.frame,
          corners: a.page?.corners ?? cornersOfFrame(a.frame), upSide, sources: a.page?.sources, spine: a.page?.spine ?? null,
          rmsPx: a.fit.rmsPx, curlMm: a.curlMm, sheetCorners: a.corners,
        };
        return [{ geometry, photo: jpeg }, []];
      } finally {
        gray.delete();
      }
    }

    case 'overview': {
      const g = req.geometry;
      const src = await photoMat(req.pageId, req.photo);
      const K = kFor(g.K, src.cols, src.rows);
      const paper = paperSizeMm(g.spec!);
      const m = 45, ppm = 4;
      const mat = flattenImage(cv, src, g.surface!, K, paper, axisFrame(-m, -m, paper[0] + m, paper[1] + m), ppm);
      const bmp = await createImageBitmap(matToImageData(mat));
      mat.delete();
      return [{ bitmap: bmp, u0: -m, v0: -m, ppm }, [bmp]];
    }

    case 'setCorners': {
      const g = { ...req.geometry, corners: req.corners };
      g.frame = pageFrame(req.corners, g.upSide ?? 0);
      g.widthMm = g.frame.widthMm;
      g.heightMm = g.frame.heightMm;
      return [g, []];
    }

    case 'render': {
      const g = req.geometry;
      const full = g.ppm;
      const ppm = req.maxSide ? Math.min(full, req.maxSide / Math.max(g.widthMm, g.heightMm)) : full;
      const flat = await flatPage(req.pageId, req.photo, g, ppm, (f) => progress(f * 0.8));
      const clean = cleanPage(cv, flat, { ...req.clean, ppm });
      const rot = rotated(clean, g.rotate);
      clean.delete();
      const bmp = await createImageBitmap(matToImageData(rot));
      const res = { bitmap: bmp, width: rot.cols, height: rot.rows };
      rot.delete();
      return [res, [bmp]];
    }

    case 'calibSolve':
      return [solveCalibration(cv, req.views, req.spec, req.width, req.height), []];

    case 'sheetPdf': {
      const { topLeftBlack } = boardFor(cv, req.spec);
      const dict = cv.getPredefinedDictionary(cv.DICT_5X5_1000);
      const bits = (id: number) => {
        const m = new cv.Mat();
        dict.generateImageMarker(id, 7, m, 1);
        const b = Uint8Array.from(m.data as Uint8Array, (v) => (v ? 1 : 0));
        m.delete();
        return b;
      };
      const bytes = await sheetPdf(req.spec, sheetRects(req.spec, topLeftBlack, bits), req.appUrl);
      return [bytes, [bytes.buffer]];
    }

    case 'exportPages': {
      const out: { pdf?: Uint8Array; pngs?: Uint8Array[] } = {};
      const pdfPages = [];
      const pngs: Uint8Array[] = [];
      for (let i = 0; i < req.pages.length; i++) {
        const p = req.pages[i];
        const g = p.geometry;
        progress(i / req.pages.length, `Page ${i + 1} of ${req.pages.length}`);
        const flat = await flatPage(p.pageId, p.photo, g, g.ppm, (f) => progress((i + f * 0.6) / req.pages.length));
        const clean = cleanPage(cv, flat, { ...p.clean, ppm: g.ppm });
        const rot = rotated(clean, g.rotate);
        clean.delete();
        const png = new Uint8Array(await (await encode(rot, 'image/png')).arrayBuffer());
        const turned = g.rotate % 2 === 1;
        pdfPages.push({ bytes: png, kind: 'png' as const, widthMm: turned ? g.heightMm : g.widthMm, heightMm: turned ? g.widthMm : g.heightMm });
        if (req.png) pngs.push(png);
        rot.delete();
        // Keep memory in check on long batches.
        const f = flats.get(p.pageId);
        if (f) { f.mat.delete(); flats.delete(p.pageId); }
      }
      progress(0.97, 'Writing PDF');
      if (req.pdf) out.pdf = await pagesPdf(pdfPages, req.title);
      if (req.png) out.pngs = pngs;
      const transfer: Transferable[] = [];
      if (out.pdf) transfer.push(out.pdf.buffer);
      pngs.forEach((p) => transfer.push(p.buffer));
      return [out, transfer];
    }

    case 'forget': {
      photos.get(req.pageId)?.delete();
      photos.delete(req.pageId);
      const f = flats.get(req.pageId);
      if (f) f.mat.delete();
      flats.delete(req.pageId);
      return [null, []];
    }
  }
}

function cornersOfFrame(f: { origin: [number, number]; ex: [number, number]; ey: [number, number]; widthMm: number; heightMm: number }): [number, number][] {
  const p = (a: number, b: number): [number, number] => [f.origin[0] + a * f.ex[0] + b * f.ey[0], f.origin[1] + a * f.ex[1] + b * f.ey[1]];
  return [p(0, 0), p(f.widthMm, 0), p(f.widthMm, f.heightMm), p(0, f.heightMm)];
}

/** Recover which paper side is "up" from a frame built by pageFrame. */
function guessUpSide(frame: { origin: [number, number] }, corners?: [number, number][]): number {
  if (!corners) return 0;
  let best = 0, d = Infinity;
  corners.forEach((c, i) => {
    const e = Math.hypot(c[0] - frame.origin[0], c[1] - frame.origin[1]);
    if (e < d) { d = e; best = i; }
  });
  return best;
}

// Serialize requests: OpenCV state is single-threaded anyway, and this keeps memory predictable.
let chain: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<{ id: number; req: Request }>) => {
  const { id, req } = e.data;
  chain = chain.then(async () => {
    const post = (m: WorkerMessage, t: Transferable[] = []) => self.postMessage(m, t);
    try {
      const [ok, transfer] = await handle(req, (progress, note) => post({ id, progress, note }));
      post({ id, ok }, transfer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === 'number' && cv ? cv.exceptionFromPtr?.(err)?.msg ?? String(err) : String(err);
      post({ id, error: msg });
    }
  });
};
