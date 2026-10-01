// PDF output: the printable calibration sheet (vector) and scanned pages at physical size.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { type SheetSpec, PRINT_MARGIN_MM } from './sheet';

const PT_PER_MM = 72 / 25.4;

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Black rectangles (mm, top-left origin) that make up the board. `bits(id)` returns the
 * 7×7 marker image (including its black border) as 0 = black, 1 = white, row-major.
 */
export function sheetRects(spec: SheetSpec, topLeftBlack: boolean, bits: (id: number) => Uint8Array): Rect[] {
  const rects: Rect[] = [];
  const sq = spec.squareMm, mk = spec.markerMm, mod = mk / 7;
  let id = 0;
  for (let r = 0; r < spec.rows; r++) for (let c = 0; c < spec.cols; c++) {
    const x0 = spec.originX + c * sq, y0 = spec.originY + r * sq;
    const black = ((c + r) % 2 === 0) === topLeftBlack;
    if (black) {
      rects.push({ x: x0, y: y0, w: sq, h: sq });
      continue;
    }
    const b = bits(id++);
    const mx = x0 + (sq - mk) / 2, my = y0 + (sq - mk) / 2;
    for (let j = 0; j < 7; j++) {
      let run = -1;
      for (let i = 0; i <= 7; i++) {
        const isBlack = i < 7 && b[j * 7 + i] === 0;
        if (isBlack && run < 0) run = i;
        if (!isBlack && run >= 0) {
          rects.push({ x: mx + run * mod, y: my + j * mod, w: (i - run) * mod, h: mod });
          run = -1;
        }
      }
    }
  }
  return rects;
}

export async function sheetPdf(spec: SheetSpec, rects: Rect[], appUrl: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Pagelight calibration sheet ${spec.name}`);
  doc.setCreator('Pagelight');
  const W = spec.widthMm * PT_PER_MM, H = spec.heightMm * PT_PER_MM;
  const page = doc.addPage([W, H]);
  const black = rgb(0, 0, 0);
  // Tiny overlap between touching rectangles avoids hairline gaps in some PDF renderers.
  const e = 0.01;
  for (const r of rects) {
    page.drawRectangle({ x: (r.x - e) * PT_PER_MM, y: H - (r.y + r.h + e) * PT_PER_MM, width: (r.w + 2 * e) * PT_PER_MM, height: (r.h + 2 * e) * PT_PER_MM, color: black });
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const patternW = spec.cols * spec.squareMm;
  const label = `Pagelight calibration sheet · ${spec.name} ${spec.widthMm}×${spec.heightMm} mm · ${spec.squareMm} mm squares · print at 100% (actual size) · pattern width ${patternW.toFixed(1)} mm · ${appUrl}`;
  const size = 5.5;
  const tw = font.widthOfTextAtSize(label, size);
  const y = Math.max(2.2, (spec.originY - 1.2 - PRINT_MARGIN_MM / 3)) * PT_PER_MM;
  page.drawText(label, { x: (W - tw) / 2, y: H - y - size, size, font, color: rgb(0.35, 0.35, 0.35) });
  return doc.save();
}

export interface PdfPage {
  /** Encoded image (PNG or JPEG). */
  bytes: Uint8Array;
  kind: 'png' | 'jpg';
  widthMm: number;
  heightMm: number;
}

export async function pagesPdf(pages: PdfPage[], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator('Pagelight');
  doc.setProducer('Pagelight (pdf-lib)');
  for (const p of pages) {
    const img = p.kind === 'png' ? await doc.embedPng(p.bytes) : await doc.embedJpg(p.bytes);
    const W = p.widthMm * PT_PER_MM, H = p.heightMm * PT_PER_MM;
    const page = doc.addPage([W, H]);
    page.drawImage(img, { x: 0, y: 0, width: W, height: H });
  }
  return doc.save();
}
