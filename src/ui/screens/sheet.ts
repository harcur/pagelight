import { SHEET_PRESETS, maxPageMm, presetSpec } from '../../core/sheet';
import { APP_URL, store } from '../../app/store';
import { heavyWorker } from '../../app/workers';
import { download } from '../../app/process';
import { h, icons, segmented, svg, toast } from '../dom';

export function sheetScreen(root: HTMLElement) {
  const st = { ...store.settings.sheet };
  const sheet = h('div', { class: 'sheet' });
  const page = h('div', { class: 'page' });
  sheet.append(page);
  const stage = h('div', { class: 'sheet-stage' }, h('div', { class: 'spine' }), h('div', { class: 'spine-l' }, 'Spine'), sheet);
  const sizeInfo = h('span', { class: 'mono' });
  const fitsInfo = h('span', { class: 'mono' });
  const expected = h('span', { class: 'mono' });
  const measured = h('input', { type: 'number', step: '0.1', inputmode: 'decimal', placeholder: '0.0' }) as HTMLInputElement;

  const update = () => {
    const spec = presetSpec(st.preset, st.landscape);
    const W = spec.widthMm, H = spec.heightMm;
    const k = Math.min(290 / W, 260 / H);
    Object.assign(sheet.style, { width: `${W * k}px`, height: `${H * k}px`, top: `${(300 - H * k) / 2}px` });
    const [pw, ph] = maxPageMm(spec);
    Object.assign(page.style, { top: `${15 * k}px`, width: `${pw * k}px`, height: `${ph * k}px` });
    sizeInfo.textContent = `${W} × ${H} mm`;
    fitsInfo.textContent = `${pw} × ${ph} mm`;
    expected.textContent = `${(spec.cols * spec.squareMm).toFixed(1)} mm`;
    chips.forEach((c) => c.setAttribute('aria-checked', String(c.dataset.id === st.preset)));
  };
  const save = (patch: Partial<typeof st>) => {
    const changedSheet = patch.preset !== undefined || patch.landscape !== undefined;
    Object.assign(st, patch, changedSheet ? { printScale: 1, scaleChecked: false } : {});
    store.saveSettings({ sheet: { ...st } });
    update();
  };
  const chips = Object.keys(SHEET_PRESETS).map((name) => {
    const b = h('button', { type: 'button', class: 'chip', role: 'radio', 'data-id': name, onclick: () => save({ preset: name }) }, name);
    return b;
  });

  const dl = h('button', { class: 'btn primary block' }, 'Download PDF') as HTMLButtonElement;
  dl.addEventListener('click', async () => {
    dl.disabled = true;
    dl.textContent = 'Preparing…';
    try {
      const spec = presetSpec(st.preset, st.landscape);
      const bytes = await heavyWorker().call({ op: 'sheetPdf', spec, appUrl: APP_URL });
      download(bytes, `pagelight-sheet-${st.preset}${st.landscape ? '-landscape' : ''}.pdf`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not make the PDF');
    } finally {
      dl.disabled = false;
      dl.textContent = 'Download PDF';
    }
  });

  const saveScale = h('button', { class: 'btn outline small', type: 'button' }, 'Save') as HTMLButtonElement;
  saveScale.addEventListener('click', () => {
    const spec = presetSpec(st.preset, st.landscape);
    const nominal = spec.cols * spec.squareMm;
    const m = parseFloat(measured.value);
    if (!(m > nominal * 0.9 && m < nominal * 1.1)) {
      toast(`That is far from ${nominal.toFixed(1)} mm. Check that the PDF was printed at 100 %.`);
      return;
    }
    save({ printScale: m / nominal, scaleChecked: true });
    toast(`Print scale saved: ${((m / nominal) * 100).toFixed(2)} %`);
  });

  root.append(h('main', { class: 'screen' },
    h('div', { class: 'topbar' }, h('a', { class: 'back', href: '#/', 'aria-label': 'Back to setup' }, svg(icons.back)), h('h1', null, 'Calibration sheet')),
    stage,
    h('div', { style: 'display:flex;justify-content:space-between;margin:10px 6px 0;font-size:13px;color:var(--muted)' },
      h('span', null, 'Sheet ', sizeInfo), h('span', null, 'Fits pages up to ', fitsInfo)),
    h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Sheet size', style: 'margin-top:16px' }, ...chips),
    h('div', { style: 'margin-top:12px' }, segmented([{ id: 'portrait', label: 'Portrait' }, { id: 'landscape', label: 'Landscape' }], st.landscape ? 'landscape' : 'portrait', (v) => save({ landscape: v === 'landscape' }))),
    h('p', { class: 'muted', style: 'font-size:14px;line-height:1.45;margin:14px 6px 0' },
      'Slide the sheet under the page until it meets the spine. It should stick out at least 2 cm at the top, bottom and outer edge.'),
    h('div', { style: 'margin-top:16px' }, dl),
    h('div', { class: 'card', style: 'margin-top:14px;display:flex;flex-direction:column;gap:10px' },
      h('div', null, h('b', { style: 'font-weight:500' }, 'Check the print scale'), h('div', { class: 'muted', style: 'font-size:13px;margin-top:2px' }, 'Measure the width of the checker pattern along one row. It should be ', expected, '.')),
      h('div', { style: 'display:flex;gap:10px;align-items:flex-end' }, h('label', { class: 'field' }, 'Measured width, mm', measured), saveScale)),
  ));
  update();
}
