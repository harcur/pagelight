import { camera } from '../../app/camera';
import { type CalibView, type Coverage, VIEWS_NEEDED, addCoverage, calibrationGrade, emptyCoverage, nextHint, viewContribution } from '../../core/calibrate';
import { store } from '../../app/store';
import { heavyWorker, liveWorker } from '../../app/workers';
import { h, icons, svg, toast } from '../dom';
import { drawOverlay, startLive } from '../live';

const MIN_VIEWS = 8;

export function calibrateScreen(root: HTMLElement) {
  const views: CalibView[] = [];
  let coverage: Coverage = emptyCoverage();
  let lastShot = 0;
  let prevPts: Map<number, [number, number]> | null = null;
  let steadyFrames = 0;
  let capturing = false;

  const overlay = h('canvas', { class: 'overlay' });
  const veil = h('div', { class: 'veil' });
  const steadyPill = h('div', { class: 'status bl' }, 'Show the whole sheet, flat');
  const counter = h('span', { class: 'mono', style: 'font-size:14px' });
  const hint = h('div', { class: 'hint' });
  const sub = h('div', { class: 'muted', style: 'font-size:14px' });
  const disc = h('div');
  const finish = h('button', { class: 'btn quiet', style: 'flex:1' }) as HTMLButtonElement;
  const now = h('button', { class: 'btn outline', style: 'flex:1' }, 'Capture now') as HTMLButtonElement;

  root.append(h('main', { class: 'screen', style: 'padding-bottom:20px' },
    h('div', { class: 'topbar' },
      h('a', { class: 'back', href: '#/', 'aria-label': 'Back to setup' }, svg(icons.back)),
      h('h1', { style: 'font-style:italic' }, 'Lens calibration'), counter),
    h('div', { class: 'viewfinder', style: 'max-height:56dvh' }, camera.video, overlay, veil, steadyPill),
    h('section', { class: 'calib-info' }, disc, h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:8px' }, hint, sub)),
    h('div', { class: 'spacer' }),
    h('div', { style: 'display:flex;gap:10px;margin-top:18px' }, now, finish)));

  const renderInfo = () => {
    counter.replaceChildren(String(views.length), h('span', { class: 'muted' }, ` of ${VIEWS_NEEDED}`));
    hint.textContent = nextHint(coverage);
    const missingTilts = Object.entries(coverage.tilts).filter(([, v]) => !v).length;
    sub.textContent = missingTilts ? `Needed: views from ${missingTilts} more tilt direction${missingTilts > 1 ? 's' : ''}.` : 'All directions covered. Vary distance for the rest.';
    disc.replaceChildren(coverageDisc(coverage));
    finish.textContent = views.length >= VIEWS_NEEDED ? 'Finish' : views.length >= MIN_VIEWS ? `Finish early · ${VIEWS_NEEDED - views.length} more advised` : `Finish · ${MIN_VIEWS - views.length} more needed`;
    finish.disabled = views.length < MIN_VIEWS;
    finish.className = views.length >= VIEWS_NEEDED ? 'btn primary' : 'btn quiet';
    finish.style.flex = '1';
  };
  renderInfo();

  const shoot = async (manual: boolean) => {
    if (capturing) return;
    capturing = true;
    veil.classList.remove('go');
    void veil.offsetWidth;
    veil.classList.add('go');
    try {
      // Calibrate at the same resolution pages will be captured at.
      const bmp = await camera.grab();
      const r = await liveWorker().call({ op: 'detectLive', bitmap: bmp, spec: store.sheetSpec() }, [bmp]);
      if (r.ids.length < 20) {
        if (manual) toast('The sheet was not clear enough. Hold it steady in good light.');
        return;
      }
      const v: CalibView = { ids: r.ids, points: r.points };
      views.push(v);
      coverage = addCoverage(coverage, viewContribution(v, store.sheetSpec(), r.width, r.height));
      lastShot = performance.now();
      renderInfo();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Capture failed');
    } finally {
      capturing = false;
    }
  };
  now.addEventListener('click', () => shoot(true));

  finish.addEventListener('click', async () => {
    finish.disabled = true;
    finish.textContent = 'Solving…';
    try {
      const cal = await heavyWorker().call({ op: 'calibSolve', views, spec: store.sheetSpec(), width: camera.width, height: camera.height });
      store.saveProfile({ key: camera.key(), label: camera.label(), calibration: cal });
      const g = calibrationGrade(cal.rmsPx);
      toast(g === 'good' ? `Calibrated: ${cal.rmsPx.toFixed(2)} px — good` : g === 'ok' ? `Calibrated: ${cal.rmsPx.toFixed(2)} px — acceptable` : `Calibrated, but ${cal.rmsPx.toFixed(2)} px is high. Consider redoing it in better light.`);
      location.hash = '#/';
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Calibration failed');
      renderInfo();
    }
  });

  const stopLive = startLive({
    maxSide: 960,
    onResult: (r) => {
      drawOverlay(overlay, r);
      // Auto-capture when the sheet is well seen, steady, and the view adds coverage.
      const pts = new Map<number, [number, number]>();
      r.ids.forEach((id, i) => pts.set(id, [r.points[2 * i], r.points[2 * i + 1]]));
      let moved = Infinity;
      if (prevPts) {
        let sum = 0, n = 0;
        for (const [id, p] of pts) { const q = prevPts.get(id); if (q) { sum += Math.hypot(p[0] - q[0], p[1] - q[1]); n++; } }
        moved = n > 10 ? sum / n : Infinity;
      }
      prevPts = pts;
      steadyFrames = moved < 1.2 ? steadyFrames + 1 : 0;
      if (r.ids.length < 20) steadyPill.textContent = 'Show the whole sheet, flat';
      else if (steadyFrames < 2) steadyPill.textContent = 'Hold steady';
      else steadyPill.textContent = 'Capturing…';
      if (r.ids.length >= 40 && steadyFrames >= 2 && performance.now() - lastShot > 1800) {
        const c = viewContribution({ ids: r.ids, points: r.points }, store.sheetSpec(), r.width, r.height);
        const addsRegion = c.regions.some((x) => !coverage.regions[x]);
        const addsTilt = c.tilt && !coverage.tilts[c.tilt];
        if (addsRegion || addsTilt || views.length >= 9) void shoot(false);
      }
    },
  });

  (async () => {
    try {
      if (!camera.active) await camera.start();
    } catch {
      toast('Calibration needs camera access.');
    }
  })();

  return () => {
    stopLive();
    if (!/^#\/capture/.test(location.hash)) camera.stop();
  };
}

/** 3×3 coverage map drawn as irregular polygons, with tilt markers around it. */
function coverageDisc(c: Coverage): SVGSVGElement {
  let s = 41;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const P: [number, number][][] = [];
  for (let j = 0; j <= 3; j++) {
    const row: [number, number][] = [];
    for (let i = 0; i <= 3; i++) {
      let x = -36 + i * 24, y = -36 + j * 24;
      if (i > 0 && i < 3) x += (r() - 0.5) * 9;
      if (j > 0 && j < 3) y += (r() - 0.5) * 9;
      row.push([x, y]);
    }
    P.push(row);
  }
  let polys = '';
  const shades = ['#2F3A64', '#3B4C7D', '#4A5E92', '#26305A'];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const on = c.regions[j * 3 + i];
    const pts = [P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i]].map((p) => p.join(',')).join(' ');
    polys += `<polygon points="${pts}" fill="${on ? shades[(i + j) % 4] : '#E6DFD2'}" stroke="#F3EEE4" stroke-width="1.2" stroke-linejoin="round"/>`;
  }
  const tilt = (on: boolean, pts: string) => `<polygon points="${pts}" fill="${on ? '#D9A441' : 'none'}" stroke="${on ? '#D9A441' : '#8E857A'}" stroke-width="1.4" stroke-linejoin="round"/>`;
  return svg(`<svg viewBox="-50 -50 100 100" width="112" height="112" role="img" aria-label="Coverage">
    ${polys}
    ${tilt(c.tilts.up, '-7,-41 0,-48 7,-41')}
    ${tilt(c.tilts.down, '-7,41 0,48 7,41')}
    ${tilt(c.tilts.left, '-41,-7 -48,0 -41,7')}
    ${tilt(c.tilts.right, '41,-7 48,0 41,7')}
  </svg>`);
}
