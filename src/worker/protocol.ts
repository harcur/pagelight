// Messages between the UI thread and the OpenCV workers.
import type { Intrinsics } from '../core/camera';
import type { CalibView, Calibration } from '../core/calibrate';
import type { CleanOptions } from '../core/cleanup';
import type { PaperFrame } from '../core/flatten';
import type { SideSource } from '../core/pagefind';
import type { SheetSpec } from '../core/sheet';
import type { Surface } from '../core/surface';

export interface Overview {
  bitmap: ImageBitmap;
  /** Paper mm of the overview's top-left pixel, and its scale. */
  u0: number;
  v0: number;
  ppm: number;
}

/** Everything needed to re-render a page from its photo. Plain data (structured-clone safe). */
export interface PageGeometry {
  kind: 'sheet' | 'manual';
  K: Intrinsics;
  /** Output px per mm at full resolution. */
  ppm: number;
  widthMm: number;
  heightMm: number;
  /** Quarter turns clockwise applied to the output. */
  rotate: number;
  warnings: string[];
  // sheet mode
  spec?: SheetSpec;
  surface?: Surface;
  /** Page corners on the paper, mm: TL, TR, BR, BL in paper orientation. */
  corners?: [number, number][];
  upSide?: number;
  frame?: PaperFrame;
  sources?: SideSource[];
  spine?: string | null;
  rmsPx?: number;
  curlMm?: number;
  sheetCorners?: number;
  // manual mode
  quad?: [number, number][];
}

export type Request =
  | { op: 'init' }
  | { op: 'detectLive'; bitmap: ImageBitmap; spec: SheetSpec; findQuad?: boolean }
  | { op: 'analyse'; pageId: string; photo: Blob | ImageBitmap; spec: SheetSpec; K: Intrinsics; manual?: { widthMm: number; heightMm: number } }
  | { op: 'overview'; pageId: string; photo: Blob; geometry: PageGeometry }
  | { op: 'setCorners'; geometry: PageGeometry; corners: [number, number][] }
  | { op: 'render'; pageId: string; photo: Blob; geometry: PageGeometry; clean: CleanOptions; maxSide?: number }
  | { op: 'calibSolve'; views: CalibView[]; spec: SheetSpec; width: number; height: number }
  | { op: 'sheetPdf'; spec: SheetSpec; appUrl: string }
  | { op: 'exportPages'; pages: { pageId: string; photo: Blob; geometry: PageGeometry; clean: CleanOptions }[]; pdf: boolean; png: boolean; title: string }
  | { op: 'forget'; pageId: string };

export interface LiveResult {
  ids: number[];
  points: Float32Array;
  width: number;
  height: number;
  quad: [number, number][] | null;
}

export interface AnalyseResult {
  geometry: PageGeometry;
  /** JPEG of the photo when it arrived as a bitmap (camera), so the page can be re-rendered later. */
  photo?: Blob;
}

export interface RenderResult {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export interface ExportResult {
  pdf?: Uint8Array;
  pngs?: Uint8Array[];
}

export type ResponseMap = {
  init: { version: string };
  detectLive: LiveResult;
  analyse: AnalyseResult;
  overview: Overview;
  setCorners: PageGeometry;
  render: RenderResult;
  calibSolve: Calibration;
  sheetPdf: Uint8Array;
  exportPages: ExportResult;
  forget: null;
};

export interface WorkerMessage {
  id: number;
  ok?: unknown;
  error?: string;
  progress?: number;
  note?: string;
}
