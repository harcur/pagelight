import { createRequire } from 'node:module';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cvPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadCv(): Promise<any> {
  if (!cvPromise) {
    cvPromise = (async () => {
      const require = createRequire(import.meta.url);
      let cv = require('@techstark/opencv-js');
      if (cv instanceof Promise) cv = await cv;
      else if (!cv.Mat) await new Promise<void>((r) => (cv.onRuntimeInitialized = () => r()));
      // Emscripten modules are thenable; drop it so the module can be returned from async code.
      if (typeof cv.then === 'function') delete cv.then;
      return cv;
    })();
  }
  return cvPromise;
}
