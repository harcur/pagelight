// Promise-based client for the OpenCV workers.
import type { Request, ResponseMap, WorkerMessage } from '../worker/protocol';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (f: number, note?: string) => void };

export class CvWorker {
  private w: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  /** Requests in flight; the live loop skips frames while busy instead of queueing them. */
  busy = 0;

  constructor(readonly name: string) {
    this.w = new Worker(new URL('../worker/cv.worker.ts', import.meta.url), { type: 'module', name });
    this.w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.progress !== undefined && m.ok === undefined && m.error === undefined) {
        p.onProgress?.(m.progress, m.note);
        return;
      }
      this.pending.delete(m.id);
      this.busy--;
      if (m.error !== undefined) p.reject(new Error(m.error));
      else p.resolve(m.ok);
    };
    this.w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Worker failed'));
      this.pending.clear();
      this.busy = 0;
    };
  }

  call<K extends Request['op']>(req: Extract<Request, { op: K }>, transfer: Transferable[] = [], onProgress?: (f: number, note?: string) => void): Promise<ResponseMap[K]> {
    const id = ++this.seq;
    this.busy++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      this.w.postMessage({ id, req }, transfer);
    });
  }
}

let live: CvWorker | null = null;
let heavy: CvWorker | null = null;
let ready: Promise<string> | null = null;

/** Live detection runs on its own worker so it never waits behind a long page render. */
export function liveWorker(): CvWorker {
  return (live ??= new CvWorker('pagelight-live'));
}

export function heavyWorker(): CvWorker {
  return (heavy ??= new CvWorker('pagelight-heavy'));
}

/** Start loading OpenCV in both workers early (it is ~10 MB). */
export function warmUp(): Promise<string> {
  ready ??= Promise.all([liveWorker().call({ op: 'init' }), heavyWorker().call({ op: 'init' })]).then(([a]) => a.version);
  return ready;
}
