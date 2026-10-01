// Calibration sheet layout: a ChArUco board filling a printable sheet.
// Every chessboard corner has a unique id, so any visible strip of the
// sheet can be located on its own, even when the page covers the middle.

export interface SheetSpec {
  /** Preset name, e.g. "A4" or "Custom". */
  name: string;
  widthMm: number;
  heightMm: number;
  squareMm: number;
  markerMm: number;
  /** Chessboard squares across and down. */
  cols: number;
  rows: number;
  /** Top-left of the board on the paper, in mm. */
  originX: number;
  originY: number;
  /** Printer scale correction: measured / nominal length of the printed ruler. */
  printScale: number;
}

export const SHEET_PRESETS: Record<string, [number, number]> = {
  A5: [148, 210],
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  Letter: [215.9, 279.4],
  Tabloid: [279.4, 431.8],
};

/** Unprintable border most printers need, in mm. */
export const PRINT_MARGIN_MM = 6;
/** Space reserved at the bottom for the scale ruler and label. */
export const RULER_BAND_MM = 0;

export const DICTIONARY = 'DICT_5X5_1000' as const;

export function squareSizeFor(widthMm: number, heightMm: number): number {
  const m = Math.min(widthMm, heightMm);
  if (m < 170) return 8;
  if (m < 260) return 10;
  if (m < 380) return 12;
  return 15;
}

export function makeSheetSpec(widthMm: number, heightMm: number, name = 'Custom', printScale = 1): SheetSpec {
  const squareMm = squareSizeFor(widthMm, heightMm);
  const usableW = widthMm - 2 * PRINT_MARGIN_MM;
  const usableH = heightMm - 2 * PRINT_MARGIN_MM - RULER_BAND_MM;
  const cols = Math.floor(usableW / squareMm);
  const rows = Math.floor(usableH / squareMm);
  if (cols < 4 || rows < 4) throw new Error('Sheet too small for a calibration board');
  if (Math.floor((cols * rows) / 2) > 1000) throw new Error('Sheet too large for the marker dictionary');
  return {
    name,
    widthMm,
    heightMm,
    squareMm,
    markerMm: squareMm * 0.75,
    cols,
    rows,
    originX: (widthMm - cols * squareMm) / 2,
    originY: PRINT_MARGIN_MM + (usableH - rows * squareMm) / 2,
    printScale,
  };
}

export function presetSpec(name: string, landscape = false, printScale = 1): SheetSpec {
  const p = SHEET_PRESETS[name];
  if (!p) throw new Error(`Unknown sheet preset ${name}`);
  const [w, h] = landscape ? [p[1], p[0]] : p;
  return makeSheetSpec(w, h, name, printScale);
}

export function cornerCount(spec: SheetSpec): number {
  return (spec.cols - 1) * (spec.rows - 1);
}

/** Physical position (mm on the paper, after print-scale correction) of a ChArUco corner id. */
export function cornerMm(spec: SheetSpec, id: number): [number, number] {
  const per = spec.cols - 1;
  const c = id % per;
  const r = Math.floor(id / per);
  const s = spec.printScale;
  return [(spec.originX + (c + 1) * spec.squareMm) * s, (spec.originY + (r + 1) * spec.squareMm) * s];
}

/** Paper extent in corrected mm. */
export function paperSizeMm(spec: SheetSpec): [number, number] {
  return [spec.widthMm * spec.printScale, spec.heightMm * spec.printScale];
}

/**
 * Largest page that still leaves a usable strip of sheet at top, bottom and outer edge:
 * the print margin plus two rows of squares, so corners with both neighbouring markers whole remain.
 */
export function maxPageMm(spec: SheetSpec): [number, number] {
  const strip = PRINT_MARGIN_MM + 2 * spec.squareMm + 2;
  return [Math.floor(spec.widthMm - strip), Math.floor(spec.heightMm - 2 * strip)];
}

/** Length of the printed scale ruler, in nominal mm. */
export function rulerLengthMm(spec: SheetSpec): number {
  return (spec.cols - 2) * spec.squareMm;
}

export function specKey(spec: SheetSpec): string {
  return `${spec.name}:${spec.widthMm}x${spec.heightMm}`;
}
