// Generates the fake-camera video and a photo for the browser end-to-end test (scripts/e2e.mjs).
import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadCv } from './cv';
import { bookCurl, renderScene } from './synth';
import { presetSpec } from '../src/core/sheet';
import type { Intrinsics } from '../src/core/camera';

it.runIf(process.env.GEN_E2E)('writes e2e assets', async () => {
  const cv = await loadCv();
  const spec = presetSpec('A4');
  const K: Intrinsics = { width: 1920, height: 1440, fx: 1650, fy: 1650, cx: 960, cy: 720, dist: [-0.06, 0.03, 0, 0, 0] };
  const truth = bookCurl(spec);
  truth.rvec = [0.06, -0.1, Math.PI / 2 + 0.02];
  truth.tvec = [148, -105, 480];
  const gray = renderScene(cv, { K, truth, spec, page: { u0: 0, v0: 30, w: 165, h: 237 } });
  mkdirSync('test/out', { recursive: true });
  const y = Buffer.from(gray);
  const uv = Buffer.alloc((K.width / 2) * (K.height / 2), 128);
  const header = Buffer.from(`YUV4MPEG2 W${K.width} H${K.height} F10:1 Ip A1:1 C420jpeg\n`);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, uv, uv]);
  writeFileSync('test/out/scene.y4m', Buffer.concat([header, frame, frame]));
  const rgba = new cv.Mat();
  const g = cv.matFromArray(K.height, K.width, cv.CV_8UC1, gray);
  cv.cvtColor(g, rgba, cv.COLOR_GRAY2RGBA);
  writeFileSync('test/out/scene.rgba', Buffer.from(rgba.data));
  writeFileSync('test/out/scene.json', JSON.stringify({ width: K.width, height: K.height }));
  g.delete(); rgba.delete();
});
