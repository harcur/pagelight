// Live detection loop shared by the capture and calibration screens.
// Frames are skipped (never queued) while the live worker is busy, so the preview never lags.
import { camera } from '../app/camera';
import { store } from '../app/store';
import { liveWorker } from '../app/workers';
import type { LiveResult } from '../worker/protocol';

export interface LiveOptions {
  findQuad?: () => boolean;
  onResult: (r: LiveResult) => void;
  maxSide?: number;
  intervalMs?: number;
}

export function startLive(opts: LiveOptions): () => void {
  let stopped = false;
  let last = 0;
  const tick = async (t: number) => {
    if (stopped) return;
    requestAnimationFrame(tick);
    const w = liveWorker();
    if (w.busy > 0 || t - last < (opts.intervalMs ?? 140) || !camera.active || !camera.width) return;
    last = t;
    try {
      const bmp = await camera.grabSmall(opts.maxSide ?? 960);
      const r = await w.call({ op: 'detectLive', bitmap: bmp, spec: store.sheetSpec(), findQuad: opts.findQuad?.() }, [bmp]);
      if (!stopped) opts.onResult(r);
    } catch {
      /* camera switching or worker restarting; try again next frame */
    }
  };
  requestAnimationFrame(tick);
  return () => { stopped = true; };
}

/** Where the video sits inside its element (object-fit: contain). */
export function videoRect(el: HTMLElement, vw: number, vh: number) {
  const cw = el.clientWidth, ch = el.clientHeight;
  const s = Math.min(cw / vw, ch / vh);
  return { s, ox: (cw - vw * s) / 2, oy: (ch - vh * s) / 2, cw, ch };
}

export function drawOverlay(canvas: HTMLCanvasElement, r: LiveResult | null, opts: { quad?: boolean } = {}) {
  const parent = canvas.parentElement!;
  const dpr = window.devicePixelRatio || 1;
  const cw = parent.clientWidth, ch = parent.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  if (!r) return;
  const { s, ox, oy } = videoRect(parent, r.width, r.height);
  g.fillStyle = '#F0C063';
  for (let i = 0; i < r.ids.length; i++) {
    g.beginPath();
    g.arc(ox + r.points[2 * i] * s, oy + r.points[2 * i + 1] * s, 2.6, 0, Math.PI * 2);
    g.fill();
  }
  if (opts.quad && r.quad) {
    g.strokeStyle = '#F0C063';
    g.lineWidth = 2.4;
    g.lineJoin = 'round';
    g.beginPath();
    r.quad.forEach(([x, y], i) => (i ? g.lineTo(ox + x * s, oy + y * s) : g.moveTo(ox + x * s, oy + y * s)));
    g.closePath();
    g.stroke();
  }
}
