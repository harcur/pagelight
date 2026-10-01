import type { OutputMode } from '../../core/cleanup';
import { refreshThumb, removePage } from '../../app/process';
import { type Page, store } from '../../app/store';
import { heavyWorker } from '../../app/workers';
import type { Overview } from '../../worker/protocol';
import { h, icons, segmented, svg, switchControl, toast } from '../dom';

export function reviewScreen(root: HTMLElement, id?: string) {
  const page = id ? store.page(id) : undefined;
  if (!id || !page) {
    location.hash = '#/batch';
    return;
  }
  const index = () => store.pages.findIndex((p) => p.id === id) + 1;
  const canvas = h('canvas', { class: 'page unfurl', style: 'max-width:calc(100% - 40px);max-height:calc(100% - 40px);box-shadow:0 14px 34px rgba(31,29,26,.22);border-radius:4px;background:#fff' });
  const edgesUi = h('div', { class: 'corner-ui', style: 'display:none' });
  const statusEl = h('div', { class: 'status overlay-status', role: 'status' });
  const flatTab = h('button', { type: 'button', 'aria-pressed': 'true' }, 'Flat');
  const edgeTab = h('button', { type: 'button', 'aria-pressed': 'false' }, 'Edges');
  const tabs = h('div', { class: 'overlay-tabs' }, flatTab, edgeTab);
  const stage = h('div', { class: 'stage' }, canvas, edgesUi, statusEl, tabs);
  const title = h('h1', null);
  const sizeEl = h('div', { class: 'size' });
  const fitEl = h('div', { class: 'mono muted', style: 'font-size:12px;text-align:right' });
  const warnings = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });

  let clean = { ...page.clean };
  const faint = h('input', { type: 'range', min: '0', max: '100', value: String(clean.faint) }) as HTMLInputElement;
  const faintOut = h('output', null, String(clean.faint));
  const speck = h('input', { type: 'range', min: '0', max: '10', value: String(clean.despeckle) }) as HTMLInputElement;
  const speckOut = h('output', null, String(clean.despeckle));
  const bwControls = h('div', { class: 'collapse', style: 'display:flex;flex-direction:column;gap:2px' },
    h('label', { class: 'range' }, 'Faint lines', faint, faintOut),
    h('label', { class: 'range' }, 'Despeckle', speck, speckOut));
  const setBw = () => {
    const on = clean.mode === 'bw';
    bwControls.style.maxHeight = on ? '120px' : '0px';
    bwControls.style.opacity = on ? '1' : '0';
  };
  const modeSeg = segmented<OutputMode>([{ id: 'colour', label: 'Colour' }, { id: 'gray', label: 'Grey' }, { id: 'bw', label: 'B&W' }], clean.mode, (m) => { clean.mode = m; setBw(); commit(); }, 'display');
  faint.addEventListener('input', () => { clean.faint = +faint.value; faintOut.textContent = faint.value; commit(); });
  speck.addEventListener('input', () => { clean.despeckle = +speck.value; speckOut.textContent = speck.value; commit(); });
  const lightSwitch = switchControl('Even out lighting', 'Removes shadows and uneven light', clean.evenLight !== false, (v) => { clean.evenLight = v; commit(); });

  root.append(h('main', { class: 'screen wide' },
    h('div', { class: 'topbar' },
      h('a', { class: 'back', href: '#/capture' }, svg(icons.back), 'Camera'),
      title,
      h('button', { class: 'roundbtn', type: 'button', 'aria-label': 'Rotate a quarter turn', onclick: () => rotate() }, svg(icons.rotate))),
    h('div', { class: 'review' },
      stage,
      h('div', { class: 'review-side' },
        h('section', { class: 'measure' }, sizeEl, fitEl),
        warnings,
        modeSeg,
        bwControls,
        lightSwitch,
        h('div', { class: 'spacer' }),
        h('div', { style: 'display:flex;gap:10px' },
          h('button', { class: 'btn outline', style: 'flex:1', onclick: () => { removePage(id); location.hash = '#/batch'; } }, 'Remove'),
          h('button', { class: 'btn primary', style: 'flex:2', onclick: () => { saveClean(); location.hash = '#/batch'; } }, 'Keep page'))))));
  setBw();

  // ---------- rendering (latest wins; never blocks the UI) ----------
  let rendering = false, dirty = false, first = true;
  const render = async () => {
    const p = store.page(id);
    if (!p?.geometry) return;
    if (rendering) { dirty = true; return; }
    rendering = true;
    statusEl.replaceChildren(svg(icons.poly), 'Rendering…');
    try {
      const rect = stage.getBoundingClientRect();
      const maxSide = Math.min(2600, Math.max(rect.width, rect.height) * (window.devicePixelRatio || 1) * 1.1);
      const r = await heavyWorker().call({ op: 'render', pageId: id, photo: p.photo, geometry: p.geometry, clean: { ...clean, ppm: 0 }, maxSide });
      canvas.width = r.width;
      canvas.height = r.height;
      canvas.getContext('2d')!.drawImage(r.bitmap, 0, 0);
      r.bitmap.close();
      if (!first) canvas.classList.remove('unfurl');
      first = false;
      const g = p.geometry;
      const [pw, ph] = [Math.round(g.widthMm * g.ppm), Math.round(g.heightMm * g.ppm)];
      statusEl.textContent = `Full resolution ${g.rotate % 2 ? ph : pw} × ${g.rotate % 2 ? pw : ph} px`;
    } catch (e) {
      statusEl.textContent = e instanceof Error ? e.message : 'Render failed';
    } finally {
      rendering = false;
      if (dirty) { dirty = false; void render(); }
    }
  };
  let t = 0;
  const commit = () => {
    clearTimeout(t);
    t = window.setTimeout(render, 60);
  };
  const saveClean = () => {
    store.updatePage(id, { clean: { ...clean } });
    store.saveSettings({ clean: { ...clean } });
    void refreshThumb(id);
  };
  const rotate = () => {
    const p = store.page(id);
    if (!p?.geometry) return;
    store.updatePage(id, { geometry: { ...p.geometry, rotate: (p.geometry.rotate + 1) % 4 } });
    fill(store.page(id)!);
    void render();
  };

  const fill = (p: Page) => {
    title.textContent = `Page ${index()}`;
    const g = p.geometry;
    if (p.status === 'processing' || !g) {
      sizeEl.textContent = '—';
      statusEl.replaceChildren(svg(icons.poly), `${p.note ?? 'Processing'} · ${Math.round(p.progress * 100)}%`);
      tabs.style.display = 'none';
      return;
    }
    if (p.status === 'error') {
      statusEl.textContent = p.error ?? 'Failed';
      warnings.replaceChildren(h('div', { class: 'warn' }, p.error ?? 'Processing failed'));
      return;
    }
    const [W, H] = g.rotate % 2 ? [g.heightMm, g.widthMm] : [g.widthMm, g.heightMm];
    sizeEl.replaceChildren(`${W.toFixed(1)} `, h('span', { class: 'muted' }, '×'), ` ${H.toFixed(1)} `, h('span', { class: 'muted', style: 'font-size:15px' }, 'mm'));
    fitEl.replaceChildren(
      g.kind === 'sheet' ? `fit ± ${((g.rmsPx ?? 0) / g.ppm).toFixed(2)} mm` : 'outline only',
      h('br'),
      g.kind === 'sheet' ? `curl ${(g.curlMm ?? 0).toFixed(0)} mm · ${g.sheetCorners} corners` : '');
    warnings.replaceChildren(...g.warnings.map((w) => h('div', { class: 'warn' }, w)));
    tabs.style.display = g.kind === 'sheet' ? '' : 'none';
  };

  // ---------- edge editing on the unrolled sheet ----------
  let overview: Overview | null = null;
  const showEdges = async (on: boolean) => {
    flatTab.setAttribute('aria-pressed', String(!on));
    edgeTab.setAttribute('aria-pressed', String(on));
    canvas.style.display = on ? 'none' : '';
    edgesUi.style.display = on ? '' : 'none';
    if (!on) return;
    const p = store.page(id);
    if (!p?.geometry) return;
    if (!overview) {
      statusEl.replaceChildren(svg(icons.poly), 'Unrolling the sheet…');
      overview = await heavyWorker().call({ op: 'overview', pageId: id, photo: p.photo, geometry: p.geometry });
      statusEl.textContent = 'Drag the corners to the page edges';
    }
    drawEdges();
  };
  flatTab.addEventListener('click', () => showEdges(false));
  edgeTab.addEventListener('click', () => showEdges(true));

  const edgeCanvas = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%;touch-action:none' });
  edgesUi.append(edgeCanvas);
  let corners: [number, number][] = [];
  let drag = -1;
  const layout = () => {
    const rect = edgesUi.getBoundingClientRect();
    const ov = overview!;
    const s = Math.min((rect.width - 32) / ov.bitmap.width, (rect.height - 32) / ov.bitmap.height);
    return { s, ox: (rect.width - ov.bitmap.width * s) / 2, oy: (rect.height - ov.bitmap.height * s) / 2, rect };
  };
  const toScreen = (c: [number, number]) => {
    const { s, ox, oy } = layout();
    const ov = overview!;
    return [ox + (c[0] - ov.u0) * ov.ppm * s, oy + (c[1] - ov.v0) * ov.ppm * s] as [number, number];
  };
  const toPaper = (x: number, y: number) => {
    const { s, ox, oy } = layout();
    const ov = overview!;
    return [(x - ox) / s / ov.ppm + ov.u0, (y - oy) / s / ov.ppm + ov.v0] as [number, number];
  };
  const drawEdges = () => {
    if (!overview) return;
    const p = store.page(id);
    if (!corners.length && p?.geometry?.corners) corners = p.geometry.corners.map((c) => [...c] as [number, number]);
    const dpr = window.devicePixelRatio || 1;
    const { s, ox, oy, rect } = layout();
    edgeCanvas.width = rect.width * dpr;
    edgeCanvas.height = rect.height * dpr;
    const g = edgeCanvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(overview.bitmap, ox, oy, overview.bitmap.width * s, overview.bitmap.height * s);
    const pts = corners.map(toScreen);
    g.strokeStyle = '#F0C063';
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.stroke();
    pts.forEach(([x, y], i) => {
      g.beginPath();
      g.arc(x, y, drag === i ? 13 : 11, 0, Math.PI * 2);
      g.fillStyle = '#FBF8F2';
      g.fill();
      g.strokeStyle = '#2F3A64';
      g.lineWidth = 3;
      g.stroke();
    });
  };
  edgeCanvas.addEventListener('pointerdown', (e) => {
    if (!overview) return;
    const r = edgeCanvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const pts = corners.map(toScreen);
    let best = -1, bd = 36;
    pts.forEach(([px, py], i) => { const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) {
      drag = best;
      edgeCanvas.setPointerCapture(e.pointerId);
      drawEdges();
    }
  });
  edgeCanvas.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const r = edgeCanvas.getBoundingClientRect();
    corners[drag] = toPaper(e.clientX - r.left, e.clientY - r.top);
    drawEdges();
  });
  edgeCanvas.addEventListener('pointerup', async () => {
    if (drag < 0) return;
    drag = -1;
    drawEdges();
    const p = store.page(id);
    if (!p?.geometry) return;
    const g = await heavyWorker().call({ op: 'setCorners', geometry: p.geometry, corners });
    store.updatePage(id, { geometry: { ...g, warnings: g.warnings.filter((w) => !/edge could not be found|Page not found/.test(w)) } });
    fill(store.page(id)!);
    void render();
    void refreshThumb(id);
  });

  const unsub = store.subscribe(() => {
    const p = store.page(id);
    if (!p) return;
    const wasPending = sizeEl.textContent === '—';
    fill(p);
    if (wasPending && p.status === 'ready') void render();
  });
  fill(page);
  if (page.status === 'ready') void render();
  const onResize = () => { if (edgesUi.style.display !== 'none') drawEdges(); };
  window.addEventListener('resize', onResize);

  return () => {
    unsub();
    window.removeEventListener('resize', onResize);
    overview?.bitmap.close();
    if (JSON.stringify(clean) !== JSON.stringify(store.page(id)?.clean)) {
      if (store.page(id)) {
        store.updatePage(id, { clean: { ...clean } });
        void refreshThumb(id).catch(() => toast('Could not update the thumbnail'));
      }
    }
  };
}
