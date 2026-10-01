# Pagelight

Turn photos of book pages and drawings into flat, true-size PDFs — in the browser, on your own device. Nothing is uploaded; there is no server.

Pagelight is made for archiving drawings in sketchbooks and bound books, where the page curls toward the spine and an ordinary document scanner app stretches or bends the lines.

## How it works

1. **Print a calibration sheet** (A5–A2, Letter, Tabloid; portrait or landscape). It is a [ChArUco](https://docs.opencv.org/4.x/df/d4a/tutorial_charuco_detection.html) board: a checkerboard where every square corner can be identified on its own.
2. **Slide the sheet under the page** until it meets the spine, so it shows around the top, bottom and outer edge.
3. **Take a photo.** Pagelight finds the visible sheet corners and fits a model of the paper as a sheet that bends but cannot stretch (a developable surface) — the shape of a page curling into a book's gutter.
4. **Unroll.** The page is resampled through that surface, giving a flat image at true physical scale. The page outline is then found on the unrolled sheet, where the checker squares it covers give sub-millimetre edges.
5. **Clean up and export.** Even out the lighting, choose colour, grey or black-and-white (Sauvola thresholding with a "faint lines" control for pencil), and export a PDF with each page at its measured size, plus lossless PNGs for vectorising.

Optional **lens calibration** (about 15 photos of the flat sheet, once per camera) removes lens distortion and makes measurements more accurate. Pages larger than the sheet can be captured in **manual size** mode: enter the size, and the page outline is used instead (no curl correction).

### Accuracy

On synthetic test scenes with known geometry (`npm test`):

- sheet corners fit to ~0.2 px; the hidden page surface is predicted to ~0.1 mm away from the gutter
- page edges on the three sheet sides are found within ~0.35 mm
- the last ~2 cm next to the spine cannot be seen through the sheet and is extrapolated (~2 mm error at the very gutter)
- lens calibration recovers focal length within 0.2 % and distortion within 0.001

## Privacy

All image processing runs in Web Workers using OpenCV.js (WebAssembly). Camera frames, photos and results never leave the browser. Calibration profiles and settings are kept in the browser's local storage; you can export and import them as a JSON file. Fonts are bundled, so not even a font request goes out. Once loaded, the app works offline.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (synthetic scenes, no camera needed)
npm run build      # type-check and production build into dist/
```

Browser end-to-end check with Chromium's fake camera playing a synthetic curled page (needs Playwright):

```sh
GEN_E2E=1 npx vitest run test/e2e-assets.test.ts
npm run build && node scripts/e2e.mjs
```

The app is static: serve `dist/` from any web server (HTTPS is required for camera access, except on localhost).

### Layout

- `src/core/` — the vision pipeline, framework-free and unit-tested: sheet layout, ChArUco detection, camera model, surface fit (Levenberg–Marquardt), unrolling, page finding, cleanup, calibration, PDF output
- `src/worker/` — the OpenCV worker; one instance does live detection, another does heavy processing, so the interface never waits
- `src/app/` — camera, capture queue, storage
- `src/ui/` — screens and components (no framework)

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).

Third-party: [OpenCV.js](https://opencv.org) (Apache-2.0) via `@techstark/opencv-js`, [pdf-lib](https://pdf-lib.js.org) (MIT), fonts Fraunces, Instrument Sans and Spline Sans Mono (SIL Open Font License) via Fontsource.
