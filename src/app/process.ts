// Capture queue: pages process in the background while the camera keeps running.
import { guessIntrinsics } from '../core/camera';
import { type Page, store } from './store';
import { heavyWorker } from './workers';

let counter = 0;

export interface CaptureInput {
  bitmap?: ImageBitmap;
  file?: Blob;
  width: number;
  height: number;
  manual?: { widthMm: number; heightMm: number };
}

export function capture(input: CaptureInput): string {
  const id = `p${Date.now().toString(36)}${(counter++).toString(36)}`;
  const page: Page = { id, photo: input.file ?? new Blob(), status: 'processing', progress: 0, clean: { ...store.settings.clean } };
  store.addPage(page);
  void run(id, input);
  return id;
}

async function run(id: string, input: CaptureInput) {
  const w = heavyWorker();
  const K = store.intrinsics(input.width, input.height) ?? guessIntrinsics(input.width, input.height);
  const photo = input.file ?? input.bitmap!;
  try {
    const res = await w.call(
      { op: 'analyse', pageId: id, photo, spec: store.sheetSpec(), K, manual: input.manual },
      input.bitmap ? [input.bitmap] : [],
      (f, note) => store.updatePage(id, { progress: f * 0.8, note }),
    );
    if (!store.page(id)) return; // removed meanwhile
    const blob = res.photo ?? input.file!;
    store.updatePage(id, { photo: blob, geometry: res.geometry, progress: 0.85, note: 'Rendering preview' });
    await refreshThumb(id);
    store.updatePage(id, { status: 'ready', progress: 1, note: undefined });
  } catch (e) {
    store.updatePage(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

export async function refreshThumb(id: string) {
  const p = store.page(id);
  if (!p?.geometry) return;
  const r = await heavyWorker().call({ op: 'render', pageId: id, photo: p.photo, geometry: p.geometry, clean: { ...p.clean, ppm: 0 }, maxSide: 360 });
  const url = await bitmapUrl(r.bitmap);
  const old = store.page(id)?.thumb;
  if (old) URL.revokeObjectURL(old);
  store.updatePage(id, { thumb: url });
}

export async function bitmapUrl(bmp: ImageBitmap, type = 'image/png'): Promise<string> {
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), type));
  return URL.createObjectURL(blob);
}

export function removePage(id: string) {
  heavyWorker().call({ op: 'forget', pageId: id }).catch(() => undefined);
  store.removePage(id);
}

export function download(bytes: Uint8Array | Blob, name: string, type = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
